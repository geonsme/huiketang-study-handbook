# -*- coding: utf-8 -*-
"""
慧客堂每日更新：拉 RSS → 检测新增 → 下载/转写 → 写入 data-v2 → 构建。
不负责 LLM 精读与云端发布；这两步由每日 Qoder 自动化继续完成。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import timezone
from email.utils import parsedate_to_datetime

BASE = os.path.dirname(os.path.abspath(__file__))
FEED_URL = 'https://feed.xyzfm.space/7neh8whbtc9w'
DATA_PATH = os.path.join(BASE, 'data-v2.json')
os.chdir(BASE)
sys.path.insert(0, BASE)
import transcribe_all as ta  # 复用模型、下载、转写函数


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(os.path.join(BASE, 'update_daily.log'), 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def strip_html(html):
    s = html or ''
    s = s.replace('<br>', '\n').replace('<br/>', '\n').replace('</p>', '\n\n')
    s = re.sub(r'<li[^>]*>', '• ', s)
    s = s.replace('</li>', '\n')
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    s = s.replace('&quot;', '"').replace('&#39;', "'")
    s = re.sub(r'&#x([0-9a-f]+);', lambda m: chr(int(m.group(1), 16)), s, flags=re.I)
    s = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def clean_shownotes(html):
    s = html or ''
    s = re.sub(r'<img[^>]*>', '', s, flags=re.I)
    s = re.sub(r'在小宇宙查看该单集文稿[\s\S]*$', '', s, flags=re.I)
    s = re.sub(r'我们是谁[\s\S]*$', '', s, flags=re.I)
    s = s.replace('<br>', '\n').replace('<br/>', '\n').replace('</p>', '\n\n')
    s = re.sub(r'<li[^>]*>', '• ', s)
    s = s.replace('</li>', '\n')
    s = re.sub(r'</(div|h[1-6]|blockquote)>', '\n', s)
    s = re.sub(r'<a[^>]*>([\s\S]*?)</a>', r'\1', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    s = s.replace('&quot;', '"').replace('&#39;', "'")
    s = re.sub(r'&#x([0-9a-f]+);', lambda m: chr(int(m.group(1), 16)), s, flags=re.I)
    s = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), s)
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def to_paras(text):
    return [p.strip() for p in re.split(r'\n{2,}', text) if p.strip()]


def extract_chapters(text, max_seconds=8 * 3600):
    chapters = []
    def sec(t):
        p = t.split(':')
        return int(p[0]) * 3600 + int(p[1]) * 60 + int(p[2]) if len(p) == 3 else int(p[0]) * 60 + int(p[1])
    for line in text.split('\n'):
        line = line.strip()
        line = re.sub(r'^[•*\-–—]+\s*', '', line)
        line = re.sub(r'^(\d{1,2}:\d{2})\s(\d{2})\s+', r'\1:\2 ', line)
        m = re.match(r'^(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[｜|:：\-–—]\s*)?(.{2,})$', line)
        if not m:
            continue
        t, title = m.group(1), m.group(2).strip()
        if sec(t) > max_seconds + 600:
            continue
        chapters.append({'t': t, 'text': title})
    return chapters


def parse_duration(t):
    if not t:
        return 0
    p = t.split(':')
    try:
        if len(p) == 3:
            return int(p[0]) * 3600 + int(p[1]) * 60 + int(p[2])
        if len(p) == 2:
            return int(p[0]) * 60 + int(p[1])
        return int(float(p[0]))
    except Exception:
        return 0


def fmt_duration(sec):
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m:02d}:{s:02d}'


def cn_date(pub):
    try:
        dt = parsedate_to_datetime(pub)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        try:
            from zoneinfo import ZoneInfo
            dt = dt.astimezone(ZoneInfo('Asia/Shanghai'))
        except Exception:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime('%Y.%m.%d')
    except Exception:
        return time.strftime('%Y.%m.%d')


def label_of(title):
    m = re.match(r'^(Vol\.|V)(\d+)', title, re.I)
    if not m:
        return None, '特别篇'
    n = int(m.group(2))
    return n, ('V%d' % n if m.group(1).lower() == 'v' else 'Vol.%d' % n)


TAG_RULES = [
    ('资产配置', ['资产配置', '组合', '再平衡', '配置']),
    ('基金产品', ['基金', 'FOF', 'ETF', '指增', '私募', '公募']),
    ('宏观周期', ['关税', '宏观', '周期', '美联储', '地缘', '战争', '气候']),
    ('市场复盘', ['牛市', '熊市', '复盘', '行情', 'A股', '港股', '美股']),
    ('科技AI', ['AI', 'DeepSeek', '芯片', '半导体', '科技', '量子', '机器人']),
    ('商品黄金', ['黄金', '商品', 'CTA', '原油', '期货']),
    ('读书认知', ['读书', '书', '认知', '阅读']),
    ('家庭养老', ['家庭', '养老', '保险', '信托', '孩子', '教育']),
    ('财富人生', ['财富', '自由', '幸福', '人生', '中年', '职业']),
    ('真实案例', ['韭菜', '踩坑', '案例', '投资吐槽', '反诈']),
    ('量化策略', ['量化', '中性', '因子', '超额']),
    ('健康关系', ['健康', '睡眠', '关系', '冥想', '婚姻']),
]


def auto_tags(title, text):
    blob = title + ' ' + (text or '')
    tags = []
    for tag, words in TAG_RULES:
        if any(w.lower() in blob.lower() for w in words):
            tags.append(tag)
    return tags[:3] or ['市场复盘']


def auto_mods(tags):
    mapping = {
        '资产配置': 'm2', '基金产品': 'm3', '宏观周期': 'm4', '市场复盘': 'm4',
        '科技AI': 'm4', '商品黄金': 'm3', '读书认知': 'm6', '家庭养老': 'm5',
        '财富人生': 'm5', '真实案例': 'm7', '量化策略': 'm3', '健康关系': 'm5',
        '投资入门': 'm1',
    }
    out = []
    for t in tags:
        m = mapping.get(t)
        if m and m not in out:
            out.append(m)
    return out or ['m4']


def fetch_feed():
    req = urllib.request.Request(FEED_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def parse_feed(raw):
    root = ET.fromstring(raw)
    ns = {'itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd', 'content': 'http://purl.org/rss/1.0/modules/content/'}
    items = []
    for it in root.findall('.//channel/item'):
        title = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip().split('?')[0]
        guid = (it.findtext('guid') or '').strip()
        pub = (it.findtext('pubDate') or '').strip()
        duration = (it.findtext('itunes:duration', namespaces=ns) or '').strip()
        enc = it.find('enclosure')
        audio = enc.attrib.get('url', '') if enc is not None else ''
        desc = it.findtext('description') or ''
        content = it.findtext('content:encoded', namespaces=ns) or ''
        shownotes = content if len(content) > len(desc) else desc
        items.append({'title': title, 'link': link, 'guid': guid, 'pub': pub,
                      'duration': duration, 'audio': audio, 'shownotes': shownotes})
    return items


def make_episode(it, n):
    text = clean_shownotes(it['shownotes'])
    paras = to_paras(text)
    chapters = extract_chapters(text)
    vol, label = label_of(it['title'])
    seconds = parse_duration(it['duration'])
    tags = auto_tags(it['title'], text)
    mods = auto_mods(tags)
    first = next((p for p in paras if len(p) >= 18 and not p.startswith('•')), '')
    line = re.sub(r'\s+', '', first)[:80] or re.sub(r'^(Vol\.|V)\d+[.、\s]*', '', it['title'])
    return {
        'n': n, 'vol': vol, 'label': label, 'title': it['title'],
        'date': cn_date(it['pub']), 'duration': fmt_duration(seconds), 'seconds': seconds,
        'link': it['link'], 'audio': it['audio'],
        'intro': '\n\n'.join(paras[:2])[:1200],
        'chapters': chapters, 'paras': paras,
        'tags': tags, 'mods': mods, 'line': line, 'core': False,
        'points': [], 'summary': line, 'excerpts': [], 'transcript': None,
        'transcriptChars': 0, 'keyChunks': [], 'quotes': [], 'analysis': [],
        'case': '', 'keywords': [], 'pointsSource': 'transcript',
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只检测，不下载/转写')
    args = ap.parse_args()

    data = json.load(open(DATA_PATH, encoding='utf-8'))
    known = {e.get('link', '').split('?')[0] for e in data['episodes']}
    items = parse_feed(fetch_feed())
    new_items = [it for it in items if it['link'] not in known]
    log(f"RSS {len(items)} items, known {len(known)}, new {len(new_items)}")
    if args.check:
        for it in new_items:
            log('NEW ' + it['title'])
        print(json.dumps({'new': [{'title': it['title'], 'link': it['link']} for it in new_items]}, ensure_ascii=False))
        return

    if not new_items:
        with open(os.path.join(BASE, 'last_update.json'), 'w', encoding='utf-8') as f:
            json.dump({'date': time.strftime('%Y-%m-%d %H:%M:%S'), 'new': [], 'total': len(data['episodes'])}, f, ensure_ascii=False, indent=1)
        log('no new episodes')
        return

    max_n = max((e['n'] for e in data['episodes']), default=0)
    added = []
    for it in reversed(new_items):  # oldest first, stable ascending n
        max_n += 1
        ep = make_episode(it, max_n)
        log(f"new ep{max_n}: {ep['title']}")
        if not ep['audio']:
            log('skip: no audio')
            continue
        # download / convert / transcribe via shared pipeline
        n, msg = ta.download_one(ep)
        log(f"download ep{n} {msg}")
        n, msg = ta.convert_one(ep)
        log(f"convert ep{n} {msg}")
        if ta._REC is None:
            ta.init_worker()
        n, msg = ta.transcribe_one(ep)
        log(f"transcribe ep{n} {msg}")
        tr_path = os.path.join(BASE, 'transcripts', f"{ep['n']}.json")
        if not os.path.exists(tr_path):
            log('transcript missing, skip adding')
            continue
        tr = json.load(open(tr_path, encoding='utf-8'))
        chunks = [[ta.fmt_time(c['start']), c['text']] for c in tr.get('chunks', [])]
        ep['transcript'] = {'chunks': chunks, 'seconds': tr.get('seconds', ep['seconds'])}
        ep['transcriptChars'] = sum(len(c[1]) for c in chunks)
        data['episodes'].append(ep)
        # per-episode metadata for the summary step
        meta = {k: ep.get(k) for k in ['n', 'label', 'title', 'date', 'duration', 'tags', 'mods', 'line', 'chapters', 'paras']}
        with open(os.path.join(BASE, 'ep_meta', f"{ep['n']}.json"), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        added.append({'n': ep['n'], 'label': ep['label'], 'title': ep['title'], 'date': ep['date']})

    if not added:
        log('nothing added')
        with open(os.path.join(BASE, 'last_update.json'), 'w', encoding='utf-8') as f:
            json.dump({'date': time.strftime('%Y-%m-%d %H:%M:%S'), 'new': [], 'total': len(data['episodes'])}, f, ensure_ascii=False, indent=1)
        return

    data['podcast']['count'] = len(data['episodes'])
    data['podcast']['hours'] = round(sum(e.get('seconds', 0) for e in data['episodes']) / 3600, 1)
    data['podcast']['transcribedCount'] = len(data['episodes'])
    data['podcast']['transcriptChars'] = sum(e.get('transcriptChars', 0) for e in data['episodes'])
    data['podcast']['transcriptWan'] = f"{data['podcast']['transcriptChars'] / 10000:.1f}"
    dates = sorted(e.get('date','') for e in data['episodes'] if e.get('date'))
    if dates:
        data['podcast']['firstDate'] = dates[0]
        data['podcast']['lastDate'] = dates[-1]
    data['podcast']['chapters'] = sum(len(e.get('chapters',[])) for e in data['episodes'])
    with open(DATA_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    subprocess.run(['node', 'finalize_new.js'], check=False)
    subprocess.run(['node', 'build-v2.js'], check=False)
    # copy build to public output
    src = os.path.join(BASE, '慧客堂·学习手册-v2.html')
    dst_dir = os.path.join(BASE, 'dist')
    os.makedirs(dst_dir, exist_ok=True)
    if os.path.exists(src):
        with open(src, 'rb') as rf, open(os.path.join(dst_dir, 'index.html'), 'wb') as wf:
            wf.write(rf.read())
    with open(os.path.join(BASE, 'last_update.json'), 'w', encoding='utf-8') as f:
        json.dump({'date': time.strftime('%Y-%m-%d %H:%M:%S'), 'new': added, 'total': len(data['episodes'])}, f, ensure_ascii=False, indent=1)
    log(f"updated {len(added)} episodes, total {len(data['episodes'])}")


if __name__ == '__main__':
    main()
