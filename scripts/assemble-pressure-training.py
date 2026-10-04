#!/usr/bin/env python3
"""Assemble the two OCR review drafts into the combined reader edition."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMPORT = ROOT / "data/imports/tennis-pressure-training"
BOOK = ROOT / "data/books/tennis-pressure-training"
CHAPTERS = BOOK / "chapters"
IMAGES = BOOK / "images"

CHAPTERS_INFO = [
    ("一", "网球训练的制胜规律", "01-winning-principles", 1, 14),
    ("二", "在训练中付诸压力", "02-pressure-in-training", 15, 22),
    ("三", "高成功率战术", "03-high-percentage-tactics", 23, 48),
    ("四", "场上的站位和击球的选择", "04-position-and-shot-selection", 49, 56),
    ("五", "战术教学", "05-teaching-tactics", 57, 62),
    ("六", "单打练习", "06-singles-practice", 63, 131),
    ("七", "双打练习", "07-doubles-practice", 132, 173),
    ("八", "热身训练", "08-warmups", 174, 185),
    ("九", "训练成绩指标", "09-performance-metrics", 186, 199),
    ("十", "压力训练的计划", "10-planning", 200, 206),
    ("十一", "实施压力训练计划", "11-implementation", 207, 241),
]

PHOTO_MARKERS = {
    "upper": {
        "<!-- 原图（作者肖像）：PDF第004页 -->": ("photo-author-portrait.webp", "作者肖像"),
        "<!-- 原图（无图号）：PDF第013页 -->": ("photo-upper-competitive-focus.webp", "比赛专注照片"),
        "<!-- 原图（无图号）：PDF第057页 -->": ("photo-upper-positioning.webp", "场上站位照片"),
    },
    "lower": {
        87: ("photo-lower-warmup.webp", "热身训练照片"),
        88: ("photo-lower-match.webp", "赛前比赛照片"),
    },
}

# Crop bounds are normalized [left, top, right, bottom] from each lower scan.
# These pages contain dense score data that OCR cannot preserve reliably.
TABLE_PAGES = {
    70: (187, [0.115, 0.415, 0.89, 0.805]),
    71: (188, [0.115, 0.14, 0.89, 0.95]),
    72: (189, [0.115, 0.495, 0.89, 0.855]),
    73: (190, [0.115, 0.105, 0.89, 0.885]),
    74: (191, [0.115, 0.105, 0.89, 0.90]),
    75: (192, [0.115, 0.105, 0.89, 0.89]),
    76: (193, [0.115, 0.105, 0.89, 0.535]),
}

BAD_HEADING = re.compile(r"^#{2,3} (US|、EVENT|」P2|•|gineke）|2|字题|、|◎|③)\s*$")
FLATTEN_HEADING = re.compile(
    r"^#{2,3} (在比赛中都能带动对方发挥出最高水平|—接发球|张德培在底线外的击球|桑切斯|一接发球|发球 P1|正手内|角斜线|练习 3｜分钟，总共练习 12分钟。这种表示方法主要用于截击)\s*$"
)


def split_chapters(text: str) -> dict[str, str]:
    actual = {}
    for numeral, title, _, _, _ in CHAPTERS_INFO:
        heading = f"## 第{numeral}章 {title}"
        pos = text.find(heading)
        if pos >= 0:
            actual[numeral] = (pos, pos + len(heading), title)
    result = {}
    ordered = sorted(actual.items(), key=lambda item: item[1][0])
    for index, (numeral, (_, body_start, title)) in enumerate(ordered):
        body_end = ordered[index + 1][1][0] if index + 1 < len(ordered) else len(text)
        result[numeral] = text[body_start:body_end].strip()
    return result


def write_table_crops() -> list[dict]:
    from PIL import Image

    records = []
    for pdf_page, (printed_page, bounds) in TABLE_PAGES.items():
        source = IMPORT / f"scans/lower/page-{pdf_page:03d}.jpg"
        image = Image.open(source).convert("RGB")
        width, height = image.size
        left, top, right, bottom = bounds
        box = (round(left * width), round(top * height), round(right * width), round(bottom * height))
        out_name = f"table-page-{printed_page}.webp"
        image.crop(box).save(IMAGES / out_name, "WEBP", quality=92, method=6)
        records.append({
            "file": out_name,
            "sourceVolume": "lower",
            "sourcePDFPage": pdf_page,
            "printedPage": printed_page,
            "cropNormalized": bounds,
            "width": box[2] - box[0],
            "height": box[3] - box[1],
            "caption": "原书成绩表页面裁图",
            "method": "原扫描页裁图；OCR表格行由图像保留",
        })
    return records


def append_block(output: list[str], lines: list[str]) -> None:
    if output and output[-1].strip():
        output.append("")
    output.extend(lines)
    if output[-1].strip():
        output.append("")


def process_body(text: str, volume: str, figure_by_number: dict[int, dict]) -> str:
    output: list[str] = []
    source_pdf_page: int | None = None
    inserted_table_pages: set[int] = set()
    number_to_group = {number: item for item in figure_by_number.values() for number in item["figureNumbers"]}

    for line in text.splitlines():
        marker = re.search(r"来源：PDF第0*(\d+)页", line)
        if marker:
            source_pdf_page = int(marker.group(1))
            if volume == "upper" and source_pdf_page == 17:
                append_block(output, [
                    "![击球选择照片](../images/photo-upper-shot-selection.webp \"原书印刷页10\")",
                ])
            if volume == "lower" and source_pdf_page in PHOTO_MARKERS["lower"]:
                filename, label = PHOTO_MARKERS["lower"][source_pdf_page]
                append_block(output, [f"![{label}](../images/{filename} \"原书印刷页{source_pdf_page + 117}\")"])
            continue

        figure_marker = re.fullmatch(r"<!--FIGURE:(\d+)-->", line.strip())
        if figure_marker:
            figure_number = int(figure_marker.group(1))
            group = number_to_group.get(figure_number)
            if group and max(group["figureNumbers"]) == figure_number:
                numbers = "、".join(str(n) for n in group["figureNumbers"])
                page = group["printedPage"]
                append_block(output, [
                    f"![原书插图：图{numbers}](../images/{group['file']} \"原书第{page}页\")",
                ])
            continue

        if volume == "upper" and line in PHOTO_MARKERS["upper"]:
            filename, label = PHOTO_MARKERS["upper"][line]
            append_block(output, [f"![{label}](../images/{filename})"])
            continue

        if line.startswith("<!-- 待核对："):
            continue

        if volume == "lower" and source_pdf_page in TABLE_PAGES and line.lstrip().startswith("|"):
            if source_pdf_page not in inserted_table_pages:
                printed_page = TABLE_PAGES[source_pdf_page][0]
                filename = f"table-page-{printed_page}.webp"
                append_block(output, [
                    f"**原书成绩表（第{printed_page}页）**",
                    "",
                    f"![原书训练成绩表，印刷页{printed_page}](../images/{filename} \"原书第{printed_page}页\")",
                ])
                inserted_table_pages.add(source_pdf_page)
            continue

        if BAD_HEADING.fullmatch(line):
            continue
        if FLATTEN_HEADING.fullmatch(line):
            line = re.sub(r"^#{2,3} ", "", line)
        elif line.startswith("## 第二章 已经提到网球技战术教学中的三阶段教学方式："):
            line = line.removeprefix("## ")

        output.append(line)

    body = "\n".join(output)
    body = re.sub(r"(?m)^([ \t]*\d+)\.(?=\S)", r"\1. ", body)
    body = re.sub(r"(?m)^([ \t]*)•[ \t]?", r"\1- ", body)
    body = body.replace(
        "5. 复位还原。发球、接发球练习 成功地进行发球和接发球",
        "5. 复位还原。\n\n发球、接发球练习\n\n成功地进行发球和接发球",
    )
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body + "\n"


def chapter_file(title: str, order: int, group: str, body: str, page_start: int | None, page_end: int | None) -> str:
    fields = ["---", f"title: {title}", f"order: {order}", f"group: {group}"]
    if page_start is not None:
        fields.extend([f"pageStart: {page_start}", f"pageEnd: {page_end}"])
    fields.extend(["published: true", "---", ""])
    return "\n".join(fields) + body


def main() -> None:
    import json

    CHAPTERS.mkdir(parents=True, exist_ok=True)
    for chapter in CHAPTERS.glob("*.md"):
        chapter.unlink()
    metadata = json.loads((BOOK / "extraction.json").read_text(encoding="utf-8"))
    table_records = write_table_crops()
    metadata["tables"] = table_records
    metadata["figureCount"] = len(metadata["figures"]) + len(table_records)
    (BOOK / "extraction.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    figure_by_number = {n: item for item in metadata["figures"] for n in item["figureNumbers"]}
    upper_raw = (IMPORT / "draft-upper.md").read_text(encoding="utf-8")
    lower_raw = (IMPORT / "draft-lower.md").read_text(encoding="utf-8")
    upper_parts = split_chapters(upper_raw)
    lower_parts = split_chapters(lower_raw)

    chapter_index = upper_raw.find("## 第一章 网球训练的制胜规律")
    front = upper_raw[:chapter_index].split("<!-- 来源：PDF第001页 -->", 1)[-1].strip()
    front = front.replace("<!-- 来源：PDF第002页 -->", "").replace("<!-- 来源：PDF第003页 -->", "").replace("<!-- 来源：PDF第004页 -->", "")
    front = re.sub(r"^# 网球压力训练：上册导入草稿\s*> OCR 整理稿；以扫描页为准。\s*", "", front)
    front = front.replace("# 网球压力训练", "## 网球压力训练", 1)
    front = process_body(front, "upper", figure_by_number)
    (CHAPTERS / "01-front-matter.md").write_text(chapter_file("前言、作者与目录", 1, "导读", front, None, None), encoding="utf-8")

    filename_order = 2
    for numeral, title, slug, page_start, page_end in CHAPTERS_INFO:
        if numeral == "六":
            raw_body = upper_parts[numeral] + "\n\n" + lower_parts[numeral]
            volume = "merged"
        elif numeral in {"七", "八", "九", "十", "十一"}:
            raw_body = lower_parts[numeral]
            volume = "lower"
        else:
            raw_body = upper_parts[numeral]
            volume = "upper"

        # For the cross-volume chapter, process each half separately so the
        # lower-volume page-number mapping and its photographs/tables stay correct.
        if volume == "merged":
            body = process_body(upper_parts[numeral], "upper", figure_by_number)
            body += "\n" + process_body(lower_parts[numeral], "lower", figure_by_number)
        else:
            body = process_body(raw_body, volume, figure_by_number)
        chapter = chapter_file(title, filename_order, "正文", body, page_start, page_end)
        file_slug = slug.split("-", 1)[1]
        (CHAPTERS / f"{filename_order:02d}-{file_slug}.md").write_text(chapter, encoding="utf-8")
        filename_order += 1


if __name__ == "__main__":
    main()
