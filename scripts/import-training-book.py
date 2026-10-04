#!/usr/bin/env python3
"""Import the verified 2015 Chinese edition of Tennis Anatomy.

Inputs are macOS Vision OCR JSON, a visually checked crop plan, and editorial
corrections. The source PDF is read only. Body text is reflowed, never replaced
with full-page scans. Original printing errors are retained with editor notes.
Requires Python, PyMuPDF and Pillow. See docs/import-training-book.md.
"""
import argparse
import hashlib
import io
import json
import os
import re
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOOK_SLUG = 'tennis-system-training'
MANUAL_HEADINGS = {
    (18, '正反手击落地球'),
    (77, '击球和胸部运动'),
    (93, '击球与背部运动'),
    (128, '击球和腿部运动'),
}
# Page numbers below refer to the supplied PDF; printed pages are four lower.
GROUPS = [
    ('肩部', 'shoulder', 34, [
        (39, 'front-raise', '哑铃前平举'), (41, 'lateral-raise', '哑铃侧平举'),
        (43, 'bent-over-raise', '俯身哑铃抓举'), (45, 'scapular-retraction', '肘到臀的肩胛骨后缩运动'),
        (47, 'external-rotation', '外旋'), (49, 'abducted-external-rotation', '90/90外展外旋运动'),
        (51, 'abducted-internal-rotation', '90/90外展内旋运动'), (53, 'low-pull', '低拉力')]),
    ('手臂和手腕', 'arms', 55, [
        (60, 'triceps-pushdown', '肱三头肌拉力器下压'), (62, 'dip', '半屈伸'),
        (64, 'overhead-extension', '拉力器过顶臂屈伸'), (66, 'hammer-curl', '锤式哑铃屈臂'),
        (68, 'overhand-wrist-curl', '正握腕弯举'), (70, 'underhand-wrist-curl', '反握腕弯举'),
        (72, 'forearm-external-rotation', '前臂外旋'), (74, 'forearm-internal-rotation', '前臂内旋')]),
    ('胸部', 'chest', 76, [
        (79, 'push-up', '俯卧撑'), (81, 'standing-press', '站姿前推'),
        (83, 'bench-press', '平板卧推'), (85, 'incline-press', '上斜式推举'),
        (87, 'medicine-ball-chest-throw', '胸前扔健身实心球'), (89, 'dumbbell-fly', '哑铃扩胸')]),
    ('背部', 'back', 91, [
        (94, 'front-pulldown', '颈前下拉'), (96, 'rotating-pulldown', '转体下拉'),
        (98, 'seated-row', '坐姿划船'), (100, 'reverse-fly', '反式蝶机展肩'),
        (102, 'barbell-row', '俯身杠铃划船'), (104, 'deadlift', '硬拉')]),
    ('核心肌群和躯干', 'core', 106, [
        (109, 'bent-knee-sit-up', '屈膝仰卧起'), (111, 'side-crunch', '侧式卷腹'),
        (113, 'toe-touch-crunch', '触足卷腹'), (115, 'plank', '平板支撑'),
        (117, 'russian-twist', '俄罗斯式扭转'), (119, 'swimming', '游泳'),
        (121, 'snow-angel', '卧雪天使'), (123, 'back-extension', '俯卧两头起')]),
    ('腿部', 'legs', 125, [
        (129, 'squat', '深蹲'), (131, 'romanian-deadlift', '罗马尼亚硬拉'),
        (133, 'hamstring-bridge', '腿筋拉伸'), (135, 'lunge', '弓步下蹲'),
        (137, 'side-lunge', '侧弓步'), (139, 'diagonal-lunge', '45度弓步'),
        (141, 'crossover-lunge', '交叉弓步'), (143, 'box-jump', '跳箱'),
        (145, 'squat-jump', '深蹲跳'), (147, 'calf-raise', '提踵')]),
    ('转体强化训练', 'rotation', 149, [
        (151, 'cable-chop', '吊绳旋转削球'), (153, 'cable-lift', '吊绳旋转上推'),
        (155, 'rotating-dumbbell-snatch', '单臂旋转哑铃抓举'), (157, 'jump-shrug', '哑铃跳跃耸肩'),
        (159, 'overhead-squat', '过头深蹲'), (161, 'forehand-ball-throw', '正手健身实心球投掷'),
        (163, 'backhand-ball-throw', '反手健身实心球投掷'), (165, 'serve-ball-throw', '发球健身实心球投掷')]),
    ('步法训练', 'footwork', 167, [
        (169, 'side-shuffle', '侧滑步'), (171, 'crossover-shuffle', '交叉侧滑步'),
        (173, 'groundstroke-recovery', '击打落地球后回位'), (175, 'spider-drill', '十字交叉步法训练'),
        (177, 'split-step', '小碎步'), (179, 'walking-lunge', '跨步行走')]),
    ('常见的网球运动损伤', 'injuries', 181, [
        (187, 'calf-stretch', '小腿伸展'), (188, 'balance-board', '摇板站立平衡'),
        (190, 'side-ankle-walk', '侧脚踝行走'), (192, 'heel-walk', '脚后跟行走'),
        (193, 'kneeling-hip-flexor-stretch', '半跪姿髋屈肌伸展'), (195, 'tennis-ball-massage', '网球按摩'),
        (196, 'knee-to-chest-stretch', '仰卧抱膝伸展'), (197, 'supine-hamstring-stretch', '仰卧腘绳肌伸展'),
        (198, 'figure-four-stretch', '4字型伸展'), (200, 'forearm-extensor-stretch', '前臂伸肌拉伸'),
        (202, 'forearm-flexor-stretch', '前臂屈肌拉伸'), (204, 'shoulder-retraction-rotation', '肩部收缩外旋')]),
]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def sections():
    result = []

    def add(title, slug, group, start, end, kind='body'):
        result.append(dict(title=title, slug=f'{len(result)+1:02}-{slug}',
                           group=group, start=start, end=end, kind=kind))

    add('前言', 'preface', '导读', (9, .14), (10, 0))
    add('作者简介', 'authors', '导读', (7, .13), (8, 0))
    add('致谢', 'acknowledgements', '导读', (10, .14), (11, 0))
    intro = [
        ('运动中的网球运动员', 'player-in-motion', (11, .18), (12, .864)),
        ('打法和球场', 'playing-styles-and-courts', (12, .864), (17, .668)),
        ('网球击球方法与正反手落地球', 'groundstrokes', (17, .668), (23, .235)),
        ('发球和高球', 'serve-and-overhead', (23, .235), (27, .595)),
        ('截击', 'volley', (27, .595), (29, .847)),
        ('训练注意事项', 'training-principles', (29, .847), (34, 0)),
    ]
    for title, slug, start, end in intro:
        add(title, slug, '第1章 · 运动中的网球运动员', start, end)
    for i, (name, slug, first, exercises) in enumerate(GROUPS):
        group = f'第{i+2}章 · {name}'
        limit = GROUPS[i+1][2] if i+1 < len(GROUPS) else 206
        add(f'{name}：解剖与训练原则' if i < 6 else f'{name}：概述',
            f'{slug}-overview', group, (first, .18), (exercises[0][0], 0), 'overview')
        for j, (page, action_slug, title) in enumerate(exercises):
            end = exercises[j+1][0] if j+1 < len(exercises) else limit
            add(title, action_slug, group, (page, .14), (end, 0), 'exercise')
    add('动作索引', 'exercise-index', '附录', (206, .065), (210, 0), 'index')
    add('版本信息与内容提要', 'edition-information', '附录', (6, .045), (7, 0), 'edition')
    add('封底推荐与本书特点', 'back-cover', '附录', (210, .065), (211, 0), 'back-cover')
    return result


def overlaps(line, box):
    x0, y0, x1, y1 = line['box']
    bx0, by0, bx1, by1 = box
    area = max(0, min(x1, bx1) - max(x0, bx0)) * max(0, min(y1, by1) - max(y0, by0))
    return area / max((x1-x0)*(y1-y0), .000001) > .45


def join_text(left, right):
    # Chinese scan lines wrap without spaces; preserve English word boundaries.
    spacer = ' ' if left and right and re.search(r'[A-Za-z0-9]$', left) and re.match(r'[A-Za-z]', right) else ''
    return left + spacer + right


def clean_line(text):
    text = text.strip().replace('\u3000', ' ')
    # Only strip OCR debris from the section-heading terminator, not body claims.
    if re.fullmatch(r'.*(?:进行步骤|参与的肌肉|网球训练要点|变化动作)\s*[》＞>]*', text):
        text = re.sub(r'\s*[》＞>]+$', '', text)
    return text


def is_heading(line, previous):
    text = line['text']
    if re.search(r'(?:进行步骤|参与的肌肉|网球训练要点|变化动作)$', text):
        return True
    if text == '安全提示':
        return True
    # Source subheadings are short, flush left, and separated from prose.
    gap = line['box'][1] - previous['box'][3] if previous and line['page'] == previous['page'] else .1
    return (line['box'][0] <= .115 and len(text) <= 24 and
            not re.search(r'[。；：，、（）“”,.!?]|^\d|^主要肌群|^辅助肌群', text) and
            gap >= .01 and line['box'][3] - line['box'][1] >= .017)


def paragraph_blocks(lines, title, first_page):
    blocks = []
    text = ''
    first = last = previous = None
    paragraph_kind = 'prose'

    def flush():
        nonlocal text, first, last
        if text:
            blocks.append(dict(text=text, first=first, last=last))
        text = ''
        first = last = None

    for line in lines:
        value = line['text']
        if not value:
            continue
        # Main section headings already appear in the reader title.
        if not blocks and not text and line['page'] == first_page and value in {title, '前言', '作者简介', '致谢'}:
            continue
        variant_heading = previous and previous['text'] == '变化动作'
        heading = variant_heading or (line['page'], value) in MANUAL_HEADINGS or is_heading(line, previous)
        numbered = re.match(r'^(\d{1,2})(?:[.、．]\s*|\s+)(.+)', value)
        muscle = value.startswith(('主要肌群', '辅助肌群'))
        bullet = value.startswith(('•', '●'))
        new_page = previous and line['page'] != previous['page']
        gap = line['box'][1] - previous['box'][3] if previous and not new_page else 0
        indent = .122 <= line['box'][0] < .15
        ended = bool(re.search(r'[。！？】]$', text))
        # A body paragraph begins with a two-character first-line indent. Step
        # continuations use a larger indent and must stay within the same item.
        break_prose = text and paragraph_kind == 'prose' and ((indent and ended) or (gap > .035 and ended))
        after_short_list = (paragraph_kind == 'step' and first and len(text) < 30 and
                            not re.search(r'[。！？]$', text) and not numbered and
                            line['box'][0] < first['box'][0]+.015)
        if heading or numbered or muscle or bullet or break_prose or after_short_list:
            flush()
        if heading:
            blocks.append(dict(text=('#### ' if variant_heading else '### ') + value, first=line, last=line))
            paragraph_kind = 'prose'
        else:
            if numbered:
                value = numbered[1] + '. ' + numbered[2]
                paragraph_kind = 'step'
            elif muscle:
                paragraph_kind = 'muscle'
            elif bullet:
                value = '- ' + value.lstrip('•● ').strip()
                paragraph_kind = 'bullet'
            elif not text:
                paragraph_kind = 'prose'
            text = join_text(text, value)
            first = first or line
            last = line
        previous = line
    flush()
    if any(block['first'] and block['first']['page'] == 182 and 'W.B. Kibler' in block['text'] for block in blocks):
        citation = '（W.B. Kibler和M. Safran，2005年，“Tennis Injuries,” Medicine and Sport Science, 48: 120–137）'
        for block in blocks:
            if block['first'] and block['first']['page'] == 182 and 'W.B. Kibler' in block['text']:
                start = block['text'].find('（W.B. Kibler')
                end = block['text'].find('）', start)
                if start >= 0 and end > start:
                    block['text'] = block['text'][:start] + citation + block['text'][end+1:]
    return blocks


def place_figures(blocks, figures, section):
    # Complete paragraphs first; side illustrations otherwise split wrapped
    # Chinese prose in the middle of a sentence.
    at = {}
    for figure in figures:
        page, box = figure['page'], figure['box']
        side = box[0] > .5
        if 'anchor' in figure:
            anchor = figure['anchor']
        elif page == 7:
            anchor = .607 if figure['number'] == 1 else 1
        elif side:
            later_headings = [i for i, b in enumerate(blocks)
                              if b['first']['page'] == page and b['text'].startswith('### ') and
                              b['first']['box'][1] > box[1] and '网球训练要点' not in b['text']]
            if later_headings:
                at.setdefault(later_headings[0], []).append(figure)
                continue
            anchor = 1
        else:
            anchor = box[3]
        candidates = [i for i, b in enumerate(blocks)
                      if (b['first']['page'], b['first']['box'][1]) >= (page, anchor)]
        pos = candidates[0] if candidates else len(blocks)
        at.setdefault(pos, []).append(figure)
    parts = []
    for i in range(len(blocks)+1):
        for figure in at.get(i, []):
            label = figure['label']
            source = f'原书第{figure["page"]-4}页' if figure['page'] >= 9 else '原书前置页'
            if figure.get('restored'):
                parts.append(f'![{label}](../images/{figure["file"]} "{source} · Image-2 根据原图清晰化")')
                parts.append(f'[查看这幅图的原截图](../../../media/{BOOK_SLUG}/{figure["original"]}/)')
            else:
                parts.append(f'![{label}](../images/{figure["file"]} "{source}")')
        if i < len(blocks):
            parts.append(blocks[i]['text'])
    return '\n\n'.join(parts)


def load_lines(ocr_dir, page, corrections):
    raw = json.loads((ocr_dir / f'page-{page:03}.json').read_text())
    lines = raw['lines'] + corrections.get('insertions', {}).get(str(page), [])
    result = []
    for line in lines:
        value = line['text']
        for original, corrected in corrections.get('global', {}).items():
            value = value.replace(original, corrected)
        for original, corrected in corrections.get('pages', {}).get(str(page), {}).items():
            value = value.replace(original, corrected)
        result.append(dict(line, text=clean_line(value), page=page))
    return sorted(result, key=lambda l: (l['box'][1], l['box'][0]))


def merge_rows(lines):
    # Remove illustration labels before merging same-baseline body fragments.
    groups = []
    for line in lines:
        if groups and line['page'] == groups[-1][0]['page'] and abs(line['box'][1] - groups[-1][0]['box'][1]) < .007:
            groups[-1].append(line)
        else:
            groups.append([line])
    rows = []
    for group in groups:
        ordered = sorted(group, key=lambda l: l['box'][0])
        row = dict(ordered[0], box=list(ordered[0]['box']))
        for line in ordered[1:]:
            column_gap = line['box'][0] - row['box'][2]
            if row['page'] == 6 and column_gap > .025:
                separator = ' ' if row['text'].endswith(('：', ':')) else ' · '
                row['text'] += separator + line['text']
            else:
                row['text'] = join_text(row['text'], line['text'])
            row['box'] = [min(row['box'][0], line['box'][0]), min(row['box'][1], line['box'][1]),
                          max(row['box'][2], line['box'][2]), max(row['box'][3], line['box'][3])]
        rows.append(row)
    return rows


def front_matter_blocks(lines, page):
    """These two small-print pages need explicit, inspected reading order."""
    if page == 6:
        ranges = [(.05, .08, 'heading'), (.08, .14, 'prose'), (.14, .16, 'prose'),
                  (.16, .21, 'prose'), (.21, .24, 'prose'), (.25, .27, 'heading'),
                  (.245, .28, 'heading'), (.28, .299, 'prose'), (.299, .385, 'prose'),
                  (.39, .415, 'heading'), (.42, .535, 'prose'), (.535, .56, 'heading'), (.561, .64, 'prose'),
                  (.65, .968, 'rows')]
    else:
        ranges = [(.065, .148, 'quote'), (.148, .19, 'rows'), (.20, .246, 'quote'),
                  (.246, .30, 'rows'), (.30, .348, 'quote'), (.348, .41, 'rows'),
                  (.43, .485, 'bullet'), (.485, .56, 'bullet'), (.56, .635, 'bullet'),
                  (.635, .68, 'bullet'), (.68, .75, 'bullet'), (.89, .968, 'rows')]
    blocks = []
    for low, high, kind in ranges:
        selected = [l for l in lines if low <= l['box'][1] < high]
        if not selected:
            continue
        if kind == 'rows':
            for line in selected:
                text = line['text'].lstrip('• ')
                if page == 6:
                    if text.startswith('著') and not text.startswith('著作权'):
                        text = '作者：' + text[1:].lstrip(' ·')
                    elif text.startswith('译'):
                        text = '译者：' + text[1:].lstrip(' ·')
                blocks.append(dict(text=text, first=line, last=line))
        else:
            text = ''
            for line in selected:
                text = join_text(text, line['text'])
            prefix = {'heading': '### ', 'quote': '> ', 'bullet': '- ', 'prose': ''}[kind]
            blocks.append(dict(text=prefix+text.lstrip('• '), first=selected[0], last=selected[-1]))
    return blocks


def primary_regions(page, lines, title):
    if page == 173:
        return [dict(box=[.035, .145, .465, .596], label='正手球的还原步'),
                dict(box=[.452, .23, .99, .67], label='反手球的还原步', anchor=.84)]
    if page == 175:
        return [dict(box=[.04, .14, .53, .55], label='十字交叉步法训练：动作示意'),
                dict(box=[.55, .257, .94, .572], label='十字交叉步法训练的场地设置', restored=True)]
    if page == 187:
        return [dict(box=[.44, .22, .96, .95], label='小腿伸展：动作与肌群')]
    steps = [l['box'][1] for l in lines if '进行步骤' in l['text']]
    if not steps:
        raise ValueError(f'Missing verified steps heading on PDF page {page}')
    stop = min(steps)
    safety = [l['box'][1] for l in lines if l['text'] == '安全']
    if safety:
        stop = min(stop, min(safety))
    return [dict(box=[.035, .135, .965, stop-.009], label=f'{title}：动作与肌群')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf', required=True)
    parser.add_argument('--ocr-dir', required=True)
    parser.add_argument('--figure-plan', required=True)
    parser.add_argument('--corrections', required=True)
    parser.add_argument('--injury-table', required=True)
    parser.add_argument('--index-pages', required=True)
    parser.add_argument('--restored-diagram', required=True)
    parser.add_argument('--repair-prompt', required=True)
    parser.add_argument('--data-dir', default=os.environ.get('DATA_DIR', str(ROOT/'data')))
    args = parser.parse_args()
    pdf_path, ocr_dir = Path(args.pdf), Path(args.ocr_dir)
    corrections = json.loads(Path(args.corrections).read_text())
    plan = json.loads(Path(args.figure_plan).read_text())['pages']
    plan['9'] = [dict(box=[.1, .831, .89, .874], label='原书肌群与结缔组织灰度图例')]
    all_sections = sections()
    exercise_sections = [s for s in all_sections if s['kind'] == 'exercise']
    source_lines = {p: load_lines(ocr_dir, p, corrections) for p in range(6, 211) if p not in {8}}
    for section in exercise_sections:
        p = section['start'][0]
        regions = primary_regions(p, source_lines[p], section['title'])
        if not section['group'].endswith('网球运动损伤'):
            regions.insert(0, dict(box=[.66, .052, .946, .136], label='原书击球类别图标', anchor=.14))
        plan[str(p)] = regions
    book = Path(args.data_dir).expanduser().resolve() / 'books' / BOOK_SLUG
    images, chapters = book/'images', book/'chapters'
    images.mkdir(parents=True, exist_ok=True)
    chapters.mkdir(parents=True, exist_ok=True)
    pdf = fitz.open(pdf_path)
    if len(pdf) != 211:
        raise ValueError('This import plan requires the supplied 211-page edition.')
    figure_manifest = {}
    for page_key, regions in plan.items():
        page = int(page_key)
        embedded = pdf[page-1].get_images()
        if len(embedded) != 1:
            raise ValueError(f'Unexpected scan image layout on PDF page {page}')
        im = Image.open(io.BytesIO(pdf.extract_image(embedded[0][0])['image'])).convert('RGB')
        figures = []
        for number, region in enumerate(regions, 1):
            box = region['box']
            if not (0 <= box[0] < box[2] <= 1 and 0 <= box[1] < box[3] <= 1):
                raise ValueError(f'Invalid crop on PDF page {page}: {box}')
            crop = im.crop(tuple(round(v * (im.width if i % 2 == 0 else im.height)) for i, v in enumerate(box)))
            name = f'figure-{page:03}-{number:02}.webp'
            crop.save(images/name, 'WEBP', quality=91, method=5)
            figure = dict(region, page=page, number=number, file=name, width=crop.width, height=crop.height)
            if region.get('restored'):
                original = f'figure-{page:03}-{number:02}-original.webp'
                (images/name).rename(images/original)
                name = f'figure-{page:03}-{number:02}-clear.png'
                (images/name).write_bytes(Path(args.restored_diagram).read_bytes())
                figure.update(file=name, original=original)
            figures.append(figure)
        figure_manifest[page_key] = figures
    cover = Image.open(io.BytesIO(pdf.extract_image(pdf[0].get_images()[0][0])['image'])).convert('RGB')
    cover.thumbnail((700, 1000), Image.Resampling.LANCZOS)
    cover.save(images/'cover.webp', 'WEBP', quality=90, method=5)

    index_pages = json.loads(Path(args.index_pages).read_text())
    index_aliases = {'屈膝仰卧起坐': '屈膝仰卧起', '腿筋拉伸': '腘绳肌拉伸'}
    content_manifest = []
    for order, section in enumerate(all_sections, 1):
        start_page, start_y = section['start']
        end_page, end_y = section['end']
        last_page = end_page if end_y else end_page-1
        included, excluded, figures = [], [], []
        for page in range(start_page, last_page+1):
            page_figures = figure_manifest.get(str(page), [])
            figures += [f for f in page_figures if 'anchor' in f or
                        ((page, (f['box'][1]+f['box'][3])/2) >= section['start'] and
                         (page, (f['box'][1]+f['box'][3])/2) < section['end'])]
            if page in {184, 185, 186} or section['kind'] == 'index':
                continue
            for line in source_lines[page]:
                x0, y0, x1, y1 = line['box']
                midpoint = (y0+y1)/2
                reason = None
                if midpoint < .065 or midpoint > .968:
                    reason = 'running-header-or-footer'
                elif (page, midpoint) < section['start'] or (page, midpoint) >= section['end']:
                    reason = 'outside-section'
                elif any(overlaps(line, f['box']) for f in page_figures):
                    reason = 'retained-in-illustration'
                elif page == start_page and section['kind'] in {'exercise', 'overview'} and midpoint < (.18 if section['kind'] == 'overview' else .14):
                    reason = 'title-in-reader'
                elif re.fullmatch(r'CHAPT\w+|\d{1,2}', line['text']):
                    reason = 'chapter-decoration'
                if reason:
                    excluded.append(dict(page=page, text=line['text'], reason=reason))
                else:
                    included.append(line)
        # The source safety label is split over two scan lines.
        safety_lines = []
        for line in included:
            if line['text'] == '提示' and safety_lines and safety_lines[-1]['text'] == '安全':
                safety_lines[-1]['text'] = '安全提示'
                safety_lines[-1]['box'][3] = line['box'][3]
            else:
                safety_lines.append(dict(line, box=list(line['box'])))
        merged = merge_rows(safety_lines)
        blocks = front_matter_blocks(merged, start_page) if start_page in {6, 210} else paragraph_blocks(merged, section['title'], start_page)
        body = place_figures(blocks, figures, section)
        if start_page == 181:
            body += '\n\n' + Path(args.injury_table).read_text().strip()
        if section['kind'] == 'index':
            parts = ['> 编者注：原书索引的部分页码与正文不符。以下保留原索引名称和页码，并列出实际正文页；点击名称直接阅读对应动作。']
            for group, _, _, exercises in GROUPS:
                parts.append('### ' + group)
                for p, _, name in exercises:
                    index_name = index_aliases.get(name, name)
                    target = next(s for s in exercise_sections if s['start'][0] == p)
                    parts.append(f'- [{index_name}](../{target["slug"]}/) · 原索引第{index_pages[index_name]}页 · 正文第{p-4}页')
            body = '\n\n'.join(parts)
        notes = [n for n in corrections.get('notes', []) if start_page <= n['page'] <= last_page and section['kind'] != 'index']
        if notes:
            body += '\n\n### 编者校对注\n\n' + '\n\n'.join(f'> 原书第{n["page"]-4}页：“{n["original"]}”。{n["note"]}' for n in notes)
        if section['kind'] == 'preface' or start_page == 9:
            body = '> 阅读版说明：本书保留原书内容，按阅读顺序整理段落，并将72个训练动作分成独立小节。扫描插图保留原标注；一幅低对比度步法场地图经 Image-2 清晰化，旁边可查看原图。已核对标题、表格及部分关键文字，正文仍可能有识别误差。\n\n' + body
        page_start, page_end = (start_page-4, last_page-4) if start_page >= 9 and last_page < 210 else (None, None)
        front = '\n'.join(['---', 'title: ' + json.dumps(section['title'], ensure_ascii=False),
                           f'order: {order}', 'group: ' + json.dumps(section['group'], ensure_ascii=False),
                           f'pageStart: {page_start if page_start is not None else "null"}',
                           f'pageEnd: {page_end if page_end is not None else "null"}', 'published: true', '---', ''])
        path = chapters/(section['slug']+'.md')
        path.write_text(front+'\n'+body.strip()+'\n')
        content_manifest.append(dict(section, pageStart=page_start, pageEnd=page_end,
                                     sha256=digest(path), bodyLines=len(included), figures=len(figures), excluded=excluded))
    metadata = dict(slug=BOOK_SLUG, title='网球运动系统训练', subtitle='身体解剖、专项体能与步法训练',
                    description='从击球中的身体运动，到肩、臂、胸、背、核心、腿部、转体与步法；72个训练动作配有步骤、肌群和网球训练要点。',
                    authors=['E.保罗·勒特尔', '马克·S.科瓦奇'], translator='孟焕丽、张晶', publisher='人民邮电出版社',
                    isbn='978-7-115-37717-3', language='zh-CN', cover='./images/cover.webp', published=True,
                    sourceNote='2015年中文版扫描整理；保留原文与灰度解剖图，按阅读体验重新分节。动作标题、索引及损伤表已核对，正文尚未逐字校对。一幅步法场地图经 Image-2 清晰化，原图与处理记录均保留。')
    write_json(book/'book.json', metadata)
    write_json(book/'extraction.json', dict(source=pdf_path.name, sha256=digest(pdf_path), pageCount=len(pdf),
                                          originalTitle='Tennis Anatomy', edition='2015年1月第1版',
                                          coordinateSystem='normalized top-left x0,y0,x1,y1 on original embedded JPEG',
                                          ignoredPages={'2-4': 'duplicate front matter', '5': 'title represented in metadata',
                                                        '8': 'contents represented in online navigation', '211': 'PDF-generated bookmarks'},
                                          tablePages=[184, 185, 186], exercises=len(exercise_sections),
                                          figures=sum(map(len, figure_manifest.values())), pages=figure_manifest,
                                          sections=content_manifest))
    repaired = images/'figure-175-02-clear.png'
    write_json(book/'image-repairs.json', [dict(model='Image-2', sourcePdfPage=175, sourcePrintedPage=171,
                                               source='figure-175-02-original.webp', sourceSha256=digest(images/'figure-175-02-original.webp'),
                                               output=repaired.name, outputSha256=digest(repaired),
                                               prompt=Path(args.repair_prompt).read_text().strip(),
                                               review='Checked against original: geometry, P, 1–5, dots and caption preserved.')])
    print(json.dumps(dict(book=str(book), chapters=len(all_sections), exercises=len(exercise_sections),
                          figures=sum(map(len, figure_manifest.values()))), ensure_ascii=False))


if __name__ == '__main__':
    main()
