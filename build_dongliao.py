# -*- coding: utf-8 -*-
"""从已有逐字稿精读中提炼“董了”观点。

每条 = 原文引句 + 上下文 + 批判性边界 + 点睛。
不是另写一套泛泛而谈，而是把每期精读里最有信息量的判断抽出来，
保留原文 quote 和时间戳，正文继续引用已有的 transcript-derived analysis。
"""
import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(BASE, "data-v2.json"), encoding="utf-8"))
OUT = os.path.join(BASE, "guides", "dongliao.json")
os.makedirs(os.path.join(BASE, "guides"), exist_ok=True)


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[。！？；])", text or "") if s.strip()]


def take(text, limit=180):
    out = ""
    for s in sentences(text):
        if len(out) + len(s) > limit and out:
            break
        out += s
    return out or (text or "")[:limit]


def ngrams(text, n=2):
    text = re.sub(r"\s+", "", text or "")
    return {text[i:i + n] for i in range(max(0, len(text) - n + 1))}


def last_sentence(text):
    parts = [s.strip() for s in re.split(r"(?<=[。！？；])", text or "") if s.strip()]
    return parts[-1] if parts else ""


def pick_insight(e, critique):
    last = last_sentence(critique)
    line = (e.get("line") or e.get("summary") or "").strip()
    weak = re.search(r"我(认同|记下|记下了|特别|请他|请她|请来|关心的是)|还是", last or "")
    if 12 <= len(last) <= 85 and re.search(r"[。！？；]$", last) and not last.endswith("？") and not weak:
        return last
    return line


def pick_quote(e, target):
    quotes = e.get("quotes") or []
    if not quotes:
        return None
    tgt = ngrams(target)
    best = None
    best_score = -1
    for q in quotes:
        score = len(ngrams(q.get("text", "")) & tgt)
        if score > best_score:
            best, best_score = q, score
    return best


rows = []
for e in sorted(DATA["episodes"], key=lambda x: x["n"]):
    a = e.get("analysis") or []
    if not a:
        continue
    a0 = a[0]
    p = a0.get("p") or []
    context = take(p[0] if p else "", 180)
    second = p[1] if len(p) > 1 else ((a[1].get("p") or [""])[0] if len(a) > 1 else "")
    critique = take(second, 180)
    insight = pick_insight(e, critique)
    target = (a0.get("h") or "") + context + (e.get("summary") or "")
    q = pick_quote(e, target)
    if not q:
        continue
    rows.append({
        "n": e["n"],
        "title": a0.get("h", ""),
        "quoteT": q.get("t", ""),
        "context": context,
        "critique": critique,
        "insight": insight,
    })

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)

print("dongliao", len(rows))
print("missing", [n for n in range(1, 112) if n not in {r["n"] for r in rows}])
for r in rows[:5]:
    print("\n###", r["n"], r["title"], r["quoteT"])
    print("CTX", r["context"][:120])
    print("CRT", r["critique"][:120])
    print("INS", r["insight"])
