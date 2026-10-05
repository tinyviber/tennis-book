import { isMissing, readBookDocument, readChapterDocument } from './content-store';
import type { SourceCard } from './training-types';
import { publicPath } from './urls';

const selections: { book: string; chapter: string; category: SourceCard['category']; summary: string }[] = [
  { book: 'tennis-improvement', chapter: '06-forehand-topspin', category: 'court', summary: '正手上旋球的原书图文参考。结合一个教练确认的提示，固定来球与拍摄条件复测。' },
  { book: 'tennis-improvement', chapter: '07-two-handed-backhand', category: 'court', summary: '双手反手的原书参考；记录你实际使用的提示，不把示范图直接当作自己的动作测量。' },
  { book: 'tennis-improvement', chapter: '31-practice', category: 'court', summary: '练习方式的原书参考。每次练习说明来球条件、目标区域和成功标准。' },
  { book: 'tennis-footwork', chapter: '03-shot-sequence', category: 'court', summary: '击球与步法顺序的资料入口，可对照录像记录准备、移动与回位的可见现象。' },
  { book: 'tennis-footwork', chapter: '04-footwork-training', category: 'court', summary: '步法练习的文章资料。先查看原文，再按自己的球场与教练条件选用。' },
  { book: 'tennis-system-training', chapter: '04-player-in-motion', category: 'review', summary: '查看网球动作与身体各部分的关系，复盘时保留观察与推测的区别。' },
  { book: 'tennis-system-training', chapter: '42-core-overview', category: 'gym', summary: '阅读核心与躯干训练原则，再按自己已经掌握的动作和器械选择训练。' },
  { book: 'tennis-system-training', chapter: '15-external-rotation', category: 'gym', summary: '肩部训练的原书参考；动作和负重请先与教练确认。' },
  { book: 'tennis-system-training', chapter: '29-push-up', category: 'gym', summary: '上肢训练动作参考，可用于查阅原图和原书步骤。' },
  { book: 'tennis-system-training', chapter: '53-romanian-deadlift', category: 'gym', summary: '髋部及下肢动作参考；只有熟悉动作后才放入个人训练卡。' },
  { book: 'tennis-system-training', chapter: '55-lunge', category: 'gym', summary: '查看下肢训练原文，与已有健身经验和可用器械对照。' },
  { book: 'tennis-system-training', chapter: '62-rotation-overview', category: 'gym', summary: '转体训练原则的原书参考，不能由一段击球录像推断某块肌肉薄弱。' },
  { book: 'tennis-system-training', chapter: '80-balance-board', category: 'gym', summary: '平衡练习的原书参考；可作为与教练讨论步法训练准备的入口。' },
];

export async function readTrainingSourceCards(): Promise<SourceCard[]> {
  const cards = await Promise.all(selections.map(async selection => {
    try {
      const [{ metadata }, chapter] = await Promise.all([readBookDocument(selection.book), readChapterDocument(selection.book, selection.chapter)]);
      if (!metadata.published || !chapter.published) return null;
      const sourceNote = selection.book === 'tennis-footwork'
        ? `${metadata.title}；文章文本由原 PDF 提取与整理。请对照原文和配图。`
        : `${metadata.title}；正文来自原书 OCR，尚未逐字校订。请对照原图，保留原书表述。`;
      return { ...selection, id: `${selection.book}:${selection.chapter}`, title: chapter.title, pageStart: chapter.pageStart, pageEnd: chapter.pageEnd, href: publicPath(`/read/${selection.book}/${selection.chapter}/`), editorialStatus: 'needs-review' as const, sourceNote };
    } catch (error) { if (isMissing(error)) return null; throw error; }
  }));
  return cards.filter((card): card is SourceCard => card !== null);
}
