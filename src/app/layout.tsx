import type { Metadata } from 'next';
import '@fontsource-variable/noto-serif-sc';
import '@fontsource-variable/noto-sans-sc';
import './globals.css';

export const metadata:Metadata = { title: { default:'书间 · 图文阅读', template:'%s · 书间' }, description:'一个安静的图文书籍阅读空间。', robots:{index:false,follow:false} };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:`try{var p=JSON.parse(localStorage.getItem('shujian:v1:preferences')||'{}');document.documentElement.dataset.theme=['light','warm','dark'].includes(p.theme)?p.theme:'light';if(p.fontSize>=16&&p.fontSize<=24)document.documentElement.style.setProperty('--reader-size',p.fontSize+'px');if(p.wide)document.documentElement.dataset.wide='true'}catch(e){}`}}/></head><body>{children}</body></html>;
}
