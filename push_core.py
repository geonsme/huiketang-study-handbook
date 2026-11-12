# -*- coding: utf-8 -*-
"""生成当期核心观点推送。仅在 last_update.json 有本次新增期时输出。"""
import argparse
import json
import os
import re
import sys
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HOST = "hkt-3x1jbx9p8pj.qoder.zone"


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def short(text, limit):
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def text_of(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("text", "p", "point", "content"):
            if value.get(key):
                return str(value[key]).strip()
    return str(value or "").strip()


def site_root():
    cfg = read_json(os.path.join(BASE, "site_config.json"), {}) or {}
    host = cfg.get("host") or DEFAULT_HOST
    return f"https://{host}/"


def episode_points(ep, limit):
    raw = ep.get("points") or ep.get("keyPoints") or []
    points = [text_of(x) for x in raw if text_of(x)]
    if not points:
        for section in ep.get("analysis") or []:
            for para in section.get("p") or []:
                text = text_of(para)
                if text:
                    points.append(text)
                if len(points) >= limit:
                    break
            if len(points) >= limit:
                break
    return [short(p, 180) for p in points[:limit]]


def build_block(ep, site, point_limit):
    n = ep.get("n")
    label = (ep.get("label") or "").strip()
    vol_match = re.match(r"Vol\.\s*(\d+)", label)
    vol_no = vol_match.group(1) if vol_match else str(n)
    if vol_match:
        label = ""
    date = ep.get("date") or ""
    title = ep.get("title") or ""
    summary = ep.get("summary") or ep.get("line") or ""
    dl = ep.get("dongliao") or {}
    insight = dl.get("insight") or dl.get("title") or ""
    head = f"【慧客堂更新】Vol.{vol_no}" + (f" · {label}" if label else "") + f" · {date}"
    lines = [head, ""]
    if title:
        lines += [title, ""]
    if summary:
        lines += [f"一句话：{short(summary, 240)}", ""]
    points = episode_points(ep, point_limit)
    if points:
        lines.append("核心观点：")
        lines += [f"{i}. {p}" for i, p in enumerate(points, 1)]
        lines.append("")
    if insight:
        lines += [f"董了：{short(insight, 160)}", ""]
    lines.append(f"读全文：{site}#/vol/{n}")
    return "\n".join(lines).strip()


def emit(result, as_json):
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=1))
    elif result.get("push"):
        print(result["markdown"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", default="", help="逗号分隔的期号，默认读 last_update.json 的 new")
    ap.add_argument("--max-points", type=int, default=4)
    ap.add_argument("--max-episodes", type=int, default=3)
    ap.add_argument("--allow-stale", action="store_true", help="忽略 last_update 日期不是今天的检查")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    data = read_json(os.path.join(BASE, "data-v2.json"), {}) or {}
    by_n = {ep.get("n"): ep for ep in data.get("episodes") or []}
    last = read_json(os.path.join(BASE, "last_update.json"), {}) or {}

    if args.episodes:
        ns = []
        for part in args.episodes.split(","):
            part = part.strip()
            if part.isdigit():
                ns.append(int(part))
        source = "cli"
    else:
        ns = [x.get("n") for x in last.get("new") or [] if isinstance(x.get("n"), int)]
        source = "last_update"

    if not ns:
        return emit({"push": False, "reason": "no_new_episodes", "source": source}, args.json) or 0

    today = datetime.now().strftime("%Y-%m-%d")
    stamp = str(last.get("date") or "")
    if not args.allow_stale and not stamp.startswith(today):
        return emit({"push": False, "reason": "stale_last_update", "date": stamp, "today": today}, args.json) or 0

    episodes = [by_n[n] for n in sorted(set(ns), reverse=True) if n in by_n]
    if not episodes:
        return emit({"push": False, "reason": "episodes_not_found", "episodes": ns}, args.json) or 0

    site = site_root()
    blocks = [build_block(ep, site, max(1, args.max_points)) for ep in episodes[: max(1, args.max_episodes)]]
    markdown = "\n\n---\n\n".join(blocks)
    if len(episodes) > args.max_episodes:
        markdown += f"\n\n另有 {len(episodes) - args.max_episodes} 期已更新，见站点。"
    with open(os.path.join(BASE, "last_push.md"), "w", encoding="utf-8") as f:
        f.write(markdown + "\n")

    result = {
        "push": True,
        "source": source,
        "date": stamp,
        "episodes": [{"n": ep.get("n"), "title": ep.get("title"), "date": ep.get("date")} for ep in episodes],
        "markdown": markdown,
    }
    emit(result, args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
