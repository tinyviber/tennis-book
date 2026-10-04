# 《网球压力训练》上下册阅读版

上册与下册在阅读器中合为《网球压力训练》一册，保留原书印刷页码1–241。阅读顺序为上册前言、作者介绍与目录，然后第一至第十一章。第六章从上册印刷页63连续到下册印刷页131；下册PDF前14页（印刷页118–131）仍属第六章，不单独成章。

## 来源与整理

- 原始文件：`data/imports/tennis-pressure-training/source-upper.pdf` 与 `source-lower.pdf`，各124页。原下载文件名为 `网球压力训练_上册.pdf`、`网球压力训练_下册.pdf`。
- 页码映射：上册PDF第8–124页对应印刷页1–117（印刷页=PDF页−7）；下册PDF第1–124页对应印刷页118–241（印刷页=PDF页+117）。上册PDF第1–7页为书名页、前言、作者介绍和目录。
- 阅读版章节位于 `data/books/tennis-pressure-training/chapters/`；书籍资料在 `book.json`，图像与裁切、页码和PDF哈希记录在 `images/` 与 `extraction.json`。
- 扫描页、Vision OCR JSON及逐册审阅草稿保存在 `data/imports/tennis-pressure-training/`。在装有Pillow的Python环境中运行 `python3 scripts/assemble-pressure-training.py` 可重建章节和成绩表截图；该脚本会覆盖章节文件，手工修改前先备份。
- 正文来自逐页扫描OCR，统一为简体中文。照片、插图和训练路线图均取自原扫描页；没有用生成图替换原图。

## 表格与校对边界

下册PDF第70–76页（印刷页187–193）的训练成绩表存在大量OCR漏格、错位和误识。阅读版将七页的表格数据以原页裁图呈现，不把不完整的OCR表格当作准确转写；周围说明文字保留为可搜索正文。其余正文只修正能由扫描确认的OCR错误，练习方向、数字、单位和人名仍应结合原页核读，正文未逐字校完。各册审阅报告列出置信度与待核页码。

这组书的原图是灰度印刷扫描，路线图线条和照片均可辨认，无需生成替代插图。

书籍正文、源PDF与扫描图都位于Git忽略的 `data/` 目录中；Git提交只包含导入脚本和本文档。备份应包含整个 `data/`，仅克隆仓库无法取得阅读版内容。发布到Vercel前，按[README中的Vercel说明](../README.md#vercel-部署)迁移书籍数据。

导入后可运行：

```bash
npm run check-content
```
