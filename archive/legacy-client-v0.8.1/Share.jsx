import React,{useState,useEffect} from 'react';
import {GraduationCap,Link2,ShieldCheck,ArrowLeft} from 'lucide-react';
import {api,date} from './api';
import ThemeSelector from './ThemeSelector.jsx';
import {Busy,ErrorBox,Markdown,Status} from './ui';
export default function SharedConversation({id}) {
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{api(`/shares/${encodeURIComponent(id)}`).then(setData).catch(e=>setError(e.message));},[id]);
 const snapshot=data?.snapshot||data;
 return <div className="shared-page"><header className="shared-header"><a href="/"><GraduationCap size={26}/><strong>校园智能体</strong></a><div className="shared-header-actions"><span><ShieldCheck size={15}/>校园网络 / VPN</span><ThemeSelector compact/></div></header><main className="shared-main">{error?<ErrorBox error={error}/>:!data?<Busy/>:<><div className="shared-label"><Link2 size={15}/>对话分享 · 固定内容副本</div><h1>{snapshot.title||data.title||'校园对话'}</h1><p className="muted small">仅包含分享创建时的对话内容{data.expiresAt?` · 有效期至 ${date(data.expiresAt,true)}`:''}</p><div className="shared-messages">{(snapshot.messages||[]).map((m,i)=><article key={m.id||i} className={`shared-message ${m.role==='user'?'is-user':''}`}><strong>{m.role==='user'?'提问':'智能体'}</strong><Markdown>{m.content}</Markdown></article>)}</div><div className="shared-note">智能体回答仅供参考，重要事项请以学校官方发布为准。</div></>}<a href="/" className="button secondary"><ArrowLeft size={16}/>返回校园智能体</a></main></div>;
}
