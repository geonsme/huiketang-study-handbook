# -*- coding: utf-8 -*-
"""
慧客堂全量逐字稿流水线（本地 CPU）
- 下载 RSS 音频
- ffmpeg 转 16k 单声道 WAV
- Paraformer 中文识别（int8，4 进程并行）
- CT-Transformer 标点
- 输出 transcripts/{n}.json / .txt

用法：
  python transcribe_all.py --download --convert --transcribe --workers 4
  python transcribe_all.py --transcribe --episodes 2,5,106
"""
import argparse
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import wave

import numpy as np
import sherpa_onnx

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(BASE, 'data.json'), encoding='utf-8'))
EPISODES = DATA['episodes']
AUDIO_DIR = os.path.join(BASE, 'audio')
WAV_DIR = os.path.join(BASE, 'wav')
TRANS_DIR = os.path.join(BASE, 'transcripts')
os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(WAV_DIR, exist_ok=True)
os.makedirs(TRANS_DIR, exist_ok=True)

PARA_MODEL = os.path.join(BASE, 'sherpa-onnx-paraformer-zh-2024-03-09', 'model.int8.onnx')
PARA_TOKENS = os.path.join(BASE, 'sherpa-onnx-paraformer-zh-2024-03-09', 'tokens.txt')
PUNCT_MODEL = os.path.join(BASE, 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12', 'model.onnx')

_REC = None
_PUNCT = None


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(os.path.join(BASE, 'transcribe.log'), 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def init_worker():
    global _REC, _PUNCT
    _REC = sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=PARA_MODEL,
        tokens=PARA_TOKENS,
        num_threads=4,
        decoding_method='greedy_search',
    )
    cfg = sherpa_onnx.OfflinePunctuationConfig()
    cfg.model.ct_transformer = PUNCT_MODEL
    cfg.model.num_threads = 2
    _PUNCT = sherpa_onnx.OfflinePunctuation(cfg)


REPLACEMENTS = [
    ('会课堂', '慧客堂'), ('惠客堂', '慧客堂'), ('慧课堂', '慧客堂'),
    ('持币带涨', '持币待涨'), ('持币待跌', '持币待跌'),
    ('大跑跑输', '大幅跑输'), ('跑输的时代', '跑输了时代'),
    ('想的不少，跌的不多', '涨得不少，跌得不多'),
    ('我们当下政处', '我们当下正处于'),
    ('guang', '光'),
]


def fix_text(text):
    if not text:
        return text
    for a, b in REPLACEMENTS:
        text = text.replace(a, b)
    text = re.sub(r'gdp', 'GDP', text, flags=re.I)
    text = re.sub(r'alpha', 'Alpha', text, flags=re.I)
    text = re.sub(r'beta', 'Beta', text, flags=re.I)
    text = re.sub(r'fof', 'FOF', text, flags=re.I)
    text = re.sub(r'etf', 'ETF', text, flags=re.I)
    text = re.sub(r'cta', 'CTA', text, flags=re.I)
    text = re.sub(r'cpi', 'CPI', text, flags=re.I)
    text = re.sub(r'ppi', 'PPI', text, flags=re.I)
    return text


def fmt_time(sec):
    sec = int(sec)
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def download_one(ep):
    n = ep['n']
    out = os.path.join(AUDIO_DIR, f"{n}.m4a")
    if os.path.exists(out) and os.path.getsize(out) > 100_000:
        return n, 'exists'
    url = ep['audio']
    if not url:
        return n, 'no url'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(out + '.part', 'wb') as f:
                total = 0
                while True:
                    chunk = r.read(1024 * 256)
                    if not chunk:
                        break
                    f.write(chunk)
                    total += len(chunk)
            if total < 100_000:
                raise RuntimeError(f'too small {total}')
            os.replace(out + '.part', out)
            return n, f'{total/1048576:.1f}MB'
        except Exception as e:
            if os.path.exists(out + '.part'):
                try: os.remove(out + '.part')
                except OSError: pass
            if attempt == 2:
                return n, 'ERR ' + repr(e)
            time.sleep(2)
    return n, 'ERR'


def convert_one(ep):
    n = ep['n']
    src = os.path.join(AUDIO_DIR, f"{n}.m4a")
    dst = os.path.join(WAV_DIR, f"{n}.wav")
    if os.path.exists(dst) and os.path.getsize(dst) > 1_000_000:
        return n, 'exists'
    if not os.path.exists(src):
        return n, 'no audio'
    cmd = ['ffmpeg', '-y', '-i', src, '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', dst, '-loglevel', 'error']
    try:
        subprocess.run(cmd, check=True, timeout=1800)
        return n, f'{os.path.getsize(dst)/1048576:.0f}MB'
    except Exception as e:
        return n, 'ERR ' + repr(e)


def transcribe_one(ep):
    global _REC, _PUNCT
    n = ep['n']
    out_json = os.path.join(TRANS_DIR, f"{n}.json")
    out_txt = os.path.join(TRANS_DIR, f"{n}.txt")
    if os.path.exists(out_json) and os.path.getsize(out_json) > 500:
        return n, 'exists'
    wav = os.path.join(WAV_DIR, f"{n}.wav")
    if not os.path.exists(wav):
        return n, 'no wav'
    if _REC is None:
        init_worker()

    with wave.open(wav, 'rb') as w:
        sr = w.getframerate()
        total = w.getnframes()
        raw = w.readframes(total)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    seconds = len(audio) / sr

    # 45s chunks, 1s overlap; the overlap is trimmed by dropping very short tails.
    chunk_sec = 60
    overlap = 1
    step = chunk_sec - overlap
    chunks = []
    start = 0
    while start < seconds:
        end = min(start + chunk_sec, seconds)
        seg = audio[int(start * sr):int(end * sr)]
        if len(seg) < sr * 0.8:
            break
        s = _REC.create_stream()
        s.accept_waveform(sr, seg)
        _REC.decode_stream(s)
        text = (s.result.text or '').strip()
        if text:
            try:
                text = _PUNCT.add_punctuation(text)
            except Exception:
                pass
            # drop a repeated prefix caused by the 1s overlap
            text = fix_text(text)
            if chunks:
                prev = chunks[-1]['text']
                for cut in range(min(24, len(text)), 4, -1):
                    if text[:cut] and text[:cut] in prev[-80:]:
                        text = text[cut:].lstrip('，。；：、 ,.')
                        break
        chunks.append({'start': round(start, 1), 'end': round(end, 1), 'text': text})
        if end >= seconds:
            break
        start += step

    full = '\n'.join(c['text'] for c in chunks if c['text'])
    obj = {
        'n': n,
        'title': ep['title'],
        'duration': ep['duration'],
        'seconds': round(seconds, 1),
        'engine': 'sherpa-onnx paraformer-zh int8 + CT-Transformer punctuation',
        'chunks': chunks,
        'text': full,
    }
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    with open(out_txt, 'w', encoding='utf-8') as f:
        f.write(f"# {ep['title']}\n\n")
        for c in chunks:
            if c['text']:
                f.write(f"[{fmt_time(c['start'])}] {c['text']}\n\n")
    return n, f'{seconds/60:.1f}min/{len(chunks)} chunks'


def selected(args):
    eps = EPISODES
    if args.episodes:
        want = {int(x) for x in args.episodes.split(',') if x.strip()}
        eps = [e for e in eps if e['n'] in want]
    # core first, then shorter episodes
    eps = sorted(eps, key=lambda e: (not e.get('core', False), e.get('seconds', 0)))
    return eps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--download', action='store_true')
    ap.add_argument('--convert', action='store_true')
    ap.add_argument('--transcribe', action='store_true')
    ap.add_argument('--episodes', type=str, default='')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--download-workers', type=int, default=6)
    args = ap.parse_args()
    if not (args.download or args.convert or args.transcribe):
        args.download = args.convert = args.transcribe = True

    eps = selected(args)
    log(f"selected {len(eps)} episodes")

    if args.download:
        log("download start")
        with cf.ThreadPoolExecutor(max_workers=args.download_workers) as ex:
            futs = {ex.submit(download_one, e): e['n'] for e in eps}
            for i, fut in enumerate(cf.as_completed(futs), 1):
                n, msg = fut.result()
                log(f"download {i}/{len(eps)} ep{n} {msg}")

    if args.convert:
        log("convert start")
        with cf.ProcessPoolExecutor(max_workers=4) as ex:
            futs = {ex.submit(convert_one, e): e['n'] for e in eps}
            for i, fut in enumerate(cf.as_completed(futs), 1):
                n, msg = fut.result()
                log(f"convert {i}/{len(eps)} ep{n} {msg}")

    if args.transcribe:
        log("transcribe start")
        with cf.ProcessPoolExecutor(max_workers=args.workers, initializer=init_worker) as ex:
            futs = {ex.submit(transcribe_one, e): e['n'] for e in eps}
            for i, fut in enumerate(cf.as_completed(futs), 1):
                n, msg = fut.result()
                log(f"transcribe {i}/{len(eps)} ep{n} {msg}")

    log("done")


if __name__ == '__main__':
    main()
