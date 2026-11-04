import React,{useState} from 'react';
import {ArrowRight,Mail,LockKeyhole,GraduationCap} from 'lucide-react';
import {api} from './api';
import {Modal,Field,ErrorBox} from './ui';

export default function Auth({initial='login',token,onClose,onLogin}) {
 const [mode,setMode]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[mailFailed,setMailFailed]=useState(false);
 const [email,setEmail]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState('');
 const labels={login:'欢迎回到校园',register:'创建你的校园账号',forgot:'找回密码',resend:'重新发送验证邮件',reset:'设置新密码',verify:'验证邮箱'};
 async function submit(e){e.preventDefault();setBusy(true);setError('');setMessage('');try{
  const path={login:'login',register:'register',forgot:'forgot-password',resend:'resend-verification',reset:'reset-password',verify:'verify'}[mode];
  const result=await api(`/auth/${path}`,{method:'POST',body:{email,name,password,token}});
  if(mode==='login'){await onLogin(result);onClose();return;}
  setMailFailed(result.mailSent===false);
  setMessage(result.message||(mode==='verify'?'邮箱验证成功，现在可以登录。':mode==='reset'?'密码已更新，请使用新密码登录。':'请求已提交。'));
  setPassword('');
 }catch(err){setError(err.message);}finally{setBusy(false);}}
 function change(value){setMode(value);setError('');setMessage('');}
 return <Modal title={labels[mode]} onClose={onClose}><div className="auth-intro"><div className="brand-emblem"><GraduationCap size={28}/></div><p>一个账号，连接每一次校园提问。</p></div><form onSubmit={submit} className="form-stack">
 {error&&<ErrorBox error={error}/>}{message&&<div className={`notice ${mailFailed?'warning':'success'}`}>{message}</div>}
 {mode==='register'&&<Field label="称呼"><input autoComplete="name" required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="怎么称呼你"/></Field>}
 {!['reset','verify'].includes(mode)&&<Field label="邮箱"><div className="input-with-icon"><Mail size={17}/><input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="yourname@example.com"/></div></Field>}
 {['login','register','reset'].includes(mode)&&<Field label={mode==='reset'?'新密码':'密码'} hint={mode!=='login'?'至少 12 位，建议混合字母、数字和符号。':undefined}><div className="input-with-icon"><LockKeyhole size={17}/><input type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={mode==='login'?1:12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)} placeholder="输入密码"/></div></Field>}
 {mode==='verify'&&<p className="muted">点击确认完成此链接对应邮箱的验证。</p>}
 <button className="button primary full" disabled={busy}>{busy?'正在处理…':({login:'登录',register:'注册并申请验证邮件',forgot:'申请密码重置邮件',resend:'申请验证邮件',reset:'保存新密码',verify:'确认验证'})[mode]}<ArrowRight size={17}/></button>
 {mode==='login'?<><div className="auth-links"><button type="button" className="text-button" onClick={()=>change('forgot')}>忘记密码？</button><button type="button" className="text-button" onClick={()=>change('resend')}>重发验证邮件</button></div><div className="auth-bottom">还没有账号？<button type="button" className="text-button" onClick={()=>change('register')}>立即注册</button></div></>:<div className="auth-bottom"><button type="button" className="text-button" onClick={()=>change('login')}>返回登录</button></div>}
 <p className="auth-privacy">仅在校园网络或学校 VPN 环境下使用。邮件是否成功发送以实际结果为准。</p></form></Modal>;
}

