# 慧客堂学习手册 · Agent 阅读指南

> 给其他 Agent 直接阅读的项目说明。最后更新：2026-10-18。
> 站点作者是《慧客堂》的一位老听众，不是主播本人。

## 0. 一眼看懂

```json
{
  "site": "https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/",
  "access": "public",
  "language": "zh-CN",
  "podcast": "慧客堂",
  "host": "董艺婷",
  "episodes": 111,
  "modules": 8,
  "vol_guides": 111,
  "dongliao": 111,
  "rss": "https://feed.xyzfm.space/7neh8whbtc9w"
}
```

- 在线站点：https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/
- 公开 GitHub 快照：https://github.com/geonsme/huiketang-study-handbook
- 电子书下载：
  - https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/ebook/huiketang-handbook.epub
  - https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/ebook/huiketang-transcripts.epub
  - https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/ebook/huiketang-handbook.txt

## 1. 这是什么

把播客《慧客堂》从开篇到最新一期整理成一本手机端学习手册：

- 8 篇章节大导读，每篇含钩子、3 个带读问题、3 个读后能力、3 期建议路线。
- 111 篇 Vol 导读，每篇含 2 句开场、一个带读问题、3 个关键词。
- 111 条“董了”观点：原文引句 + 上下文 + 批判性边界 + 点睛。
- 每期精读、核心要点、原文摘录、官方 Shownotes、时间轴。
- 全量逐字稿，约 350.8 万字。
- EPUB / TXT 电子书，可导入微信读书。

站点级文案（品牌、Hero、首页推荐语、关于）使用听众视角；播客正文、导读、精读和“董了”里的第一人称“我”代表主播董艺婷，不代表站点作者。**不要把这个站点说成董艺婷本人维护的。**

## 2. 页面入口

| 页面 | 地址 |
| --- | --- |
| 首页 / 学习路径 | `/` |
| 八章导读 | `/#/modules` |
| 单章 | `/#/module/m1` … `/#/module/m8` |
| 按 Vol 浏览 | `/#/episodes` |
| 单期 | `/#/vol/1` … `/#/vol/111` |
| 我的学习 / 关于 | `/#/me` |
| Agent 指南 | `/README.agent.md` |

首页可按“董了”筛选：`/#/episodes` 后点击“董了”标签。

模块页不是长文堆叠，固定四块：**对话现场**（3 个“听友之问 → 节目原声 → 旁白”回合）、**观点推演**（起点 / 转折 / 落点 + 边界）、**现场切片**（3 个故事）、**带走**（3 件可勾选的事）。每块的源数据在模块对象的 `thread / scenes / deduction / sceneCases / takes` 字段。

## 3. 数据契约

### 主要文件

| 文件 | 说明 |
| --- | --- |
| `data-v2.json` | 主数据；页面、电子书、GitHub 快照都从它生成 |
| `transcripts/{n}.json/.txt` | 第 n 期逐字稿；chunks 的 `t` 是 60 秒段首时间戳 |
| `guides/vol_guides.json` | 111 篇 Vol 导读源数据 |
| `guides/module_guides.json` | 8 篇章节大导读源数据 |
| `guides/dongliao.json` | 111 条“董了”源数据 |
| `module_scenes.json` | 8 个模块的对话切片、观点推演、现场与行动源数据 |
| `apply_module_scenes.js` | 把模块切片合并进 `data-v2.json`，并校验数量与 ep 引用 |
| `summaries/batch*.json` | 分批精读结果；新增期写入 `batch_auto_YYYYMMDD.json` |
| `template-v2.html` | 单文件页面模板与渲染逻辑 |
| `module-story.css` | 模块页专属样式，构建时注入模板 |
| `build-v2.js` | 注入模块 CSS 与 `data-v2.json`，生成最终 HTML |
| `build_ebook.py` | 生成两本 EPUB 和一本 TXT |
| `site_config.json` | Qoder Site 的 siteRoot / projectId / siteId / 域名；本机配置，不入库 |
| `sync_github.py` | 有新增时把白名单内容提交到公开 GitHub 仓库 |

### Episode 关键字段

```text
n, label, title, date, duration, seconds, tags, mods
summary, line, points, analysis[], quotes[], case, keywords[]
chapters[], paras[], transcript.chunks[[t, text]], transcriptChars
guide { hook, question, keywords[3] }
dongliao { title, quote, t, context, critique, insight }

Module 关键字段：
thread[3], scenes[3] { q, a, src, t, ep, note },
deduction { premise, turn, landing, boundary },
sceneCases[3] { title, line, ep }, takes[3]
```

### 内容规则

1. `quotes[].t` 与 `dongliao.t` 必须能在该期 `transcripts/{n}.json` 的 chunks 里找到。
2. 引文尽量贴原文，只修明显 ASR 错字；不要为了第一人称改写引文。
3. 播客正文的主理人观点用“我”；嘉宾、书中人物、市场参与者保留第三人称。
4. 站点级文案用听众视角；首页推荐语不要写“我用 / 我请 / 我教你”，写成“这一期讲 / 董艺婷用 / 适合……”。
5. “董了”不是金句卡：context 要放回语境，critique 要写出假设、边界和反例，insight 才能点睛。
6. 不编造数字、年份、人物关系；ASR 不确定时换一句更确定的原文。

## 4. 对 Agent 的使用建议

- 回答内容问题时，优先读取 `data-v2.json`，不要从页面截图猜。
- 引用原文时带上 `label` 和时间戳，例如：`Vol.15 · 35:24`。
- 需要“为什么读”时，用 `guide.hook`；需要“批判性观点”时，用 `dongliao`；需要完整上下文时，用 `analysis` 和 `transcripts/{n}.txt`。
- 电子书和网页内容同源；电子书阅读版不含完整逐字稿，逐字稿在单独的 EPUB。
- 不要声称站点内容经主播本人审订；手册是听众的学习整理。

## 5. 维护流程（有写权限的 Agent）

在项目根目录执行：

```bash
# 1. 检查 RSS 新增
python update_daily.py --check

# 2. 检查缺逐字稿/精读/导读/董了的期数
python <skill-dir>/scripts/list_pending.py

# 3. 有新期时下载 + 本地 Paraformer 转写
python update_daily.py

# 4. 为新增期写 summaries/batch_auto_YYYYMMDD.json
#    必须包含 analysis / quotes / guide / dongliao

# 5. 增量应用与构建
node apply_summaries.js
node apply_firstperson.js
node finalize_new.js
node apply_guides.js
node apply_module_scenes.js   # 仅当 module_scenes.json 有改动
node build-v2.js

# 6. 重新生成电子书
python build_ebook.py

# 7. 发布前验证
python <skill-dir>/scripts/verify_build.py

# 8. 有新增时自动提交 GitHub
python sync_github.py
```

发布用 Qoder Sites MCP：`prepare_site` → 轮询 `get_publish_status` 到 `canPublish=true` 且 `deployment.state=ready` → `publish_site` → 再验证 `published=true` → `show_publish_confirmation`。参数从 `site_config.json` 读取；站点保持 public。

> 本机 Python 使用 miniconda 的解释器，`python` 可能是 Windows 商店桩；具体路径见本机 `huiketang-daily-update` Skill。所有命令都在项目根目录执行。

**写入前先读完整 Skill**：`huiketang-daily-update`（本机 Qoder 用户级 Skill）。它包含逐字稿精读、导读/董了字段、构建、验证、发布和 GitHub 自动提交的详细规则。

## 6. 不要做

- 不要重跑 111 期全量转写；不要删除历史逐字稿、精读、导读或董了。
- 不要把站点说成主播本人维护，也不要把嘉宾改成“我”。
- 不要在没有通过 `verify_build.py` 的情况下发布。
- 不要把 `site_config.json`、token、音频、WAV、模型、日志提交到公开仓库或公开站点。
- 不要手工改 EPUB；用 `build_ebook.py` 重新生成。
- 不要 force push；GitHub 推送失败时保留线上站点并报告。

## 7. 已知限制

- 逐字稿是本地 Paraformer 机器转写，可能有错字；时间戳为 60 秒段首，约一分钟误差。
- 页面是单文件 HTML，数据内嵌，文件约 12MB；首次打开可能稍慢。
- 学习进度、收藏、笔记保存在浏览器 localStorage，不跨设备同步。
- 公开 GitHub 仓库是内容快照，不是站点运行依赖。

## 8. 机器可读小结

```json
{
  "canonical_site": "https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/",
  "public": true,
  "agent_readme": "https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/README.agent.md",
  "repo": "https://github.com/geonsme/huiketang-study-handbook",
  "repo_visibility": "public",
  "rss": "https://feed.xyzfm.space/7neh8whbtc9w",
  "data": "data-v2.json",
  "build": ["node build-v2.js", "python build_ebook.py"],
  "verify": "scripts/verify_build.py",
  "site_config": "site_config.json",
  "voice": {
    "host_content": "first-person 我 = 董艺婷",
    "site_level": "listener voice; not the host"
  }
}
```
