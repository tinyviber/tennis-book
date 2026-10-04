'use client';
import { useEffect,useRef,useState } from 'react';
import { Minus, Plus, X, Check } from 'lucide-react';
type Preferences = {fontSize:number;theme:'light'|'warm'|'dark';wide:boolean};
const defaults:Preferences={fontSize:18,theme:'light',wide:false};
export function Preferences({open,onClose}:{open:boolean;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [prefs,setPrefs]=useState<Preferences>(defaults);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('shujian:v1:preferences')||'null');if(saved)setPrefs({...defaults,...saved})}catch{}},[]);
  useEffect(()=>{const d=dialog.current;if(open)d?.showModal();else if(d?.open)d.close()},[open]);
  function change(next:Preferences){
    setPrefs(next);document.documentElement.dataset.theme=next.theme;document.documentElement.dataset.wide=String(next.wide);document.documentElement.style.setProperty('--reader-size',next.fontSize+'px');
    try{localStorage.setItem('shujian:v1:preferences',JSON.stringify(next))}catch{}
  }
  return <dialog ref={dialog} className="preferences-dialog" onClose={onClose} aria-label="阅读设置" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="dialog-title"><h2>阅读设置</h2><button onClick={onClose} aria-label="关闭阅读设置"><X size={18}/></button></div>
    <div className="preference-row"><span>文字大小</span><div className="font-stepper"><button aria-label="减小文字" disabled={prefs.fontSize<=16} onClick={()=>change({...prefs,fontSize:prefs.fontSize-1})}><Minus size={16}/></button><output>{prefs.fontSize}px</output><button aria-label="增大文字" disabled={prefs.fontSize>=24} onClick={()=>change({...prefs,fontSize:prefs.fontSize+1})}><Plus size={16}/></button></div></div>
    <fieldset className="preference-field"><legend>页面颜色</legend><div className="theme-options">{(['light','warm','dark'] as const).map((theme,index)=><button key={theme} data-swatch={theme} aria-pressed={prefs.theme===theme} onClick={()=>change({...prefs,theme})}>{['浅色','暖色','深色'][index]}{prefs.theme===theme&&<Check size={14}/>}</button>)}</div></fieldset>
    <fieldset className="preference-field"><legend>正文宽度</legend><div className="width-options"><button aria-pressed={!prefs.wide} onClick={()=>change({...prefs,wide:false})}>适中</button><button aria-pressed={prefs.wide} onClick={()=>change({...prefs,wide:true})}>宽松</button></div></fieldset>
    <button className="text-button reset-preferences" onClick={()=>change(defaults)}>恢复默认设置</button>
  </dialog>;
}
