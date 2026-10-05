import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { getBooks } from '@/lib/books';
import { connection } from 'next/server';
import { ResumeLink } from '@/components/ResumeLink';
import { isGitContentDeployment } from '@/lib/content-store';

export default async function Shelf() {
  await connection();
  const books = await getBooks();
  const gitManaged = isGitContentDeployment();
  return <>
    <header className="site-header"><Link href="/" className="wordmark">书间</Link><span className="header-divider"/><span className="header-label">书架</span><Link className="shelf-admin" href="/training/">私人训练</Link>{!gitManaged && <Link className="shelf-admin" style={{marginLeft:0}} href="/admin/">内容管理</Link>}</header>
    <main className="shelf">
      <div className="shelf-intro"><h1>书架</h1><p>书里的文字与图片，慢慢读。</p></div>
      {books.length === 0 && <p className="empty-shelf">书架还没有已发布的章节。管理员可以在内容管理中添加。</p>}
      <div className="book-list">{books.map((book)=><section className="shelf-book" key={book.slug}>
        <Link href={`/read/${book.slug}/${book.chapters[0].slug}/`} className="book-cover-link" aria-label={`阅读${book.title}`}>
          {book.cover ? <img className="book-cover" src={book.cover} alt={`${book.title}封面`} width="260" height="350"/> : <div className="typographic-cover">{book.title}</div>}
        </Link>
        <div className="book-description"><h2>{book.title}</h2><p className="book-subtitle">{book.subtitle}</p><p className="book-authors">{book.authors.join('、')}</p><p className="book-blurb">{book.description}</p>
          <div className="book-details"><span>{book.chapterCount} 节</span><span>{book.figureCount} 幅图组</span></div>
          <ResumeLink book={book.slug} first={book.chapters[0].slug} validChapters={book.chapters.map(c=>c.slug)}/>
          <details className="shelf-toc"><summary>查看目录<ArrowUpRight size={16}/></summary><div>{book.chapters.map(chapter=><Link key={chapter.slug} href={`/read/${book.slug}/${chapter.slug}/`}><span>{chapter.title}</span><small>{chapter.group}</small></Link>)}</div></details>
        </div>
      </section>)}</div>
      <footer className="shelf-footer"><span>书间</span><p>正文来自扫描识别，插图保留原书标注。文字尚未逐字校对。</p></footer>
    </main>
  </>;
}
