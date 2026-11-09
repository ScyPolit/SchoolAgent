import nodemailer from 'nodemailer';
import {randomBytes} from 'node:crypto';
import {setting,run,now,get} from './db.js';
import {decrypt,hashToken,HttpError} from './security.js';

export function smtpTransport(){
 const smtp=setting('smtp');
 if(!smtp.host||!smtp.from)throw new HttpError(503,'未配置可用 SMTP，邮件尚未发送，请联系管理员','SMTP_UNCONFIGURED');
 if(smtp.port===465&&smtp.encryption!=='tls')throw new HttpError(400,'465 端口必须使用 TLS 加密；请在后台保存正确的 SMTP 配置','SMTP_CONFIG_INVALID');
 if(smtp.port===587&&smtp.encryption==='tls')throw new HttpError(400,'587 端口应使用 STARTTLS；TLS 加密请改用 465 端口','SMTP_CONFIG_INVALID');
 return {from:smtp.from,transport:nodemailer.createTransport({host:smtp.host,port:smtp.port,secure:smtp.encryption==='tls',requireTLS:smtp.encryption==='starttls',ignoreTLS:smtp.encryption==='none',auth:smtp.username?{user:smtp.username,pass:decrypt(smtp.password)}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:true}})};
}
function mailError(error){
 if(error instanceof HttpError)return error;
 if(error.code==='EAUTH'||[530,534,535].includes(error.responseCode))return new HttpError(502,'SMTP 身份验证失败。QQ 邮箱请先开启 SMTP 服务，用户名填写完整邮箱地址，密码填写邮箱生成的授权码','SMTP_AUTH_FAILED');
 if(['EDNS','ENOTFOUND','EAI_AGAIN'].includes(error.code))return new HttpError(502,'无法解析 SMTP 主机，请检查主机名和服务器 DNS 配置','SMTP_DNS_FAILED');
 if(['ETIMEDOUT','ESOCKETTIMEDOUT'].includes(error.code))return new HttpError(502,'SMTP 连接超时，请检查主机、端口、加密方式，以及服务器防火墙和出站网络限制','SMTP_TIMEOUT');
 if(error.code==='ETLS'||error.code?.startsWith('ERR_TLS')||error.code?.startsWith('ERR_SSL')||['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code))return new HttpError(502,'SMTP TLS 握手或证书验证失败。请核对加密方式：465 使用 TLS，587 使用 STARTTLS，并检查服务器时间和证书信任链','SMTP_TLS_FAILED');
 if(error.command==='MAIL FROM')return new HttpError(502,'SMTP 拒绝发件人，请确认发件地址与认证邮箱一致，并已获准发送邮件','SMTP_SENDER_REJECTED');
 if(error.code==='EENVELOPE')return new HttpError(502,'SMTP 拒绝收件地址，请确认收件邮箱有效且邮件服务允许向该地址投递','SMTP_RECIPIENT_REJECTED');
 if(error.code==='EMESSAGE'||error.command==='DATA')return new HttpError(502,'SMTP 拒绝邮件内容或触发发送限制，请检查邮箱发信额度及服务商限制','SMTP_MESSAGE_REJECTED');
 if(['ECONNECTION','ECONNREFUSED','ECONNRESET','ESOCKET'].includes(error.code))return new HttpError(502,'无法连接 SMTP 服务，请检查主机、端口、加密方式和服务器出站网络','SMTP_CONNECTION_FAILED');
 return new HttpError(502,'SMTP 未成功接受邮件，请检查邮件配置后重试','SMTP_SEND_FAILED');
}
export async function sendMail(to,subject,text){
 try{const {from,transport}=smtpTransport();const result=await transport.sendMail({from,to,subject,text});
  if(!result.accepted?.length)throw new Error('SMTP_REJECTED');return true;
 }catch(error){throw mailError(error);}
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
