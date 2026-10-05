# 《网球运动系统训练》阅读版导入

原始文件为 `网球运动系统训练13800928.pdf`，共211页。前210页是1797×2639的扫描图，第211页是转换工具生成的书签索引。正文纸书页码等于PDF页码减4。本次导入保留原书正文、作者介绍、前言、致谢、版本信息、封底、72个训练动作和原动作索引，整理为93个独立阅读小节；重复的前置页面合并到书籍资料与在线目录。

## 输出与数据边界

- `data/books/tennis-system-training/book.json`：书籍资料。
- `data/books/tennis-system-training/chapters/`：带章组和纸书页码的Markdown正文。
- `data/books/tennis-system-training/images/`：从原始嵌入图裁切的插图、封面和一幅经Image-2清晰化的步法场地图；该图的原截图也保留。60项动作的原书击球类别图标也单独裁切。
- `data/books/tennis-system-training/extraction.json`：来源PDF哈希、章节范围、每幅图的裁切坐标及OCR排除记录。
- `data/books/tennis-system-training/image-repairs.json`：生成图的参考来源、提示词、输入输出哈希与核对记录。
- `data/imports/tennis-system-training/`：保留位置的原始OCR、人工核对的裁图计划、文字修正、表格转写、原索引数字和生成图，供重建阅读版使用。

`data/books/`中的阅读版书籍会提交到Git；`data/imports/`中的原始OCR、校对材料和图片生成记录由Git忽略，应单独备份。克隆仓库可以取得完整阅读版，但不能重建这本书的导入过程。原PDF保持不变。

## 排版与校对方法

每个训练动作按原文的“进行步骤、参与的肌肉、网球训练要点、变化动作”排列。原书绕图排版的正文先合成完整段落，再插入原图；动作步骤保持编号和跨页顺序。表10.1跨原书180–182页，11种损伤改为逐项阅读的条目，保留身体部位、症状、原因、预防和治疗等原始列内容。

正文仅修复对照扫描确认的OCR误识。72个动作标题、主步骤中的方向、数字和单位、原索引数字、损伤表及封底推荐人信息已核对；全书叙述仍未逐字校对。原书本身的缺字、重量单位“英镑”及方向疑点保留在正文，另设编者注。索引保留原书的名称和数字，同时列出实际正文页码并链接到对应动作。

原扫描是灰度图，不能可靠恢复原版肌群颜色。解剖图保留原截图和肌肉标注，不用生成图推断解剖信息。原书第171页“十字交叉步法训练的场地设置”有明显透字与低对比度，使用原图和限制几何、编号、网线与文字的提示进行清晰化；页面标明Image-2并提供原截图链接。

## 重建现有阅读版

需要Python、`pymupdf`、`Pillow`。下列路径以项目根目录为当前目录，原PDF仍在用户下载目录。脚本不加载`.env.local`，其他数据目录应传`--data-dir`。

```bash
python3 scripts/import-training-book.py \
  --pdf '/Users/wj/Downloads/网球运动系统训练13800928.pdf' \
  --ocr-dir data/imports/tennis-system-training/ocr \
  --figure-plan data/imports/tennis-system-training/figure-plan.json \
  --corrections data/imports/tennis-system-training/text-corrections.json \
  --injury-table data/imports/tennis-system-training/injuries-table.md \
  --index-pages data/imports/tennis-system-training/index-pages.json \
  --restored-diagram data/imports/tennis-system-training/footwork-court-clear.png \
  --repair-prompt data/imports/tennis-system-training/repair-prompt.txt

npm run check-content
```

导入脚本重写该书生成的章节与图片，应在手工编辑正文之前重建，或先备份编辑后的目录。它不改动第一本书。

## 从扫描重新识别

`scripts/ocr-scanned-pages.swift`在macOS上调用Apple Vision，以中文和英文识别，并记录每行位置和置信度。先按原分辨率抽出前210页的嵌入图到一个暂存目录，命名`page-001.jpg`至`page-210.jpg`；不要把第211页书签当正文。然后运行：

```bash
swiftc scripts/ocr-scanned-pages.swift -o /tmp/tennis-ocr
/tmp/tennis-ocr /path/to/page-images /path/to/ocr-json
```

OCR工具跳过已有JSON，需重新识别时先使用新的输出目录。文字识别不能代替图文阅读顺序核验；本书裁图计划和人工表格转写针对这个特定扫描版本。

## Vercel部署

部署会从Git提交中读取`data/books/`。重新导入这本书后，运行`npm run check-content`，检查变更并提交、推送；Vercel 会自动部署新的书籍内容。线上站点只读，不需要Blob或迁移脚本。`data/imports/`不会部署，仍需本地备份。具体步骤见[README](../README.md#vercel-部署)。

跨书整合的后续编辑方案见[新手版提案](beginner-edition-plan.md)。原书阅读版与未来整合版应分别保留。
