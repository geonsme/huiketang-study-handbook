# -*- coding: utf-8 -*-
"""把《慧客堂》学习手册的新增内容自动同步到私有 GitHub 仓库。

默认行为：只有 data-v2.json 比 github-export/data-v2.json 多出新节目时才复制、提交、推送；
没有新增时直接退出，不产生空提交。

用法：
    D:\\Software\\miniconda\\python.exe sync_github.py
    D:\\Software\\miniconda\\python.exe sync_github.py --dry-run
    D:\\Software\\miniconda\\python.exe sync_github.py --force   # 流程/脚本升级时强制同步
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.join(BASE, "github-export")
BRANCH = "main"
REMOTE = "origin"


def log(msg):
    print(msg, flush=True)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def run(cmd, cwd, check=True):
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} 失败：{(p.stderr or p.stdout).strip()}")
    return p


def push_with_retry(export):
    last_err = ""
    for attempt in (1, 2):
        p = run(["git", "push", REMOTE, BRANCH], cwd=export, check=False)
        if p.returncode == 0:
            return True, ""
        last_err = (p.stderr or p.stdout).strip()
        if attempt == 1:
            time.sleep(3)
    return False, last_err


def pending_push_count(export):
    run(["git", "fetch", REMOTE, BRANCH], cwd=export, check=False)
    p = run(["git", "rev-list", "--count", f"{REMOTE}/{BRANCH}..HEAD"], cwd=export, check=False)
    try:
        return int((p.stdout or "0").strip())
    except Exception:
        return 0


def same_file(src, dst):
    if not os.path.exists(dst):
        return False
    with open(src, "rb") as a, open(dst, "rb") as b:
        return a.read() == b.read()


def copy_file(src, dst):
    if not os.path.exists(src):
        return False
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if same_file(src, dst):
        return False
    shutil.copyfile(src, dst)
    return True


def unescape_html(text):
    return (
        text.replace("\\u003c", "<")
        .replace("\\u003e", ">")
        .replace('\\"', '"')
        .replace("\\\\", "\\")
    )


def update_readme(path, old_count, new_count, old_wan, new_wan):
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf-8") as f:
        text = f.read()
    before = text
    if old_count and old_count != new_count:
        text = re.sub(rf"(?<![\d.]){old_count}\s*期", f"{new_count} 期", text)
    if old_wan and old_wan != new_wan:
        text = text.replace(f"{old_wan} 万字", f"{new_wan} 万字")
    if text != before:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不复制、不提交")
    ap.add_argument("--force", action="store_true", help="没有新增期也同步脚本/构建产物")
    ap.add_argument("--message", default="", help="额外提交说明")
    ap.add_argument("--export-dir", default=EXPORT, help="导出仓库目录（默认 github-export）")
    args = ap.parse_args()
    export = os.path.abspath(args.export_dir)

    data_path = os.path.join(BASE, "data-v2.json")
    html_path = os.path.join(BASE, "慧客堂·学习手册-v2.html")
    repo_data_path = os.path.join(export, "data-v2.json")
    if not os.path.isdir(os.path.join(export, ".git")):
        log("ERROR: github-export 不是 git 仓库")
        return 1
    if not os.path.exists(data_path) or not os.path.exists(html_path):
        log("ERROR: 缺少 data-v2.json 或最终 HTML")
        return 1

    data = read_json(data_path)
    episodes = data.get("episodes") or []
    repo_data = read_json(repo_data_path) if os.path.exists(repo_data_path) else {"episodes": []}
    repo_ns = {e.get("n") for e in repo_data.get("episodes") or []}
    new_eps = sorted([e for e in episodes if e.get("n") not in repo_ns], key=lambda e: e.get("n") or 0)
    new_ns = [e.get("n") for e in new_eps]

    if not new_ns and not args.force:
        # 上次 push 失败的 commit 可能还留在本地；没有新增时只重试推送，不产生新提交
        ahead = pending_push_count(export)
        if ahead > 0:
            ok, err = push_with_retry(export)
            if ok:
                commit = run(["git", "rev-parse", "--short", "HEAD"], cwd=export).stdout.strip()
                log(json.dumps({"pushed": True, "reason": "retry_pending_push", "commit": commit, "ahead": ahead, "total": len(episodes)}, ensure_ascii=False))
                return 0
            log(json.dumps({"pushed": False, "reason": "push_failed", "ahead": ahead, "error": err[-800:]}, ensure_ascii=False))
            return 1
        log(json.dumps({"pushed": False, "reason": "no_new_episodes", "new": [], "total": len(episodes)}, ensure_ascii=False))
        return 0

    # 只允许“有效信息”入库：新期必须有逐字稿、精读和引文
    incomplete = []
    for e in new_eps:
        n = e.get("n")
        chunks = (e.get("transcript") or {}).get("chunks") or []
        guide = e.get("guide") or {}
        dl = e.get("dongliao") or {}
        if (not chunks or len(e.get("analysis") or []) < 2 or len(e.get("quotes") or []) < 2
                or not guide.get("hook") or not guide.get("question") or len(guide.get("keywords") or []) < 3
                or not dl.get("quote") or not dl.get("context") or not dl.get("critique") or not dl.get("insight")):
            incomplete.append(n)
    if incomplete and not args.force:
        log(json.dumps({"pushed": False, "reason": "incomplete_new_episodes", "episodes": incomplete}, ensure_ascii=False))
        return 1

    with open(html_path, encoding="utf-8") as f:
        html_text = unescape_html(f.read())
    for e in new_eps:
        title = e.get("title") or ""
        if title and title not in html_text:
            log(json.dumps({"pushed": False, "reason": "new_title_not_in_html", "episode": e.get("n")}, ensure_ascii=False))
            return 1

    # 复制文件：只复制白名单，绝不把音频、模型、日志、site_config 带进 Git
    copies = [
        (os.path.join(BASE, "慧客堂·学习手册-v2.html"), os.path.join(export, "index.html")),
        (os.path.join(BASE, "慧客堂·学习手册-v2.html"), os.path.join(export, "dist", "index.html")),
        (data_path, repo_data_path),
        (os.path.join(BASE, "template-v2.html"), os.path.join(export, "template-v2.html")),
        (os.path.join(BASE, "module-story.css"), os.path.join(export, "module-story.css")),
        (os.path.join(BASE, "module_scenes.json"), os.path.join(export, "module_scenes.json")),
        (os.path.join(BASE, "apply_module_scenes.js"), os.path.join(export, "apply_module_scenes.js")),
        (os.path.join(BASE, "last_update.json"), os.path.join(export, "last_update.json")),
        (os.path.join(BASE, "README.agent.md"), os.path.join(export, "README.agent.md")),
        (os.path.join(BASE, "README.agent.md"), os.path.join(export, "dist", "README.agent.md")),
        (os.path.join(BASE, "build-v2.js"), os.path.join(export, "build-v2.js")),
        (os.path.join(BASE, "update_daily.py"), os.path.join(export, "update_daily.py")),
        (os.path.join(BASE, "push_core.py"), os.path.join(export, "push_core.py")),
        (os.path.join(BASE, "sync_github.py"), os.path.join(export, "sync_github.py")),
        (os.path.join(BASE, "transcribe_all.py"), os.path.join(export, "transcribe_all.py")),
        (os.path.join(BASE, "apply_summaries.js"), os.path.join(export, "apply_summaries.js")),
        (os.path.join(BASE, "apply_firstperson.js"), os.path.join(export, "apply_firstperson.js")),
        (os.path.join(BASE, "finalize_new.js"), os.path.join(export, "finalize_new.js")),
        (os.path.join(BASE, "apply_guides.js"), os.path.join(export, "apply_guides.js")),
        (os.path.join(BASE, "build_guides.py"), os.path.join(export, "build_guides.py")),
        (os.path.join(BASE, "apply_dongliao.js"), os.path.join(export, "apply_dongliao.js")),
        (os.path.join(BASE, "build_dongliao.py"), os.path.join(export, "build_dongliao.py")),
        (os.path.join(BASE, "build_ebook.py"), os.path.join(export, "build_ebook.py")),
        (os.path.join(BASE, "guides", "module_guides.json"), os.path.join(export, "guides", "module_guides.json")),
        (os.path.join(BASE, "guides", "vol_guides.json"), os.path.join(export, "guides", "vol_guides.json")),
        (os.path.join(BASE, "guides", "dongliao.json"), os.path.join(export, "guides", "dongliao.json")),
        (os.path.join(BASE, "ebook", "慧客堂·学习手册.epub"), os.path.join(export, "ebook", "huiketang-handbook.epub")),
        (os.path.join(BASE, "ebook", "慧客堂·逐字稿全集.epub"), os.path.join(export, "ebook", "huiketang-transcripts.epub")),
        (os.path.join(BASE, "ebook", "慧客堂·学习手册.txt"), os.path.join(export, "ebook", "huiketang-handbook.txt")),
        (os.path.join(BASE, "ebook", "导入微信读书.txt"), os.path.join(export, "ebook", "import-wechat-reading.txt")),
        (os.path.join(BASE, "ebook", "慧客堂·学习手册.epub"), os.path.join(export, "dist", "ebook", "huiketang-handbook.epub")),
        (os.path.join(BASE, "ebook", "慧客堂·逐字稿全集.epub"), os.path.join(export, "dist", "ebook", "huiketang-transcripts.epub")),
        (os.path.join(BASE, "ebook", "慧客堂·学习手册.txt"), os.path.join(export, "dist", "ebook", "huiketang-handbook.txt")),
        (os.path.join(BASE, "ebook", "导入微信读书.txt"), os.path.join(export, "dist", "ebook", "import-wechat-reading.txt")),
    ]
    for n in new_ns:
        for sub, ext in (("transcripts", ".txt"), ("transcripts", ".json"), ("ep_meta", ".json"), ("ep_content", ".json")):
            copies.append((os.path.join(BASE, sub, f"{n}{ext}"), os.path.join(export, sub, f"{n}{ext}")))
    for folder in ("summaries", "fp"):
        src_dir = os.path.join(BASE, folder)
        if os.path.isdir(src_dir):
            for name in sorted(os.listdir(src_dir)):
                if name.endswith(".json"):
                    copies.append((os.path.join(src_dir, name), os.path.join(export, folder, name)))

    changed = []
    planned = []
    would_change = []
    for src, dst in copies:
        if not os.path.exists(src):
            continue
        planned.append(os.path.relpath(dst, export).replace("\\", "/"))
        if args.dry_run:
            if not same_file(src, dst):
                would_change.append(os.path.relpath(dst, export).replace("\\", "/"))
            continue
        if copy_file(src, dst):
            changed.append(os.path.relpath(dst, export).replace("\\", "/"))

    readme = os.path.join(export, "README.md")
    old_count = len(repo_data.get("episodes") or [])
    new_count = len(episodes)
    old_wan = (repo_data.get("podcast") or {}).get("transcriptWan", "")
    new_wan = (data.get("podcast") or {}).get("transcriptWan", "")
    if not args.dry_run and update_readme(readme, old_count, new_count, old_wan, new_wan):
        if "README.md" not in changed:
            changed.append("README.md")
    if not args.dry_run and os.path.exists(readme):
        readme_dirty = run(["git", "diff", "--quiet", "--", "README.md"], cwd=export, check=False).returncode != 0
        if readme_dirty and "README.md" not in changed:
            changed.append("README.md")

    if args.dry_run:
        log(json.dumps({
            "pushed": False,
            "dry_run": True,
            "new": [{"n": e.get("n"), "label": e.get("label"), "title": e.get("title")} for e in new_eps],
            "total": new_count,
            "files": sorted(set(planned)),
            "would_change": sorted(set(would_change)),
        }, ensure_ascii=False, indent=1))
        return 0

    if not changed and not new_ns:
        log(json.dumps({"pushed": False, "reason": "no_changes", "total": new_count}, ensure_ascii=False))
        return 0

    paths = sorted(set(changed))
    run(["git", "add", "--"] + paths, cwd=export)
    staged = run(["git", "diff", "--cached", "--name-only"], cwd=export).stdout.strip()
    if not staged:
        log(json.dumps({"pushed": False, "reason": "nothing_staged", "total": new_count}, ensure_ascii=False))
        return 0

    if new_eps:
        names = "、".join(f"{(e.get('label') or '')} {e.get('title') or ''}".strip() for e in new_eps[:3])
        title = f"新增慧客堂 {len(new_eps)} 期：{names}"
        if len(new_eps) > 3:
            title += " 等"
    else:
        title = "更新慧客堂学习手册的构建与每日流程"
    body = [
        f"- 总期数：{new_count}",
        f"- 逐字稿：{new_wan} 万字",
        f"- 精读：{sum(1 for e in episodes if len(e.get('analysis') or []) >= 2)} 期",
        f"- 新增：{', '.join(str(n) for n in new_ns) if new_ns else '无（流程更新）'}",
        "- 线上：https://hkt-3x1jbx9p8pj.qoder.zone/",
    ]
    if args.message:
        body.append(args.message)

    run(["git", "commit", "-m", title, "-m", "\n".join(body)], cwd=export)
    commit = run(["git", "rev-parse", "--short", "HEAD"], cwd=export).stdout.strip()

    ok, last_err = push_with_retry(export)
    if ok:
        log(json.dumps({
            "pushed": True,
            "commit": commit,
            "new": new_ns,
            "total": new_count,
            "remote": f"github.com/geonsme/huiketang-study-handbook ({BRANCH})",
        }, ensure_ascii=False))
        return 0

    log(json.dumps({
        "pushed": False,
        "reason": "push_failed",
        "commit": commit,
        "error": last_err[-800:],
    }, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())
