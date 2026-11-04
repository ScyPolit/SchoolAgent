import React, {useEffect, useRef} from 'react';
import {X, LoaderCircle, CircleAlert, Inbox, Sparkles, Check} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, {defaultSchema} from 'rehype-sanitize';

export function IconButton({label,children,...props}) { return <button className="icon-button" title={label} aria-label={label} {...props}>{children}</button>; }
export function Busy({text='正在加载…',compact=false}) { return <div className={`loading ${compact?'compact':''}`} role="status"><LoaderCircle size={20} className="spin"/>{text}</div>; }
export function Empty({title='暂时没有内容',text,children}) {return <div className="empty"><div className="empty-symbol"><Inbox size={27}/></div><h3>{title}</h3>{text&&<p>{text}</p>}{children}</div>;}
export function ErrorBox({error,onRetry}) {return <div className="error-box" role="alert"><CircleAlert size={19}/><span>{error?.message||error}</span>{onRetry&&<button className="text-button" onClick={onRetry}>重试</button>}</div>;}
export function Modal({title,children,onClose,wide=false,footer}) {
  const ref=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement;
    const el=ref.current;
    const focusable=()=>[...el.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')];
    focusable()[0]?.focus();
    const onKey=e=>{if(e.key==='Escape')onClose?.();if(e.key==='Tab'){const nodes=focusable();if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
    document.addEventListener('keydown',onKey);const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=old;previous?.focus?.();};
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.();}}><section ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`modal ${wide?'wide':''}`}><header><h2 id="modal-title">{title}</h2>{onClose&&<IconButton label="关闭" onClick={onClose}><X size={21}/></IconButton>}</header><div className="modal-body">{children}</div>{footer&&<footer>{footer}</footer>}</section></div>;
}
export function Avatar({agent,size='normal'}) {const avatar=agent?.avatar;return <span className={`avatar avatar-${size}`} style={{'--avatar-hue':`${[...agent?.name||''].reduce((a,b)=>a+b.charCodeAt(0),0)%300}`}}>{avatar&&/^https?:\/\/|^\//.test(avatar)?<img src={avatar} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>:avatar||<Sparkles size={size==='large'?30:20}/>}</span>;}
export function Field({label,hint,children}) {return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function Status({value}) {const labels={completed:'已完成',success:'成功',failed:'失败',error:'失败',stopped:'已停止',unknown:'终态未知',running:'生成中',streaming:'生成中',waiting:'等待中',pending:'等待中',processing:'处理中',open:'待处理',resolved:'已处理',closed:'已关闭',dismissed:'已忽略'};return <span className={`status status-${value}`}>{labels[value]||value||'未知'}</span>;}
export function CheckList({options,value=[],onChange}) {return <div className="check-list">{options.map(o=><label key={o.value}><input type="checkbox" checked={value.includes(o.value)} onChange={e=>onChange(e.target.checked?[...value,o.value]:value.filter(v=>v!==o.value))}/><span>{o.label}</span></label>)}</div>;}

function telephoneLinks() {return tree=>{
  function walk(node){if(['link','code','inlineCode'].includes(node.type))return;if(!node.children)return;node.children=node.children.flatMap(child=>{if(child.type!=='text'){walk(child);return[child];}const re=/(?<!\d)(?:1[3-9]\d{9}|0\d{2,3}[-－]\d{7,8}(?:[-－]\d{1,5})?)(?!\d)/g;let m,position=0,parts=[];while((m=re.exec(child.value))){if(m.index>position)parts.push({type:'text',value:child.value.slice(position,m.index)});parts.push({type:'link',url:`tel:${m[0].replace(/－/g,'-')}`,children:[{type:'text',value:m[0]}]});position=m.index+m[0].length;}if(!parts.length)return[child];if(position<child.value.length)parts.push({type:'text',value:child.value.slice(position)});return parts;});}walk(tree);
};}
const schema={...defaultSchema,protocols:{...defaultSchema.protocols,href:['http','https','mailto','tel']}};
export function safeHref(value){try{const raw=String(value||'').trim();if(!raw)return undefined;const url=new URL(raw,window.location.origin);return ['http:','https:','mailto:','tel:'].includes(url.protocol)?raw:undefined;}catch{return undefined;}}
export function Markdown({children}) {return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm,telephoneLinks]} rehypePlugins={[[rehypeSanitize,schema]]} urlTransform={safeHref} components={{a:({href,children})=><a href={href} target={/^https?:/.test(href||'')?'_blank':undefined} rel="noopener noreferrer">{children}</a>,img:()=>null,table:({children})=><div className="table-scroll"><table>{children}</table></div>}}>{String(children||'')}</ReactMarkdown></div>;}

export function Toast({message,onClose}) {useEffect(()=>{const id=setTimeout(onClose,5500);return()=>clearTimeout(id);},[message]);return <div className="toast" role="status"><Check size={18}/><span>{message}</span><button aria-label="关闭提示" onClick={onClose}><X size={16}/></button></div>;}
