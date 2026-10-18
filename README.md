# 慧客堂 · 学习手册

把播客《慧客堂》111 期整理成一本手机端学习手册：按 Vol 与按模块两条主线，含逐字稿原文摘录、精读分析、官方 Shownotes、完整时间轴和 350.8 万字逐字稿。

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
| `ep_meta/` | 每期标题、Shownotes、章节、标签 |
| `ep_content/` | 视角改写前的节目内容快照 |
| `meta.js` | 模块、原则、路径、书单、术语表 |
| `template-v2.html` | 页面模板（单文件 HTML 的源模板） |
| `build-v2.js` | 把 `data-v2.json` 注入模板，生成 `index.html` |
| `update_daily.py` | 每日 RSS 检查、下载、转写、增量写入、构建 |
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
6. 运行 `finalize_new.js`、`build-v2.js`，更新 `dist/index.html`

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
