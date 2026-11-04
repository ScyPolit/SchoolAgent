import {randomBytes,createHash,scrypt as scryptCb,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {all,get,run,id,now,parse,setting} from './db.js';

const scrypt=promisify(scryptCb);
export const PERMISSIONS=['users','groups','agents','integrations','credentials','homepage','settings','statistics','logs','conversations','content_view','content_export','cleanup','feedback','audit'];
export class HttpError extends Error {constructor(status,message,code='REQUEST_ERROR'){super(message);this.status=status;this.code=code;}}
export const hashToken=value=>createHash('sha256').update(value).digest('hex');
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>256) throw new HttpError(400,'密码长度须为 12～256 个字符','INVALID_PASSWORD');
 const salt=randomBytes(16);const key=await scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
 return 'scrypt:32768:8:3:'+salt.toString('hex')+':'+key.toString('hex');
}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||password.length>256) return false;
 const parts=stored.split(':');
 const [,n,r,p,salt,key]=parts.length===6?parts:[parts[0],'16384','8','1',parts[1],parts[2]];
 const actual=await scrypt(password,Buffer.from(salt,'hex'),64,{N:Number(n),r:Number(r),p:Number(p),maxmem:64*1024*1024});
 return timingSafeEqual(actual,Buffer.from(key,'hex'));
}
function encryptionKey(){
 const value=process.env.ENCRYPTION_KEY;
 if(!value||!/^[0-9a-fA-F]{64}$/.test(value)) throw new HttpError(503,'服务端尚未配置 32 字节 ENCRYPTION_KEY，无法安全保存凭据','ENCRYPTION_UNCONFIGURED');
 return Buffer.from(value,'hex');
}
export function encrypt(value){if(!value)return '';const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});}
export function decrypt(value){if(!value)return '';const item=JSON.parse(value),cipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(item.iv,'base64'));cipher.setAuthTag(Buffer.from(item.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(item.data,'base64')),cipher.final()]).toString('utf8');}
export function publicUser(user){return user?{id:user.id,email:user.email,name:user.name,role:user.role,permissions:parse(user.permissions,[])}:null;}
export const hasPermission=(user,name)=>Boolean(user&&(user.role==='superadmin'||(user.role==='admin'&&parse(Array.isArray(user.permissions)?JSON.stringify(user.permissions):user.permissions,[]).includes(name))));
export function requireUser(req,res,next){if(!req.user) return next(new HttpError(401,'请先登录','LOGIN_REQUIRED'));next();}
export function requirePermission(name){return(req,res,next)=>{if(!hasPermission(req.user,name))return next(new HttpError(403,'没有此管理功能的权限','PERMISSION_DENIED'));next();};}
export function canUseAgent(identity,agent){
 if(!agent?.published) return false;
 return (identity.groups||[]).some(groupId=>{const group=get('SELECT agent_ids FROM groups WHERE id=?',groupId);const allowed=parse(group?.agent_ids,[]);return allowed.includes('*')||allowed.includes(agent.id);});
}
export function publicAgent(agent){
 const integration=get('SELECT platform,capabilities FROM integrations WHERE id=?',agent.integration_id);
 return {...agent,questions:parse(agent.questions,[]),recommended:Boolean(agent.recommended),published:Boolean(agent.published),homepage_visible:Boolean(agent.homepage_visible),platform:integration?.platform,capabilities:parse(integration?.capabilities,{})};
}
export function audit(req,action,target,details={}){
 // Only pass whitelisted metadata. Never serialize request bodies or exception messages.
 const allowed={};for(const key of ['fields','count','format','outcome','permission','status','reason','ids','recipientHash']) if(details[key]!==undefined)allowed[key]=details[key];
 run('INSERT INTO audit_logs(id,actor_id,action,target,details,created_at) VALUES(?,?,?,?,?,?)',id('audit_'),req?.identity?.id||req?.user?.id||'system',action,String(target),JSON.stringify(allowed),now());
}
const secureCookie=()=>process.env.COOKIE_SECURE==='true'||process.env.NODE_ENV==='production';
export const cookieOptions=()=>({httpOnly:true,secure:secureCookie(),sameSite:'lax',path:'/'});
export function setLoginCookie(res,token){res.cookie('school_session',token,{...cookieOptions(),maxAge:30*86400000});}
export function identityMiddleware(req,res,next){
 try{
  let guestToken=req.cookies.school_guest;let guest=guestToken?get('SELECT * FROM guests WHERE token_hash=?',hashToken(guestToken)):null;
  if(!guest){guestToken=randomBytes(32).toString('base64url');guest={id:id('g_'),created_at:now()};run('INSERT INTO guests(id,token_hash,created_at,last_seen) VALUES(?,?,?,?)',guest.id,hashToken(guestToken),guest.created_at,now());res.cookie('school_guest',guestToken,{...cookieOptions(),maxAge:365*86400000});}
  req.guestId=guest.id;
  const token=req.cookies.school_session;const session=token?get('SELECT s.*,u.active,u.session_version FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.id=?',hashToken(token)):null;
  const valid=session&&session.active&&session.version===session.session_version&&session.expires_at>now();
  req.user=valid?get('SELECT * FROM users WHERE id=?',session.user_id):null;
  if(token&&!valid)res.clearCookie('school_session',cookieOptions());
  const defaults=setting('defaults');
  const groups=req.user?all('SELECT group_id FROM user_groups WHERE user_id=?',req.user.id).map(row=>row.group_id):[defaults.guestGroupId];
  req.identity={id:req.user?.id||guest.id,type:req.user?'user':'guest',groups,user:req.user?publicUser(req.user):undefined,guestId:guest.id};
  next();
 }catch(error){next(error);}
}
export function originProtection(req,res,next){
 if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 const origin=req.headers.origin;
 if(req.headers['sec-fetch-site']==='cross-site')return next(new HttpError(403,'不允许跨站请求','CSRF_REJECTED'));
 if(origin){
  const accepted=new Set([new URL(process.env.PUBLIC_URL||'http://localhost:3000').origin]);
  if(process.env.NODE_ENV!=='production'){accepted.add('http://localhost:5173');accepted.add('http://127.0.0.1:5173');accepted.add('http://127.0.0.1:3000');}
  if(!accepted.has(origin))return next(new HttpError(403,'请求来源未获允许','CSRF_REJECTED'));
 }
 next();
}
export function homepageFor(identity){
 const homepage=structuredClone(setting('homepage'));
 const visibleKeys=new Set((identity.groups||[]).flatMap(groupId=>parse(get('SELECT content_keys FROM groups WHERE id=?',groupId)?.content_keys,[])));
 if(!visibleKeys.has('*'))for(const key of ['announcements','banners','recommended','categories','cards','questions','faq','help','contact','footer']){
  if(!visibleKeys.has(key)&&!(key==='cards'&&visibleKeys.has('agents')))homepage.modules={...homepage.modules,[key]:false};
 }
 for(const key of ['announcements','banners','questions','faq']){
  if(!visibleKeys.has('*')&&!visibleKeys.has(key))homepage[key]=[];
  else homepage[key]=(homepage[key]||[]).filter(item=>typeof item==='string'||!item.groups?.length||item.groups.some(g=>identity.groups.includes(g)));
 }
 for(const key of ['help','contact','footer'])if(!visibleKeys.has('*')&&!visibleKeys.has(key)){homepage[key]='';homepage.modules={...homepage.modules,[key]:false};}
 return homepage;
}
