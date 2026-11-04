import {Router} from 'express';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {all,get,run,id,now,setting,transaction} from './db.js';
import {HttpError,hashPassword,verifyPassword,hashToken,setLoginCookie,cookieOptions,publicUser,requireUser,audit} from './security.js';
import {sendAccountMail,validEmailToken} from './mail.js';

export const authRouter=Router();
const emailSchema=z.string().trim().email().max(254).transform(v=>v.toLowerCase());
const passwordSchema=z.string().min(12,'密码至少 12 个字符').max(256);
const authAttempts=new Map();
function guard(req,key,max,period){
 const mapKey=key+':'+req.ip;const existing=authAttempts.get(mapKey);const entry=existing&&existing.until>now()?existing:{count:0,until:now()+period};
 if(entry.count>=max)throw new HttpError(429,'认证尝试过于频繁，请稍后重试','AUTH_THROTTLED');
 entry.count++;authAttempts.set(mapKey,entry);
 if(authAttempts.size>10000)for(const [k,v]of authAttempts)if(v.until<now())authAttempts.delete(k);
}
authRouter.post('/auth/register',async(req,res)=>{
 guard(req,'register',10,15*60000);
 const body=z.object({email:emailSchema,name:z.string().trim().min(1).max(80),password:passwordSchema}).parse(req.body);
 if(get('SELECT id FROM users WHERE email=?',body.email))throw new HttpError(409,'此邮箱已有账号，请登录或重新发送验证邮件','EMAIL_EXISTS');
 const passwordHash=await hashPassword(body.password);const user={id:id('u_'),...body};
 transaction(()=>{run('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',user.id,user.email,user.name,passwordHash,now());run('INSERT INTO user_groups(user_id,group_id) VALUES(?,?)',user.id,setting('defaults').userGroupId);});
 audit(req,'account.register',user.id);
 try{await sendAccountMail(user,'verify');res.status(201).json({mailSent:true,message:'账号已创建，SMTP 已接受验证邮件。请检查邮箱并完成验证。'});}
 catch(error){res.status(201).json({mailSent:false,code:error.code||'SMTP_SEND_FAILED',message:'账号已创建，但验证邮件未能发送。请联系管理员配置邮件后重新发送。'});}
});
authRouter.post('/auth/login',async(req,res)=>{
 guard(req,'login',25,15*60000);
 const body=z.object({email:emailSchema,password:z.string().max(256)}).parse(req.body);const user=get('SELECT * FROM users WHERE email=?',body.email);
 const success=user&&await verifyPassword(body.password,user.password_hash);
 if(!success){audit(req,'auth.login_failed','login',{outcome:'invalid_credentials'});throw new HttpError(401,'邮箱或密码不正确','INVALID_CREDENTIALS');}
 if(!user.active)throw new HttpError(403,'账号已停用，请联系管理员','ACCOUNT_DISABLED');
 if(!user.email_verified)throw new HttpError(403,'请先验证邮箱，可重新发送验证邮件','EMAIL_NOT_VERIFIED');
 const token=randomBytes(32).toString('base64url');run('INSERT INTO sessions(id,user_id,version,created_at,expires_at) VALUES(?,?,?,?,?)',hashToken(token),user.id,user.session_version,now(),now()+30*86400000);setLoginCookie(res,token);
 audit({...req,user,identity:{id:user.id}},'auth.login',user.id,{outcome:'success'});
 const migrationCount=guestConversationCount(req.guestId);
 res.json({user:publicUser(user),migrationCount});
});
authRouter.post('/auth/logout',(req,res)=>{
 if(req.cookies.school_session)run('DELETE FROM sessions WHERE id=?',hashToken(req.cookies.school_session));
 audit(req,'auth.logout',req.identity.id);res.clearCookie('school_session',cookieOptions());res.json({message:'已退出登录'});
});
authRouter.post('/auth/resend-verification',async(req,res)=>{
 guard(req,'mail',8,15*60000);const email=emailSchema.parse(req.body.email);const user=get('SELECT * FROM users WHERE email=?',email);
 if(!user||!user.active||user.email_verified)return res.json({mailSent:false,message:'若账号存在且需要验证，可在邮件服务可用时发送验证邮件。'});
 await sendAccountMail(user,'verify');res.json({mailSent:true,message:'SMTP 已接受验证邮件，请检查收件箱。'});
});
authRouter.post('/auth/forgot-password',async(req,res)=>{
 guard(req,'mail',8,15*60000);const email=emailSchema.parse(req.body.email);const user=get('SELECT * FROM users WHERE email=?',email);
 if(!user||!user.active)return res.json({mailSent:false,message:'若账号存在且可用，可在邮件服务可用时发起密码重置。'});
 await sendAccountMail(user,'reset');audit(req,'auth.reset_requested',user.id);res.json({mailSent:true,message:'SMTP 已接受密码重置邮件，请在 1 小时内使用。'});
});
authRouter.post('/auth/verify',(req,res)=>{
 const row=validEmailToken(req.body.token,'verify');
 transaction(()=>{run('UPDATE users SET email_verified=1 WHERE id=?',row.user_id);run('UPDATE email_tokens SET used_at=? WHERE id=?',now(),row.id);});
 audit(req,'auth.email_verified',row.user_id);res.json({message:'邮箱已验证，现在可以登录。'});
});
authRouter.post('/auth/reset-password',async(req,res)=>{
 const row=validEmailToken(req.body.token,'reset');const password=passwordSchema.parse(req.body.password);const hash=await hashPassword(password);
 transaction(()=>{
  // A concurrent request may have consumed the token while password hashing was in flight.
  const current=validEmailToken(req.body.token,'reset');
  run('UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=?',hash,current.user_id);
  run('UPDATE email_tokens SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL',now(),current.user_id,'reset');run('DELETE FROM sessions WHERE user_id=?',current.user_id);
 });
 audit(req,'auth.password_reset',row.user_id);res.json({message:'密码已更新，请重新登录。'});
});
authRouter.get('/auth/me',requireUser,(req,res)=>res.json(publicUser(req.user)));

export function guestConversationCount(guestId){
 if(!get("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"))return 0;
 return get("SELECT count(*) AS count FROM conversations WHERE owner_type='guest' AND owner_id=? AND hidden_at IS NULL AND last_active_at>=?",guestId,now()-setting('retention').guestBrowserDays*86400000)?.count||0;
}
