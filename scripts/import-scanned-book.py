#!/usr/bin/env python3
"""Cut verified illustration regions from the supplied scanned PDF.

The supplied edition uses repeated layouts; the region plan is explicit and
inspectable, not inferred from text recognition. Full source pages are never
copied into the reader. Outputs remain ordinary Markdown and relative images.
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
SLUGS = ['introduction', 'about', 'hitting', 'getting-started', 'grips',
         'forehand-topspin', 'two-handed-backhand', 'one-handed-backhand',
         'backhand-slice', 'backhand-drop', 'slice-serve', 'topspin-serve',
         'forehand-slice', 'forehand-drop', 'high-forehand-volley',
         'forehand-drop-volley', 'low-forehand-volley', 'forehand-half-volley',
         'backhand-volley', 'backhand-drop-volley', 'low-backhand-volley',
         'backhand-half-volley', 'return', 'forehand-lob', 'backhand-lob',
         'forehand-smash', 'backhand-smash', 'forehand-drive-volley',
         'backhand-drive-volley', 'two-handed-drive-volley', 'practice',
         'essentials', 'scoring', 'rules', 'etiquette', 'tactics', 'serve-tactics',
         'return-tactics', 'first-shot', 'crosscourt-and-line', 'rally-tactics',
         'match-preparation', 'doubles', 'return-to-tennis', 'glossary', 'index',
         'acknowledgements']


def regions(page):
    """Normalized coordinates; preserve arrows, labels and image sequences."""
    # Five rows of continuous-action photographs, with chapter bands excluded.
    left_sheets = {21,29,37,43,51,59,67,75,81,87,93,105,113,119,125,131,137,141}
    right_sheets = {22,30,44,52,60,68,106}
    if page in left_sheets | right_sheets:
        x0, x1 = (.255,.999) if page in left_sheets else (.002,.755)
        return [(x0, i*.2, x1, min((i+1)*.2,.999), f'动作连拍 · 视角 {i+1}') for i in range(5)]
    intro = {23,31,45,53,61,69,76,82,88,94,107,127,138,142}
    if page in intro:
        return [(.565,.002,.996,.415,'握拍与手腕位置'),
                (.028,.495,.31,.815,'预备姿势'),
                (.315,.505,.994,.974,'动作示范与标注')]
    # Pages that finish a spread and contain a short introduction on the right.
    mixed = {38:(.002,.22),114:(.002,.505),120:(.002,.505),132:(.002,.505)}
    if page in mixed:
        x0,x1=mixed[page]
        result=[(x0,i*.2,x1,min((i+1)*.2,.999),f'动作连拍 · 补充视角 {i+1}') for i in range(5)]
        if page != 38:
            result += [(.535,.275,.992,.617,'握拍特写'),(.52,.65,.993,.992,'预备与动作示范')]
        else:
            result += [(.40,.60,.991,.984,'预备与动作示范')]
        return result
    if page == 126:
        return [(.001,i*.2,.225,min((i+1)*.2,.999),f'动作连拍 · 补充视角 {i+1}') for i in range(5)]
    narrow = {50:5,74:5,79:5,85:5,91:2,97:4,99:5}
    if page in narrow:
        n=narrow[page]
        y1=.43 if page==91 else .998
        result=[(.25,i*y1/n,.492,(i+1)*y1/n,f'动作分解 · 第 {i+1} 帧') for i in range(n)]
        y=.43 if page in {91,97} else .50
        if page == 99:y=.70
        result += [(.50,y,.994,.991,'动作示范与标注')]
        return result
    if page==80:
        return [(.505,.015,.991,.43,'预备姿势'),(.025,.44,.993,.845,'多角度动作示范')]
    if 24 <= page <= 144:
        # Three distinct figure regions, rather than a whole-page substitute.
        return [(.345,.015,.973,.325,'动作示范 · 正面视角'),
                (.022,.325,.993,.704,'动作示范 · 多角度视图'),
                (.022,.704,.993,.985,'动作示范 · 完成与要义')]
    special = {
        11:[(.23,.72,.82,.985,'本书作者')],
        12:[(.20,.12,.97,.40,'击球动作分解图的阅读方法'),(.065,.445,.94,.65,'动作与球路的图例'),(.235,.725,.95,.945,'战术图的阅读方法')],
        14:[(.002,.002,.998,.998,'德约科维奇的正手击球')],
        15:[(.505,.45,.994,.755,'徒手挥拍练习'),(.505,.755,.994,.976,'持拍挥拍练习')],
        16:[(.34,.005,.97,.425,'追踪来球'),(.36,.59,.965,.989,'挥送动作')],
        17:[(.002,.507,.61,.998,'纳达尔的双手反手击球')],
        18:[(.355,.016,.965,.245,'大陆式握拍特写'),(.715,.265,.925,.465,'顺腕与逆腕'),(.33,.485,.993,.992,'东方式正手握拍及手腕位置')],
        19:[(.33,.003,.986,.495,'半西方式握拍法'),(.33,.501,.986,.988,'西方式握拍法')],
        20:[(.002,.005,.61,.31,'单手反手握拍特写'),(.34,.29,.965,.468,'单手反手手腕位置'),(.005,.48,.60,.773,'双手反手握拍特写'),(.34,.75,.965,.985,'双手反手手腕位置')],
        146:[(.002,.002,.998,.998,'比赛中的正手击球')],
        147:[(.39,.39,.993,.991,'正手击球姿势')],
        148:[(.08,.33,.725,.988,'反手击球姿势')],
        149:[(.565,.68,.992,.985,'网球比赛记分牌')],
        150:[(.485,.003,.994,.99,'场边与比赛现场')],
        151:[(.002,.50,.655,.993,'发球时的站位')],
        152:[(.002,.003,.998,.506,'发球示范')],
        153:[(.015,.738,.995,.996,'准备发球'),(.67,.49,.995,.653,'球场站位示意')],
        154:[(.002,.002,.998,.687,'网前握手')],
        156:[(.002,.002,.998,.998,'比赛中的球员')],
        157:[(.075,.585,.858,.965,'发球线路与落点')],
        158:[(.405,.095,.99,.335,'发球线路 · 平击'),(.41,.335,.99,.55,'发球线路 · 侧旋'),(.40,.55,.99,.735,'发球线路 · 上旋'),(.40,.735,.99,.965,'发球线路 · 站位')],
        159:[(.355,.413,.991,.72,'接发球线路'),(.38,.72,.997,.988,'接发球落点')],
        160:[(.40,.056,.989,.347,'接发球站位 · 第一种'),(.41,.347,.989,.555,'接发球站位 · 第二种'),(.39,.555,.989,.769,'接发球站位 · 第三种')],
        161:[(.38,.29,.994,.946,'第一击动作')],
        162:[(.065,.255,.928,.568,'斜线进攻线路'),(.09,.582,.966,.966,'边线直线进攻线路')],
        163:[(.41,.317,.994,.573,'斜线击球线路'),(.40,.573,.994,.79,'直线击球线路'),(.28,.791,.991,.992,'线路与站位选择')],
        164:[(.337,.003,.996,.634,'对打中的步法与击球')],
        165:[(.50,.73,.993,.985,'对打中的击球线路')],
        166:[(.40,.065,.982,.325,'底线对打线路'),(.40,.326,.982,.513,'落点与移动线路'),(.41,.514,.992,.752,'主动进攻线路'),(.46,.752,.992,.966,'上网与落点线路')],
        167:[(.688,.566,.98,.76,'进入临场状态的练习')],
        168:[(.338,.752,.666,.992,'比赛前的准备')],
        169:[(.45,.593,.993,.977,'双打站位与发球线路')],
        170:[(.353,.643,.993,.994,'双打比赛现场')],
        171:[(.37,.024,.998,.31,'双打阵形 · 第一种'),(.37,.31,.998,.545,'双打阵形 · 第二种'),(.40,.545,.998,.76,'双打阵形 · 第三种'),(.37,.76,.998,.983,'双打阵形 · 第四种')],
        172:[(.002,.002,.998,.642,'双打对抗')],
        173:[(.16,.655,.995,.988,'双打线路与配合')],
        174:[(.002,.002,.998,.998,'双打网前配合')],
        175:[(.018,.441,.992,.766,'复出练习 · 徒手挥拍'),(.018,.766,.992,.987,'复出练习 · 持拍挥拍')],
        176:[(.012,.435,.988,.67,'复出练习 · 反手挥拍'),(.012,.67,.988,.985,'复出练习 · 击球与挥送')],
    }
    return special.get(page,[])


FIXES = {'最党用':'最常用','肤盖':'膝盖','握朱法':'握拍法','肩胆骨':'肩胛骨',
         '肩甩骨':'肩胛骨','肩腥骨':'肩胛骨','肩爵骨':'肩胛骨','肩甸骨':'肩胛骨',
         '非悍用':'非惯用','非慢用':'非惯用','非愤用':'非惯用','非惮用':'非惯用',
         '上施球':'上旋球','双松自如':'轻松自如','泽松地':'轻松地','台高肘部':'抬高肘部',
         '另一仙腿':'另一侧腿','略微这曲':'略微弯曲','脚用力路地':'脚用力蹬地',
         '正手吊上旋于':'正手上旋高吊球','单手反手许球握#':'单手反手上旋球握拍法',
         '打出旋转球,其KE别人':'打出旋转球，其区别',
         'MeEnro':'McEnroe','Bijorg':'Borg','Eull':'Full'}


def clean(text,title):
    text=re.sub(r'<a id="section-\d+"></a>','',text)
    text=re.sub(r'^#{2,3} [^\n]+\n?','',text,flags=re.M)
    text=text.replace('本页没有识别出连续正文，扫描图保留。','')
    for a,b in FIXES.items():text=text.replace(a,b)
    out=[]
    for para in re.split(r'\n\s*\n',text):
        para=para.strip()
        if not para:continue
        stripped=para.strip('*').strip()
        if stripped==title:continue
        cjk=len(re.findall(r'[\u4e00-\u9fff]',stripped))
        if cjk<2 and not re.search(r'[a-zA-Z]{4,}',stripped):continue
        if re.search(r'(?:ENET|Fr|F州|败河|州抵|州址|沈右|沈涉|唱站|站-出|尝医|讶诛|讶剑)',stripped) and len(stripped)<40:continue
        if stripped in {'殿，','叶而言','尝而言','法丰富党','喷布言若集','沉贞站党多','CO ) S','和/入'}:continue
        if len(stripped)<12 and re.search(r'[a-zA-Z|#]',stripped) and cjk<3:continue
        para=re.sub(r'(?<!\n)\n(?!\n)',' ',para)
        # Short strong text becomes a genuine heading, rather than bold debris.
        if para.startswith('**') and para.endswith('**') and 2<=cjk<=18:
            para='### '+stripped
        out.append(para)
    return '\n\n'.join(out)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--pdf',required=True)
    ap.add_argument('--markdown',required=True)
    ap.add_argument('--data-dir',default=os.environ.get('DATA_DIR',str(ROOT/'data')))
    args=ap.parse_args()
    pdfpath=Path(args.pdf); md=Path(args.markdown).read_text()
    book=Path(args.data_dir).expanduser().resolve()/'books/tennis-improvement'; images=book/'images'; chapters=book/'chapters'
    images.mkdir(parents=True,exist_ok=True);chapters.mkdir(parents=True,exist_ok=True)
    pdf=fitz.open(pdfpath)
    anchors=list(re.finditer(r'<a id="section-(\d+)"></a>\s+#{2,3} ([^\n]+)',md))
    entries=[]
    for m in anchors:
        prev=list(re.finditer(r'> PDF 第(\d+)页',md[:m.start()]))
        entries.append({'number':int(m[1]),'title':m[2], 'start':int(prev[-1][1]),'offset':m.end()})
    crop_manifest={}; count=0
    for i,e in enumerate(entries):
        end=entries[i+1]['start']-1 if i+1<len(entries) else len(pdf)
        raw=md[e['offset']:anchors[i+1].start() if i+1<len(anchors) else len(md)]
        split=re.split(r'> PDF 第(\d+)页 · \[查看原页扫描图\]\(images/page-\d+\.jpg\)',raw)
        page_text={e['start']:split[0]}
        for j in range(1,len(split),2):page_text[int(split[j])]=split[j+1]
        parts=[]
        for pno in range(e['start'],end+1):
            text=clean(page_text.get(pno,''),e['title'])
            if text:parts.append(text)
            boxes=regions(pno)
            if not boxes:continue
            page=pdf[pno-1]; xref=page.get_images()[0][0]
            im=Image.open(io.BytesIO(pdf.extract_image(xref)['image'])).convert('RGB')
            crops=[]
            for n,(x0,y0,x1,y1,label) in enumerate(boxes,1):
                box=(int(x0*im.width),int(y0*im.height),int(x1*im.width),int(y1*im.height))
                crop=im.crop(box)
                crop.thumbnail((1800,2000),Image.Resampling.LANCZOS)
                name=f'figure-{pno:03}-{n:02}.webp'
                encoded=io.BytesIO();crop.save(encoded,format='WEBP',quality=88,method=5)
                if len(encoded.getbuffer())<256:raise RuntimeError(f'Empty crop: PDF page {pno}, region {n}')
                (images/name).write_bytes(encoded.getbuffer())
                parts.append(f'![{label}](../images/{name} "原书第{pno-5}页")')
                crops.append({'file':name,'box':[x0,y0,x1,y1], 'width':crop.width,'height':crop.height,'label':label})
                count+=1
            crop_manifest[str(pno)]=crops
        group='导读' if i<3 else '基础与击球' if i<30 else '练习门道' if i<35 else '比赛战术' if i<44 else '附录'
        front=f'---\ntitle: {e["title"]}\norder: {i+1}\ngroup: {group}\npageStart: {e["start"]-5}\npageEnd: {end-5}\n---\n\n'
        (chapters/f'{i+1:02}-{SLUGS[i]}.md').write_text(front+'\n\n'.join(parts)+'\n')
    im=Image.open(io.BytesIO(pdf.extract_image(pdf[0].get_images()[0][0])['image'])).convert('RGB')
    im.thumbnail((700,1000),Image.Resampling.LANCZOS)
    encoded=io.BytesIO();im.save(encoded,format='WEBP',quality=89,method=5)
    (images/'cover.webp').write_bytes(encoded.getbuffer())
    metadata={'slug':'tennis-improvement','title':'网球提升','subtitle':'基础技巧与实战策略',
              'description':'从握拍与基础击球，到球场规则、比赛战术与双打配合。',
              'authors':['约翰·利特尔福德','安德鲁·马格拉斯'],'translator':'张妍妍',
              'publisher':'人民邮电出版社','isbn':'978-7-115-37789-0','language':'zh-CN',
              'cover':'./images/cover.webp','sourceNote':'正文来自扫描识别，尚未逐字校对。插图保留原书中的动作、箭头和标注。'}
    (book/'book.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
    manifest={'source':'网球提升  基础技巧与实战策略_13831982.pdf',
              'sha256':hashlib.sha256(pdfpath.read_bytes()).hexdigest(),
              'pageCount':len(pdf),'coordinateSystem':'normalized x0,y0,x1,y1 on original embedded image',
              'figures':count,'pages':crop_manifest}
    (book/'extraction.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'chapters':len(entries),'figures':count,'book':str(book)},ensure_ascii=False))

if __name__=='__main__':main()
