import nodemailer from 'nodemailer';
import {randomBytes} from 'node:crypto';
import {setting,run,now,get} from './db.js';
import {decrypt,hashToken,HttpError} from './security.js';

export function smtpTransport(){
 const smtp=setting('smtp');
 if(!smtp.host||!smtp.from)throw new HttpError(503,'未配置可用 SMTP，邮件尚未发送，请联系管理员','SMTP_UNCONFIGURED');
 return {from:smtp.from,transport:nodemailer.createTransport({host:smtp.host,port:smtp.port,secure:smtp.encryption==='tls',requireTLS:smtp.encryption==='starttls',ignoreTLS:smtp.encryption==='none',auth:smtp.username?{user:smtp.username,pass:decrypt(smtp.password)}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:true}})};
}
export async function sendMail(to,subject,text){
 try{const {from,transport}=smtpTransport();const result=await transport.sendMail({from,to,subject,text});
  if(!result.accepted?.length)throw new Error('SMTP_REJECTED');return true;
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(502,'SMTP 未成功接受邮件，请检查邮件配置后重试','SMTP_SEND_FAILED');}
}
export async function sendAccountMail(user,purpose){
 const token=randomBytes(32).toString('base64url');const hash=hashToken(token);const expiry=now()+(purpose==='verify'?24*3600000:3600000);
 run('INSERT INTO email_tokens(id,user_id,purpose,expires_at) VALUES(?,?,?,?)',hash,user.id,purpose,expiry);
 const base=(process.env.PUBLIC_URL||'http://localhost:3000').replace(/\/$/,'');
 const url=purpose==='verify'
  ?`${base}/verify?email=${encodeURIComponent(user.email)}&action=verify&token=${encodeURIComponent(token)}`
  :`${base}/reset-password?userId=${encodeURIComponent(user.id)}&action=reset&token=${encodeURIComponent(token)}`;
 try{await sendMail(user.email,purpose==='verify'?'验证你的校园智能体邮箱':'重置校园智能体密码',`${user.name}，你好：\n\n请在校内网络或连接学校 VPN 后访问以下链接：\n${url}\n\n此链接${purpose==='verify'?'24 小时':'1 小时'}内有效，且仅可使用一次。若非本人操作，请忽略。`);
  run('DELETE FROM email_tokens WHERE user_id=? AND purpose=? AND id<>?',user.id,purpose,hash);
  return true;
 }catch(error){run('DELETE FROM email_tokens WHERE id=?',hash);throw error;}
}
export function validEmailToken(token,purpose){
 if(typeof token!=='string'||token.length>200)throw new HttpError(400,'链接无效或已过期','INVALID_TOKEN');
 const row=get('SELECT * FROM email_tokens WHERE id=? AND purpose=? AND used_at IS NULL AND expires_at>?',hashToken(token),purpose,now());
 if(!row)throw new HttpError(400,'链接无效、已使用或已过期','INVALID_TOKEN');return row;
}
