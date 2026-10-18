# 慧客堂 · 学习手册

把播客《慧客堂》111 期整理成一本手机端学习手册：8 篇章节大导读、111 篇 Vol 导读、逐字稿原文摘录、精读分析、官方 Shownotes、完整时间轴和 350.8 万字逐字稿。另有可导入微信读书的 EPUB / TXT 电子书。

- 在线版：https://huiketang-study-notes-3x1jbx9p8pj.qoder.zone/
- 本地版：打开根目录 `index.html`，或 `dist/index.html`

## 内容结构

| 路径 | 说明 |
| --- | --- |
| `index.html` | 手机端学习手册（单文件，数据已内嵌） |
| `dist/index.html` | 部署用静态输出，内容与根目录一致 |
| `data-v2.json` | 主数据：111 期、模块、精读、逐字稿、引文 |
| `transcripts/` | 111 期逐字稿（txt + json，带 60 秒时间戳） |
| `summaries/` | 各批次的节目摘要、要点、引文、分析 |
| `fp/` | 第一人称视角改写层：只改主播叙述，嘉宾与原话保持原意 |
| `guides/` | 8 篇章节大导读与 111 篇 Vol 导读的源数据 |
| `apply_guides.js` | 把 `guides/*.json` 合并进 `data-v2.json` |
| `build_guides.py` | 生成 8 篇章节导读与 111 篇 Vol 导读 |
| `build_ebook.py` | 生成学习手册 EPUB、逐字稿全集 EPUB 与 TXT |
| `ebook/` | 可直接导入微信读书的电子书文件 |
| `ep_meta/` | 每期标题、Shownotes、章节、标签 |
| `ep_content/` | 视角改写前的节目内容快照 |
| `meta.js` | 模块、原则、路径、书单、术语表 |
| `template-v2.html` | 页面模板（单文件 HTML 的源模板） |
| `build-v2.js` | 把 `data-v2.json` 注入模板，生成 `index.html`，并按本机 `site_config.json` 同步到 Qoder Site 目录 |
| `update_daily.py` | 每日 RSS 检查、下载、转写、增量写入、生成草稿构建 |
| `transcribe_all.py` | Paraformer 批量转写流水线 |

## 重新构建

```bash
node build-v2.js
```

生成 `慧客堂·学习手册-v2.html`，再复制为 `index.html` / `dist/index.html`。

## 每日更新

`update_daily.py` 会：

1. 拉取 RSS：`https://feed.xyzfm.space/7neh8whbtc9w`
2. 用 guid/link 对比 `data-v2.json`，找出新增期
3. 下载音频、转 16k 单声道 WAV
4. 用 Paraformer-zh int8 + CT-Transformer 标点转写
5. 增量写入 `data-v2.json`、`ep_meta/`、`transcripts/`
6. 运行 `finalize_new.js`，先生成一份本地草稿

随后 Qoder 自动化会基于完整逐字稿写精读，并为每一期新节目写 `guide`（hook、带读问题、3 个关键词）；依次运行 `apply_summaries.js`、`apply_firstperson.js`、`finalize_new.js`、`build-v2.js`，再发布到 Qoder Sites。

### 导读结构

- **章节大导读**：每个模块开头有钩子、3 个带读问题、3 个读后能力、3 期建议路线；首页「八章导读」可直接进入。模块页带一张 4 步“本章脉络”纵向流程图。
- **Vol 小导读**：每期标题下有 2 句开场、一个带读问题和 3 个关键词；节目列表也会显示导读首句。Vol 页带一张“问题 → 判断 → 展开线索”的 3 步脉络图。
- 章节导读源数据在 `guides/module_guides.json`；Vol 导读源数据在 `guides/vol_guides.json`。新增期的导读写在当天的 `summaries/batch_auto_*.json` 里，由 `apply_summaries.js` 一起写入。

### GitHub 自动提交

每天确认有新一期、且逐字稿/精读/引文/导读完整并通过发布前检查后，自动化会自动把白名单内容 commit 并 push 到本仓库 `main`，不需要人工审批。没有新增时不产生空提交；音频、WAV、模型、日志和本机站点配置不入库。

## 电子书

`ebook/` 下有三份可导入微信读书的文件：

- `慧客堂·学习手册.epub`：导读、核心要点、精读、原文摘录、Shownotes、章节大导读和附录。
- `慧客堂·逐字稿全集.epub`：111 期完整逐字稿，60 秒段首时间戳。
- `慧客堂·学习手册.txt`：UTF-8 TXT，兼容备份。

网页版也在首页提供下载：`ebook/huiketang-handbook.epub`、`ebook/huiketang-transcripts.epub`、`ebook/huiketang-handbook.txt`。

导入方式：微信读书 → 书架右上角「+」→ 从本地导入（安卓）或从 iCloud / 文件导入（iOS）；也可以把文件发到微信文件传输助手，点开 → 用其他应用打开 → 微信读书。推荐 EPUB，保留封面和目录。电子书由 `build_ebook.py` 从 `data-v2.json` 自动生成，内容更新后不要手工改文件，重新运行脚本即可。

依赖：

```bash
pip install sherpa-onnx numpy
```

系统需要 `ffmpeg`。模型目录未入库（体积原因），需要放到项目根目录：

- `sherpa-onnx-paraformer-zh-2024-03-09/`
- `sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12/`

每日定时任务由本机 Qoder Automation 触发；仓库只保存脚本，不包含本机任务配置。

## 视角与版权

- 叙述视角：主播董艺婷统一为第一人称“我”；节目里原本对嘉宾、他人的第三人称保留，不强行改写。
- 原话引文、官方 Shownotes、逐字稿保持原文；逐字稿是机器转写，保留口语和少量错字，时间戳为 60 秒段首，约一分钟误差。
- 播客内容版权归《慧客堂》/主播董艺婷所有；本仓库用于个人学习与检索，不用于商业再分发。

## 未入库内容

音频、WAV、ASR 模型、压缩包和日志体积过大，未提交到 Git。需要复现时按上面说明下载模型并用 `transcribe_all.py` 重新生成。
