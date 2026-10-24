# -*- coding: utf-8 -*-
"""生成《慧客堂》电子书：学习手册 EPUB、逐字稿全集 EPUB、学习手册 TXT。

输出：
    ebook/慧客堂·学习手册.epub
    ebook/慧客堂·逐字稿全集.epub
    ebook/慧客堂·学习手册.txt
    ebook/导入微信读书.txt

同时复制到本地 dist/ebook/ 与 Qoder Site 的 siteRoot/dist/ebook/。
"""
import html
import json
import os
import re
import shutil
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE, "data-v2.json")
EBOOK_DIR = os.path.join(BASE, "ebook")
DIST_DIR = os.path.join(BASE, "dist", "ebook")
SITE_CONFIG = os.path.join(BASE, "site_config.json")
COVER_SRC = os.path.join(BASE, "cover.png")

FONT_SERIF = "C:/Windows/Fonts/simsun.ttc"
FONT_SANS = "C:/Windows/Fonts/msyh.ttc"

CSS = """
body{font-family:serif;line-height:1.8;margin:0;padding:1em 1.1em;text-align:justify}
h1{font-family:serif;font-size:1.6em;line-height:1.45;text-align:center;font-weight:bold;margin:1.6em 0 .7em}
h2{font-family:serif;font-size:1.25em;line-height:1.5;font-weight:bold;margin:1.6em 0 .6em}
h3{font-family:serif;font-size:1.05em;line-height:1.55;font-weight:bold;margin:1.2em 0 .4em}
p{margin:0 0 .55em;text-indent:2em}
p.no-indent,.meta,.note,.question,.keywords,.source,.lead,.subtitle,.author,.stats,.part p,.title-page p,blockquote p,li p{text-indent:0}
ul,ol{margin:.4em 0 .9em;padding-left:1.5em}
li{margin:.2em 0;line-height:1.7}
blockquote{margin:1em 0;padding:.2em 0 .2em 1em;border-left:2px solid rgba(128,128,128,.5)}
blockquote p{text-indent:0}
a{color:inherit;text-decoration:none;border-bottom:1px dotted rgba(128,128,128,.45)}
hr{border:0;border-top:1px solid rgba(128,128,128,.4);margin:1.4em 0}
.meta,.note,.source{font-size:.85em;opacity:.65}
.lead{font-size:1.05em;margin:.3em 0 .8em}
.question{font-weight:bold}
.keywords{font-size:.9em;opacity:.8;margin:.2em 0 .8em}
.subtitle{font-size:1em;text-align:center;opacity:.7;margin:.2em 0 1.2em}
.author{text-align:center;margin-top:2em}
.stats{font-size:.9em;text-align:center;opacity:.65;margin-top:.3em}
.title-page{text-align:center;padding-top:18%}
.title-page .logo{width:36%;max-width:300px;margin:0 auto 1.2em}
.title-page h1{font-size:1.9em;margin:.2em 0}
.part{text-align:center;padding-top:25%}
.part h1{font-size:2em;margin:.2em 0}
.part p{text-align:center;opacity:.65;margin:.4em 0}
.part ol{text-align:left;margin:2em auto 0;max-width:26em}
.cover-img{width:100%;height:auto;display:block;margin:0;padding:0}
.index li{margin:.2em 0}
.ref{text-decoration:none;border-bottom:1px dotted rgba(128,128,128,.5)}
.tr{margin:.45em 0;font-size:.95em;text-indent:0}
.tr .time{font-family:monospace;font-size:.78em;opacity:.7;margin-right:.4em}
.tr .who{font-weight:700;font-size:.86em;margin-right:.4em;color:#b4551f}
.tr .who .role{font-weight:400;opacity:.6;margin-left:.25em;font-size:.85em}
"""


def esc(s):
    return html.escape(str(s or ""), quote=True)


def load_data():
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    episodes = sorted(data["episodes"], key=lambda e: e["n"])
    return data, episodes, {e["n"]: e for e in episodes}


def xhtml(title, body, epub_type=None):
    attr = f' epub:type="{epub_type}"' if epub_type else ""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" '
        'xml:lang="zh-CN" lang="zh-CN">\n'
        f'<head><meta charset="utf-8"/><title>{esc(title)}</title>'
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        f'<body{attr}>{body}</body></html>'
    )


def ep_title(e):
    return re.sub(r"^(?:Vol\.|V)\d+[.、\s]*", "", e.get("title", "")).strip()


def short_title(e, n=34):
    t = ep_title(e)
    return t if len(t) <= n else t[:n] + "…"


def first_sentence(s, n=60):
    t = re.split(r"[。！？]", str(s or ""))[0]
    return t if len(t) <= n else t[:n] + "…"


def ep_link(e, text=None):
    return f'<a class="ref" href="vol_{e["n"]}.xhtml">{esc(text or (e["label"] + " · " + short_title(e)))}</a>'


CH_NUM = {"01": "一", "02": "二", "03": "三", "04": "四", "05": "五", "06": "六", "07": "七", "08": "八"}


def chapter_title(m):
    no = str(m.get("no", ""))
    return f"第{CH_NUM.get(no, no)}章 {m.get('title', '')}"


def guide_box(g, heading="本期导读"):
    if not g:
        return ""
    body = f'<h2>{esc(heading)}</h2>'
    body += f'<p class="lead">{esc(g.get("hook", ""))}</p>'
    if g.get("question"):
        body += f'<p class="question">带读问题：{esc(g.get("question"))}</p>'
    keys = g.get("keywords") or []
    if keys:
        body += f'<p class="keywords">关键词：{esc(" · ".join(keys))}</p>'
    return body


def flow(steps, heading="脉络"):
    if not steps:
        return ""
    body = f'<h3>{esc(heading)}</h3><ol>'
    for key, value in steps:
        body += f'<li><b>{esc(key)}：</b>{esc(value)}</li>'
    return body + "</ol>"


def ul(items):
    return "<ul>" + "".join(f"<li>{esc(x)}</li>" for x in items if x) + "</ul>"


def paragraphs(items):
    return "".join(f"<p>{esc(x)}</p>" for x in items if x)


def module_page(m):
    g = m.get("guide") or {}
    body = f'<h1>{esc(chapter_title(m))}</h1>'
    body += f'<p class="subtitle">{esc(m.get("subtitle"))}</p>'
    body += guide_box(g, "本章导读")
    steps = [
        (f"第 {i+1} 步", s.get("h", "") + ("：" + first_sentence((s.get("p") or [""])[0], 55) if s.get("p") else ""))
        for i, s in enumerate(m.get("sections") or [])
    ]
    body += flow(steps, "本章脉络")
    if g.get("questions"):
        body += "<h2>带读问题</h2><ol>" + "".join(f"<li>{esc(q)}</li>" for q in g["questions"]) + "</ol>"
    if g.get("outcomes"):
        body += "<h2>读后能力</h2>" + ul(g["outcomes"])
    if g.get("path"):
        body += "<h2>建议路线</h2><ul>"
        for p in g["path"]:
            e = EP_BY_N.get(p.get("n"))
            if e:
                body += f"<li>{ep_link(e)} — {esc(p.get('why'))}</li>"
        body += "</ul>"
    body += f'<p class="lead">{esc(m.get("lead"))}</p>'
    body += f'<blockquote><p>{esc(m.get("bigIdea"))}</p></blockquote>'
    if m.get("quote"):
        body += f'<blockquote><p>“{esc(m["quote"].get("text"))}”</p><p class="source">— {esc(m["quote"].get("src"))}</p></blockquote>'
    if m.get("quotes"):
        body += "<h2>节目原话</h2>"
        for q in m["quotes"]:
            e = EP_BY_N.get(q.get("n"))
            src = ep_link(e, f'{e["label"]} · 点此读原文') if e else ""
            body += f'<blockquote><p>{esc(q.get("text"))}</p><p class="source">{esc(q.get("t"))} · {src}</p></blockquote>'
    if m.get("transcriptTakeaways"):
        body += "<h2>从原文反复出现的判断</h2>" + ul(m["transcriptTakeaways"])
    for s in m.get("sections") or []:
        body += f'<h2>{esc(s.get("h"))}</h2>' + paragraphs(s.get("p") or [])
    if m.get("cases"):
        body += "<h2>案例与切片</h2>"
        for c in m["cases"]:
            body += f'<h3>{esc(c.get("title"))}</h3><p>{esc(c.get("text"))}</p>'
            refs = " ".join(ep_link(EP_BY_N[n], EP_BY_N[n]["label"]) for n in c.get("eps", []) if n in EP_BY_N)
            if refs:
                body += f'<p class="meta">{refs}</p>'
    if m.get("actions"):
        body += "<h2>行动清单</h2>" + ul(m["actions"])
    if g.get("questions"):
        body += "<h2>离章前，再问自己一次</h2><ol>" + "".join(f"<li>{esc(q)}</li>" for q in g["questions"]) + "</ol>"
        body += '<p class="note">三个问题都能用自己的话回答，这一章才算真的读完。</p>'
    if m.get("eps"):
        body += "<h2>推荐精读</h2><ul>"
        for n in m["eps"]:
            e = EP_BY_N.get(n)
            if e:
                body += f"<li>{ep_link(e)}</li>"
        body += "</ul>"
    return xhtml(chapter_title(m), body, "chapter")


def vol_page(e):
    g = e.get("guide") or {}
    title = ep_title(e)
    tags = " · ".join(e.get("tags") or [])
    body = f'<h1>{esc(e.get("label"))} · {esc(title)}</h1>'
    body += f'<p class="meta">{esc(e.get("date"))} · {esc(e.get("duration"))}{(" · " + esc(tags)) if tags else ""}</p>'
    body += guide_box(g, "本期导读")
    a0 = (e.get("analysis") or [{}])[0]
    body += flow([
        ("入口问题", g.get("question", "")),
        ("主理人的判断", e.get("line") or e.get("summary") or ""),
        ("展开的线索", (a0.get("h") or "") + ("：" + (a0.get("p") or [""])[0][:90] if a0.get("p") else "")),
    ], "本期脉络")
    d = e.get("dongliao") or {}
    if d:
        body += "<h2>董了</h2>"
        body += f'<h3>{esc(d.get("title"))}</h3>'
        body += f'<blockquote><p>{esc(d.get("quote"))}</p><p class="source">{esc(e.get("label"))} · {esc(d.get("t"))}</p></blockquote>'
        body += f'<h3>放回上下文</h3><p>{esc(d.get("context"))}</p>'
        body += f'<h3>再往下想一层</h3><p>{esc(d.get("critique"))}</p>'
        body += f'<h3>点睛</h3><p class="lead">{esc(d.get("insight"))}</p>'
    body += f'<h2>本期一句话</h2><p class="lead">{esc(e.get("summary") or e.get("line"))}</p>'
    if e.get("points"):
        body += "<h2>核心要点</h2><ol>" + "".join(f"<li>{esc(x)}</li>" for x in e["points"]) + "</ol>"
    if e.get("analysis"):
        body += "<h2>精读</h2>"
        for s in e["analysis"]:
            body += f'<h3>{esc(s.get("h"))}</h3>' + paragraphs(s.get("p") or [])
    excerpts = e.get("excerpts") or e.get("quotes") or []
    if excerpts:
        body += "<h2>原文摘录</h2>"
        for q in excerpts[:8]:
            body += f'<blockquote><p>{esc(q.get("text"))}</p><p class="source">{esc(q.get("t"))}</p></blockquote>'
    if e.get("case"):
        body += f'<h2>案例</h2><p>{esc(e["case"])}</p>'
    if e.get("chapters"):
        body += "<h2>本期时间轴</h2><ul>"
        for c in e["chapters"]:
            body += f'<li>{esc(c.get("t"))} {esc(c.get("text"))}</li>'
        body += "</ul>"
    if e.get("paras"):
        body += "<h2>官方 Shownotes</h2>" + paragraphs(e["paras"])
    if g.get("question"):
        body += f'<h2>读后一问</h2><p class="question">{esc(g["question"])}</p><p class="note">读完可以回到网页版，在“我的笔记”里写一句：我准备改变什么。</p>'
    body += '<p class="note">完整逐字稿见《慧客堂 · 逐字稿全集》，或在网页版展开“完整逐字稿”。机器转写可能有错字，引用请以音频为准。</p>'
    return xhtml(f'{e.get("label")} · {title}', body, "chapter")


def transcript_page(e):
    g = e.get("guide") or {}
    title = ep_title(e)
    body = f'<h1>{esc(e.get("label"))} · {esc(title)}</h1>'
    body += f'<p class="meta">{esc(e.get("date"))} · {esc(e.get("duration"))} · {(e.get("transcriptChars") or 0)/10000:.1f} 万字</p>'
    if g.get("hook"):
        body += f'<p class="lead">{esc(g.get("hook"))}</p>'
    body += "<h2>完整逐字稿</h2>"
    tr = e.get("transcript") or {}
    turns = tr.get("turns") or []
    chunks = tr.get("chunks") or []
    if turns:
        last = ""
        for t in turns:
            if not t.get("text"):
                continue
            who = ""
            if t.get("name") and t.get("name") != last:
                role = "主理人" if t.get("role") == "host" else ("嘉宾" if t.get("role") == "guest" else "")
                role_html = f'<span class="role">{role}</span>' if role else ""
                who = f'<span class="who">{esc(t.get("name"))}{role_html}</span>'
                last = t.get("name")
            body += f'<p class="tr"><span class="time">[{esc(t.get("time"))}]</span>{who}{esc(t.get("text"))}</p>'
        body += '<p class="note">飞书妙记转写并按说话人分离，时间戳为发言起点；可能有错字，引用请以音频为准。</p>'
    elif chunks:
        for c in chunks:
            if not c or len(c) < 2 or not c[1]:
                continue
            body += f'<p class="tr"><span class="time">[{esc(c[0])}]</span>{esc(c[1])}</p>'
        body += '<p class="note">本地 Paraformer 转写，时间戳为 60 秒段首，可能有错字；引用请以音频为准。</p>'
    else:
        body += '<p class="note">这一期的逐字稿暂缺。</p>'
    return xhtml(f'{e.get("label")} · 逐字稿', body, "chapter")


def part_page(title, kicker, intro, links=None):
    body = f'<div class="part"><h1>{esc(title)}</h1><p>{esc(kicker)}</p><p>{esc(intro)}</p>'
    if links:
        body += '<ol>' + "".join(f'<li><a href="{href}">{esc(text)}</a></li>' for text, href in links) + '</ol>'
    body += '</div>'
    return xhtml(f"{title} · {kicker}", body, "part")


def howto_html(data):
    p = data["podcast"]
    body = '<h1>阅读说明</h1>'
    body += '<p>这不是一本“听完就忘”的播客合集。每一章有章节大导读，每一期有 Vol 小导读；先读导读，带着问题进入，再回到原文。</p>'
    body += '<h3>怎么用</h3><ol><li>先读一章大导读，知道这一章在解决什么问题，带着三个问题进入。</li><li>再读 10 期精选，用一句理由和三个核心词，先建立自己的坐标。</li><li>回到 Vol 做笔记，听原声、看逐字稿，最后写一条“我要改变什么”。</li></ol>'
    body += '<h2>两条路</h2><p>按模块：从风险、配置、产品、周期、人生、读书、案例、方法八个章节建立框架。按 Vol：从开篇到最新一期，按时间读完整手记。</p>'
    body += f'<h2>这本电子书包含什么</h2><p>{p.get("count")} 期导读、核心要点、精读、原文摘录、官方 Shownotes、8 篇章节大导读和 10 条原则。完整逐字稿单独成书，见《慧客堂 · 逐字稿全集》。</p>'
    body += '<h2>导入微信读书</h2><p>微信读书支持 EPUB / TXT。推荐导入 EPUB：书架右上角「+」→ 从本地导入（安卓）或从 iCloud / 文件导入（iOS）；也可以把文件发到微信文件传输助手，点开文件 → 用其他应用打开 → 微信读书。</p>'
    body += f'<p class="meta">整理范围：{esc(p.get("firstDate"))} — {esc(p.get("lastDate"))} · {p.get("count")} 期 · {esc(p.get("transcriptWan"))} 万字逐字稿。</p>'
    body += '<p class="note">播客内容版权归《慧客堂》/ 主播董艺婷所有；本电子书用于个人学习与检索，不用于商业再分发。</p>'
    return xhtml("阅读说明", body, "frontmatter")


def transcript_howto_html(data):
    p = data["podcast"]
    body = '<h1>逐字稿说明</h1>'
    body += f'<p>这是《慧客堂》{p.get("count")} 期的完整逐字稿，按 Vol 编排。每段前的时间戳是 60 秒段首，方便回到音频核对。</p>'
    body += '<h2>怎么用</h2><ol><li>从目录选择一期，先看开头两三段，判断是否是你此刻要读的内容。</li><li>用阅读器的搜索功能查人物、术语或数字；时间戳对应音频位置。</li><li>需要导读、核心要点和精读时，打开《慧客堂 · 学习手册》。</li></ol>'
    body += '<h2>说明</h2><p>逐字稿由本地 Paraformer 转写，保留口语与少量错字；引用请以音频为准。</p>'
    body += f'<p class="meta">整理范围：{esc(p.get("firstDate"))} — {esc(p.get("lastDate"))} · {p.get("count")} 期 · {esc(p.get("transcriptWan"))} 万字。</p>'
    body += '<p class="note">播客内容版权归《慧客堂》/ 主播董艺婷所有；本电子书用于个人学习与检索，不用于商业再分发。</p>'
    return xhtml("逐字稿说明", body, "frontmatter")


def appendix_html(data):
    body = '<h1>附录</h1><h2>十条原则</h2>'
    for p in data.get("principles") or []:
        body += f'<h3>{esc(p.get("no"))} · {esc(p.get("title"))}</h3><p>{esc(p.get("body"))}</p>'
        refs = " ".join(ep_link(EP_BY_N[n], EP_BY_N[n]["label"]) for n in p.get("eps", []) if n in EP_BY_N)
        if refs:
            body += f'<p class="meta">{refs}</p>'
    body += "<h2>术语速查</h2>"
    for g in data.get("glossary") or []:
        body += f'<p><b>{esc(g.get("term"))}</b>：{esc(g.get("desc"))}</p>'
    p = data["podcast"]
    body += f'<h2>关于这本手册</h2><p>《慧客堂》由{esc(p.get("host"))}主理。{esc(p.get("hostBio"))}</p>'
    body += f'<p>我以一位老听众的身份，把 {p.get("count")} 期节目、{p.get("chapters")} 个官方章节，整理成这本手册，基于 {esc(p.get("firstDate"))}—{esc(p.get("lastDate"))} 的官方 Shownotes 与本地逐字稿编写。每章开头有章节大导读，每一期标题下有 Vol 小导读；先读导读，再回到原文。手册里的精读与“董了”是我的学习整理，不代表主播本人审订。</p>'
    body += '<p class="note">逐字稿由 Paraformer 转写，机器转写可能有错字；关键引文已做基础校对，并保留时间戳供回溯。播客内容版权归《慧客堂》/ 主播董艺婷所有，本电子书用于个人学习与检索。</p>'
    return xhtml("附录", body, "backmatter")


def title_page_html(data, cover_title, subtitle):
    p = data["podcast"]
    body = '<div class="title-page">'
    body += '<img class="logo" src="images/logo.png" alt="慧客堂"/>'
    body += '<h1>慧客堂 · ' + esc(cover_title) + '</h1>'
    body += f'<p class="subtitle">{esc(subtitle)}</p>'
    body += '<p class="author">董艺婷 · 播客主理人</p>'
    body += '<p class="stats">老听众整理</p>'
    body += f'<p class="stats">{p.get("count")} 期 · {p.get("hours")} 小时 · {p.get("transcriptWan")} 万字逐字稿</p>'
    body += f'<p class="stats">{esc(p.get("firstDate"))} — {esc(p.get("lastDate"))}</p>'
    body += '</div>'
    return xhtml("慧客堂 · " + cover_title, body, "frontmatter")


def cover_page_html():
    return xhtml("封面", '<div><img class="cover-img" src="images/cover.jpg" alt="封面"/></div>', "cover")


def create_cover(path, title2, subtitle, stats, quote, logo):
    W, H = 1200, 1800
    BG, CARD, INK, MUTED = (245, 166, 35), (251, 243, 227), (23, 21, 18), (120, 107, 88)
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([60, 60, W - 60, H - 60], radius=36, fill=CARD, outline=INK, width=6)
    logo.thumbnail((380, 380), Image.LANCZOS)
    lw, lh = logo.size
    lx, ly = (W - lw) // 2, 120
    d.rounded_rectangle([lx - 8, ly - 8, lx + lw + 8, ly + lh + 8], radius=24, fill=(255, 249, 236), outline=INK, width=4)
    im.paste(logo, (lx, ly), logo if logo.mode == "RGBA" else None)
    d.text((600, 585), "慧客堂", font=ImageFont.truetype(FONT_SERIF, 92), fill=INK, anchor="mm")
    f2 = fit_font(d, title2, FONT_SERIF, 118, 920)
    d.text((600, 710), title2, font=f2, fill=INK, anchor="mm")
    d.text((600, 865), subtitle, font=fit_font(d, subtitle, FONT_SANS, 44, 920), fill=MUTED, anchor="mm")
    d.line([300, 945, 900, 945], fill=(245, 166, 35), width=5)
    d.text((600, 1015), "董艺婷 · 播客主理人", font=ImageFont.truetype(FONT_SANS, 42), fill=INK, anchor="mm")
    d.text((600, 1058), "老听众整理", font=ImageFont.truetype(FONT_SANS, 26), fill=MUTED, anchor="mm")
    d.text((600, 1090), stats, font=fit_font(d, stats, FONT_SANS, 34, 920), fill=MUTED, anchor="mm")
    d.text((600, 1450), quote, font=fit_font(d, quote, FONT_SERIF, 42, 900), fill=INK, anchor="mm")
    d.text((600, 1620), "EPUB · 2026", font=ImageFont.truetype(FONT_SANS, 26), fill=MUTED, anchor="mm")
    im.save(path, "JPEG", quality=92, optimize=True)


def fit_font(draw, text, path, max_size, max_width):
    for size in range(max_size, 19, -2):
        font = ImageFont.truetype(path, size)
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= max_width:
            return font
    return ImageFont.truetype(path, 20)


def nav_xhtml(groups):
    def child_list(children):
        if not children:
            return ""
        return "<ol>" + "".join(
            f'<li><a href="{c["href"]}">{esc(c["title"])}</a></li>' for c in children
        ) + "</ol>"

    items = "".join(
        f'<li><a href="{g["href"]}">{esc(g["title"])}</a>{child_list(g.get("children"))}</li>'
        for g in groups
    )
    body = f'<nav epub:type="toc" id="toc"><h1>目录</h1><ol>{items}</ol></nav>'
    return xhtml("目录", body)


def ncx_xml(uid, groups):
    counter = [0]

    def build(g):
        counter[0] += 1
        order = counter[0]
        children = "".join(build(c) for c in g.get("children") or [])
        return (
            f'<navPoint id="np{order}" playOrder="{order}">'
            f'<navLabel><text>{esc(g["title"])}</text></navLabel>'
            f'<content src="{g["href"]}"/>{children}</navPoint>'
        )

    navmap = "".join(build(g) for g in groups)
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">'
        f'<head><meta name="dtb:uid" content="{esc(uid)}"/><meta name="dtb:depth" content="3"/>'
        '<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>'
        f'<docTitle><text>慧客堂</text></docTitle><navMap>{navmap}</navMap></ncx>'
    )


def opf_xml(uid, book_title, author, description, pages):
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
        '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
        '<item id="logo-image" href="images/logo.png" media-type="image/png"/>',
    ]
    for p in pages:
        manifest.append(f'<item id="p_{p["id"]}" href="{p["href"]}" media-type="application/xhtml+xml"/>')
    spine = "".join(f'<itemref idref="p_{p["id"]}"/>' for p in pages)
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="bookid">{esc(uid)}</dc:identifier>'
        f'<dc:title>{esc(book_title)}</dc:title>'
        f'<dc:creator>{esc(author)}</dc:creator>'
        '<dc:contributor>董艺婷（播客主理人）</dc:contributor>'
        '<dc:language>zh-CN</dc:language>'
        f'<dc:description>{esc(description)}</dc:description>'
        '<dc:publisher>慧客堂学习手册</dc:publisher>'
        '<dc:subject>投资;财富管理;播客;学习手册</dc:subject>'
        f'<dc:date>{datetime.now().strftime("%Y-%m-%d")}</dc:date>'
        f'<meta property="dcterms:modified">{modified}</meta>'
        '<meta property="rendition:layout">reflowable</meta>'
        '<meta property="rendition:orientation">auto</meta>'
        '<meta property="rendition:spread">auto</meta>'
        '<meta name="cover" content="cover-image"/>'
        '<meta name="generator" content="build_ebook.py"/>'
        '</metadata>'
        f'<manifest>{"".join(manifest)}</manifest>'
        f'<spine toc="ncx" page-progression-direction="ltr">{spine}</spine>'
        '<guide><reference type="cover" title="封面" href="cover.xhtml"/>'
        '<reference type="toc" title="目录" href="nav.xhtml"/>'
        '<reference type="text" title="正文" href="howto.xhtml"/></guide>'
        '</package>'
    )


def write_epub(path, book_title, subtitle, description, cover_path, logo_path, pages, groups):
    uid = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, "huiketang-" + book_title))
    files = {
        "META-INF/container.xml": (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
            '</container>'
        ),
        "OEBPS/content.opf": opf_xml(uid, book_title, "《慧客堂》老听众整理", description, pages),
        "OEBPS/nav.xhtml": nav_xhtml(groups),
        "OEBPS/toc.ncx": ncx_xml(uid, groups),
        "OEBPS/style.css": CSS,
    }
    for p in pages:
        files["OEBPS/" + p["href"]] = p["content"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, "w") as z:
        zi = zipfile.ZipInfo("mimetype")
        z.writestr(zi, "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for name, content in files.items():
            z.writestr(name, content, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/images/cover.jpg", open(cover_path, "rb").read(), compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/images/logo.png", open(logo_path, "rb").read(), compress_type=zipfile.ZIP_DEFLATED)


def validate_epub(path, min_pages):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        assert names[0] == "mimetype", "mimetype 不是第一个文件"
        assert z.read("mimetype") == b"application/epub+zip"
        for required in ("META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/toc.ncx"):
            assert required in names, "缺少 " + required
        for name in names:
            if name.endswith((".xhtml", ".opf", ".ncx", ".xml")):
                ET.fromstring(z.read(name))
        xhtml_count = sum(1 for n in names if n.endswith(".xhtml") and n.startswith("OEBPS/") and n not in ("OEBPS/nav.xhtml",))
        assert xhtml_count >= min_pages, f"页面数不足：{xhtml_count} < {min_pages}"
        assert z.testzip() is None
    return os.path.getsize(path)


def sync_file(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)


def build_txt(data, episodes, path):
    p = data["podcast"]
    lines = []
    add = lines.append
    add("慧客堂 · 学习手册")
    add("董艺婷 · 播客主理人 / 老听众整理")
    add(f"{p.get('count')} 期 · {p.get('hours')} 小时 · {p.get('transcriptWan')} 万字逐字稿")
    add(f"{p.get('firstDate')} — {p.get('lastDate')}")
    add("")
    add("怎么读：先读一章大导读，带着三个问题进入；再按模块或 Vol 读；最后回到原文，写一条“我要改变什么”。")
    add("完整逐字稿见《慧客堂 · 逐字稿全集》EPUB，或在网页版展开。")
    add("")
    add("目录")
    add("一、八章导读")
    for m in data["modules"]:
        add(f"  {chapter_title(m)}")
    add("二、按 Vol 读")
    for e in episodes:
        add(f"  {e.get('label')} {ep_title(e)}")
    add("三、附录：十条原则 / 术语速查")
    add("")
    add("=" * 64)
    add("八章导读")
    add("=" * 64)
    for m in data["modules"]:
        g = m.get("guide") or {}
        add("")
        add(f"{chapter_title(m)}")
        add(m.get("subtitle", ""))
        add("")
        add("【本章导读】" + (g.get("hook") or ""))
        if g.get("questions"):
            add("【带着三个问题读】")
            for q in g["questions"]:
                add("  - " + q)
        if g.get("outcomes"):
            add("【读完后，你应该能】")
            for o in g["outcomes"]:
                add("  - " + o)
        if g.get("path"):
            add("【建议路线】")
            for ref in g["path"]:
                e = EP_BY_N.get(ref.get("n"))
                if e:
                    add(f"  - {e.get('label')} {ep_title(e)}：{ref.get('why')}")
        add("")
        add(m.get("lead", ""))
        add("")
        add(m.get("bigIdea", ""))
        for s in m.get("sections") or []:
            add("")
            add("## " + s.get("h", ""))
            for para in s.get("p") or []:
                add(para)
        if m.get("actions"):
            add("")
            add("【行动清单】")
            for a in m["actions"]:
                add("  - " + a)
        add("")
        add("-" * 64)
    add("")
    add("=" * 64)
    add("按 Vol 读")
    add("=" * 64)
    for e in episodes:
        g = e.get("guide") or {}
        add("")
        add(f"{e.get('label')} · {ep_title(e)}")
        add(f"{e.get('date')} · {e.get('duration')} · {' / '.join(e.get('tags') or [])}")
        add("")
        add("【本期导读】" + (g.get("hook") or ""))
        if g.get("question"):
            add("【带着这个问题读】" + g["question"])
        if g.get("keywords"):
            add("【关键词】" + " / ".join(g["keywords"]))
        if e.get("dongliao"):
            d = e["dongliao"]
            add("【董了】" + (d.get("title") or ""))
            add("原文：" + (d.get("quote") or ""))
            add("上下文：" + (d.get("context") or ""))
            add("再往下想一层：" + (d.get("critique") or ""))
            add("点睛：" + (d.get("insight") or ""))
        add("【本期一句话】" + (e.get("summary") or e.get("line") or ""))
        if e.get("points"):
            add("【核心要点】")
            for i, x in enumerate(e["points"], 1):
                add(f"  {i}. {x}")
        if e.get("analysis"):
            add("【精读】")
            for s in e["analysis"]:
                add("## " + s.get("h", ""))
                for para in s.get("p") or []:
                    add(para)
        excerpts = e.get("excerpts") or e.get("quotes") or []
        if excerpts:
            add("【原文摘录】")
            for q in excerpts[:8]:
                add(f"  [{q.get('t')}] {q.get('text')}")
        if e.get("case"):
            add("【案例】" + e["case"])
        if e.get("chapters"):
            add("【本期时间轴】")
            for c in e["chapters"]:
                add(f"  {c.get('t')}  {c.get('text')}")
        if e.get("paras"):
            add("【官方 Shownotes】")
            for para in e["paras"]:
                add(para)
        add("")
        add("-" * 64)
    add("")
    add("=" * 64)
    add("附录：十条原则")
    add("=" * 64)
    for pr in data.get("principles") or []:
        add("")
        add(f"{pr.get('no')} · {pr.get('title')}")
        add(pr.get("body", ""))
    add("")
    add("=" * 64)
    add("术语速查")
    add("=" * 64)
    for gl in data.get("glossary") or []:
        add(f"{gl.get('term')}：{gl.get('desc')}")
    add("")
    add("关于这本手册")
    add(f"《慧客堂》由{p.get('host')}主理。{p.get('hostBio')}")
    add("我以一位老听众的身份整理这本手册；精读与“董了”是学习整理，不代表主播本人审订。")
    add("每章开头有章节大导读，每一期标题下有 Vol 小导读；先读导读，再回到原文。")
    add("逐字稿由 Paraformer 转写，机器转写可能有错字；引用请以音频为准。")
    add("播客内容版权归《慧客堂》/ 主播董艺婷所有，本电子书用于个人学习与检索。")
    with open(path, "w", encoding="utf-8-sig") as f:
        f.write("\n".join(lines))
    return os.path.getsize(path)


def main():
    global EP_BY_N
    data, episodes, EP_BY_N = load_data()
    ep_count = data["podcast"].get("count")
    os.makedirs(EBOOK_DIR, exist_ok=True)
    if not os.path.exists(COVER_SRC):
        print("ERROR: missing cover.png")
        return 1

    logo = Image.open(COVER_SRC).convert("RGBA")
    cover_handbook = os.path.join(EBOOK_DIR, "cover_handbook.jpg")
    cover_transcripts = os.path.join(EBOOK_DIR, "cover_transcripts.jpg")
    create_cover(
        cover_handbook, "学习手册", "按 Vol 与模块的播客深读",
        f"{data['podcast'].get('count')} 期 · 8 大模块 · {len(episodes)} 条董了",
        "把投资、财富与生活放到一张桌子上聊", logo.copy()
    )
    create_cover(
        cover_transcripts, "逐字稿全集", f"{ep_count} 期完整原文 · 60 秒时间戳",
        f"约 {data['podcast'].get('transcriptWan')} 万字 · {data['podcast'].get('count')} 期",
        "原文在这里，判断交给你", logo.copy()
    )
    logo_out = os.path.join(EBOOK_DIR, "logo.png")
    logo.save(logo_out)

    reading_pages = [
        {"id": "cover", "href": "cover.xhtml", "title": "封面", "content": cover_page_html()},
        {"id": "titlepage", "href": "titlepage.xhtml", "title": "书名页", "content": title_page_html(data, "学习手册", "按 Vol 与模块的播客深读")},
        {"id": "howto", "href": "howto.xhtml", "title": "阅读说明", "content": howto_html(data)},
    ]
    module_links = [(chapter_title(m), f"module_{m['id']}.xhtml") for m in data["modules"]]
    reading_pages.append({
        "id": "part1", "href": "part1.xhtml", "title": "上篇 八章导读",
        "content": part_page("上篇", "八章导读", "先处理风险与概率，再处理资产与产品；先看懂周期与时代，再回到家庭与健康。可以按顺序读，也可以从最痛的一章开始。", module_links)
    })
    module_toc = []
    for m in data["modules"]:
        pid = "module_" + m["id"]
        href = pid + ".xhtml"
        reading_pages.append({"id": pid, "href": href, "title": chapter_title(m), "content": module_page(m)})
        module_toc.append({"title": chapter_title(m), "href": href})
    reading_pages.append({
        "id": "part2", "href": "part2.xhtml", "title": "下篇 按 Vol 读",
        "content": part_page("下篇", "按 Vol 读", "从 2024 年开篇到最新一期，按时间排列。每一期都有导读、要点、精读与原文摘录。", None)
    })
    vol_toc = []
    for e in episodes:
        pid = f"vol_{e['n']}"
        href = pid + ".xhtml"
        reading_pages.append({"id": pid, "href": href, "title": f"{e.get('label')} · {short_title(e, 30)}", "content": vol_page(e)})
        vol_toc.append({"title": f"{e.get('label')} · {short_title(e, 30)}", "href": href})
    reading_pages.append({"id": "appendix", "href": "appendix.xhtml", "title": "附录", "content": appendix_html(data)})
    reading_groups = [
        {"title": "阅读说明", "href": "howto.xhtml", "children": []},
        {"title": "上篇 八章导读", "href": "part1.xhtml", "children": module_toc},
        {"title": "下篇 按 Vol 读", "href": "part2.xhtml", "children": vol_toc},
        {"title": "附录", "href": "appendix.xhtml", "children": []},
    ]
    reading_path = os.path.join(EBOOK_DIR, "慧客堂·学习手册.epub")
    write_epub(
        reading_path, "慧客堂 · 学习手册", "按 Vol 与模块的播客深读",
        f"{ep_count} 期播客学习手册：8 篇章节大导读、{ep_count} 篇 Vol 导读、精读、原文摘录与官方 Shownotes。",
        cover_handbook, logo_out, reading_pages, reading_groups
    )
    reading_size = validate_epub(reading_path, len(reading_pages) - 1)

    transcript_pages = [
        {"id": "cover", "href": "cover.xhtml", "title": "封面", "content": cover_page_html()},
        {"id": "titlepage", "href": "titlepage.xhtml", "title": "书名页", "content": title_page_html(data, "逐字稿全集", f"{ep_count} 期完整原文 · 60 秒时间戳")},
        {"id": "howto", "href": "howto.xhtml", "title": "逐字稿说明", "content": transcript_howto_html(data)},
        {"id": "part1", "href": "part1.xhtml", "title": "逐字稿全集", "content": part_page("逐字稿全集", f"{ep_count} 期完整原文", "从开篇到最新一期，按时间排列。每段前的时间戳为 60 秒段首，方便回到音频核对。", None)},
    ]
    transcript_toc = []
    for e in episodes:
        pid = f"vol_{e['n']}"
        href = pid + ".xhtml"
        transcript_pages.append({"id": pid, "href": href, "title": f"{e.get('label')} · {short_title(e, 30)}", "content": transcript_page(e)})
        transcript_toc.append({"title": f"{e.get('label')} · {short_title(e, 30)}", "href": href})
    transcript_groups = [
        {"title": "逐字稿说明", "href": "howto.xhtml", "children": []},
        {"title": "逐字稿全集", "href": "part1.xhtml", "children": transcript_toc},
    ]
    transcript_path = os.path.join(EBOOK_DIR, "慧客堂·逐字稿全集.epub")
    write_epub(
        transcript_path, "慧客堂 · 逐字稿全集", f"{ep_count} 期完整原文 · 60 秒时间戳",
        f"慧客堂 {ep_count} 期播客完整逐字稿，含 60 秒段首时间戳；机器转写，引用请以音频为准。",
        cover_transcripts, logo_out, transcript_pages, transcript_groups
    )
    transcript_size = validate_epub(transcript_path, len(transcript_pages) - 1)

    txt_path = os.path.join(EBOOK_DIR, "慧客堂·学习手册.txt")
    txt_size = build_txt(data, episodes, txt_path)

    import_note = (
        "微信读书导入说明\n\n"
        "推荐格式：EPUB（保留封面、目录和排版）。TXT 作为兼容备份。\n\n"
        "方法一（手机本地）：\n"
        "1. 在手机浏览器打开学习手册站点，下载 EPUB。\n"
        "2. 打开微信读书 → 书架右上角「+」→ 从本地导入（安卓）或从 iCloud / 文件导入（iOS）。\n"
        "3. 选择下载好的 EPUB。\n\n"
        "方法二（微信文件）：\n"
        "1. 把 EPUB 发到微信文件传输助手。\n"
        "2. 在微信里点开文件 → 用其他应用打开 → 微信读书。\n\n"
        "两本电子书：\n"
        "- 慧客堂·学习手册.epub：导读、要点、精读、原文摘录、Shownotes。\n"
        "- 慧客堂·逐字稿全集.epub：" + str(data["podcast"].get("count")) + " 期完整逐字稿。\n"
    )
    note_path = os.path.join(EBOOK_DIR, "导入微信读书.txt")
    with open(note_path, "w", encoding="utf-8-sig") as f:
        f.write(import_note)

    outputs = [
        (reading_path, "huiketang-handbook.epub"),
        (transcript_path, "huiketang-transcripts.epub"),
        (txt_path, "huiketang-handbook.txt"),
        (note_path, "import-wechat-reading.txt"),
    ]
    for src, name in outputs:
        sync_file(src, os.path.join(DIST_DIR, name))
    if os.path.exists(SITE_CONFIG):
        with open(SITE_CONFIG, encoding="utf-8") as f:
            cfg = json.load(f)
        root = cfg.get("siteRoot")
        if root:
            web = os.path.join(root, cfg.get("webDirectory") or "dist", "ebook")
            for src, name in outputs:
                sync_file(src, os.path.join(web, name))

    print(json.dumps({
        "reading_epub": {"path": reading_path, "bytes": reading_size},
        "transcript_epub": {"path": transcript_path, "bytes": transcript_size},
        "txt": {"path": txt_path, "bytes": txt_size},
        "pages": {"reading": len(reading_pages), "transcript": len(transcript_pages)},
        "vols": len(episodes),
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
