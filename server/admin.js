import {Router} from 'express';
import {z} from 'zod';
import {all,get,run,id,now,parse,setting,setSetting,transaction} from './db.js';
import {HttpError,PERMISSIONS,requirePermission,hasPermission,publicUser,hashPassword,encrypt,audit,hashToken} from './security.js';
import {sendAccountMail,sendMail} from './mail.js';

export const adminRouter=Router();
const str=z.string().trim().min(1).max(200);
const strings=z.array(z.string().max(200)).max(1000);
const bool=z.boolean();
const email=z.string().trim().email().max(254).transform(v=>v.toLowerCase());
function mustExist(table,value){const row=get(`SELECT * FROM ${table} WHERE id=?`,value);if(!row)throw new HttpError(404,'记录不存在','NOT_FOUND');return row;}
function userGroups(userId){return all('SELECT group_id FROM user_groups WHERE user_id=?',userId).map(v=>v.group_id);}
function adminUser(user){return {...publicUser(user),active:Boolean(user.active),emailVerified:Boolean(user.email_verified),email_verified:Boolean(user.email_verified),createdAt:user.created_at,groupIds:userGroups(user.id)};}
function checkManageUser(req,user){if(req.user.role!=='superadmin'&&(user.role!=='user'||user.id===req.user.id))throw new HttpError(403,'普通管理员不能修改管理员账号或自身授权','ADMIN_ESCALATION');}
function validateGroups(ids){for(const groupId of ids)mustExist('groups',groupId);}
function replaceGroups(userId,ids){run('DELETE FROM user_groups WHERE user_id=?',userId);for(const groupId of new Set(ids))run('INSERT INTO user_groups(user_id,group_id) VALUES(?,?)',userId,groupId);}
function elevatedFields(req,body){if(req.user.role!=='superadmin'&&('role'in body||'permissions'in body))throw new HttpError(403,'只有超级管理员可以更改管理员身份或授权','ADMIN_ESCALATION');}
const newUser=z.object({email,name:str,password:z.string().min(12).max(256),groupIds:strings.optional(),role:z.enum(['user','admin','superadmin']).optional(),permissions:z.array(z.enum(PERMISSIONS)).optional()});
async function createUser(req,input){
 elevatedFields(req,input);const body=newUser.parse(input);const groups=body.groupIds??[setting('defaults').userGroupId];validateGroups(groups);
 if(get('SELECT id FROM users WHERE email=?',body.email))throw new HttpError(409,'邮箱已存在','EMAIL_EXISTS');
 const userId=id('u_'),hash=await hashPassword(body.password);
 transaction(()=>{run('INSERT INTO users(id,email,name,password_hash,role,permissions,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)',userId,body.email,body.name,hash,body.role||'user',JSON.stringify(body.permissions||[]),now());replaceGroups(userId,groups);});
 audit(req,'admin.user_created',userId,{fields:Object.keys(body).filter(k=>k!=='password')});return adminUser(mustExist('users',userId));
}
adminRouter.get('/admin/permissions',(req,res,next)=>{if(!req.user||!['admin','superadmin'].includes(req.user.role))return next(new HttpError(403,'需要管理员权限','PERMISSION_DENIED'));res.json(PERMISSIONS);});
adminRouter.get('/admin/catalog',(req,res)=>{
 if(!req.user||!['admin','superadmin'].includes(req.user.role))throw new HttpError(403,'需要管理员权限','PERMISSION_DENIED');
 const permitted=permissions=>permissions.some(permission=>hasPermission(req.user,permission));
 res.json({
  groups:permitted(['users','groups','settings'])?all('SELECT id,name FROM groups'):[],
  agents:permitted(['agents','groups','statistics','logs','conversations'])?all('SELECT id,name,category FROM agents ORDER BY sort_order'):[],
  integrations:permitted(['agents','integrations'])?all('SELECT id,name,platform FROM integrations'):[],
 });
});
adminRouter.get('/admin/overview',requirePermission('statistics'),(req,res)=>{
 const exists=table=>Boolean(get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table));
 const userCount=get('SELECT count(*) count FROM users').count;const agentCount=get('SELECT count(*) count FROM agents').count;
 const conversationCount=exists('conversations')?get('SELECT count(*) count FROM conversations').count:0;
 const callCount=exists('usage_logs')?get("SELECT count(*) count FROM usage_logs WHERE execution_requested=1 AND execution_mode='upstream'").count:0;
 const attempts=exists('usage_logs')?get('SELECT count(*) count FROM usage_logs').count:0;
 const demoCalls=exists('usage_logs')?get("SELECT count(*) count FROM usage_logs WHERE execution_mode='demo'").count:0;
 res.json({users:userCount,agents:agentCount,conversations:conversationCount,calls:callCount,attempts,demoCalls,userCount,agentCount,conversationCount,callCount,publishedAgents:get('SELECT count(*) count FROM agents WHERE published=1').count,smtpConfigured:Boolean(setting('smtp').host),development:process.env.ENABLE_DEMO_ADAPTER==='true'&&process.env.NODE_ENV!=='production'});
});
adminRouter.get('/admin/users',requirePermission('users'),(req,res)=>{
 const q=String(req.query.q||'').slice(0,200);res.json(all('SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 1000','%'+q+'%','%'+q+'%').map(adminUser));
});
adminRouter.post('/admin/users',requirePermission('users'),async(req,res)=>res.status(201).json(await createUser(req,req.body)));
adminRouter.post('/admin/users/import',requirePermission('users'),async(req,res)=>{
 const rows=z.array(z.record(z.string(),z.unknown())).min(1).max(200).parse(req.body.rows);const results=[];
 for(const [index,row]of rows.entries()){try{const user=await createUser(req,row);results.push({index,email:row.email,success:true,id:user.id});}catch(error){results.push({index,email:typeof row.email==='string'?row.email:'',success:false,error:error instanceof z.ZodError?error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('；'):error instanceof HttpError?error.message:'无法创建账号',code:error.code||'IMPORT_ERROR'});}}
 audit(req,'admin.users_imported','users',{count:rows.length,outcome:`success:${results.filter(v=>v.success).length}`});res.json({results});
});
adminRouter.patch('/admin/users/:id',requirePermission('users'),(req,res)=>{
 const user=mustExist('users',req.params.id);checkManageUser(req,user);elevatedFields(req,req.body);
 const body=z.object({name:str.optional(),active:bool.optional(),role:z.enum(['user','admin','superadmin']).optional(),permissions:z.array(z.enum(PERMISSIONS)).optional(),groupIds:strings.optional()}).parse(req.body);
 if(user.id===req.user.id&&(body.active===false||(body.role&&body.role!=='superadmin')))throw new HttpError(400,'不能停用或降级当前超级管理员','SELF_LOCKOUT');
 if(user.role==='superadmin'&&(body.active===false||body.role&&body.role!=='superadmin')&&get("SELECT count(*) count FROM users WHERE role='superadmin' AND active=1").count<=1)throw new HttpError(400,'至少保留一位可用超级管理员','LAST_ADMIN');
 if(body.groupIds)validateGroups(body.groupIds);
 transaction(()=>{
  for(const field of ['name','active','role','permissions'])if(body[field]!==undefined)run(`UPDATE users SET ${field}=? WHERE id=?`,field==='permissions'?JSON.stringify(body[field]):typeof body[field]==='boolean'?Number(body[field]):body[field],user.id);
  if(body.groupIds)replaceGroups(user.id,body.groupIds);
  if(body.active===false||(body.role&&body.role!==user.role)||(body.permissions&&JSON.stringify(body.permissions)!==user.permissions)){run('UPDATE users SET session_version=session_version+1 WHERE id=?',user.id);run('DELETE FROM sessions WHERE user_id=?',user.id);}
 });
 audit(req,'admin.user_updated',user.id,{fields:Object.keys(body)});res.json(adminUser(mustExist('users',user.id)));
});
adminRouter.post('/admin/users/:id/reset-password',requirePermission('users'),async(req,res)=>{
 const user=mustExist('users',req.params.id);checkManageUser(req,user);await sendAccountMail(user,'reset');audit(req,'admin.password_reset_requested',user.id);res.json({mailSent:true,message:'SMTP 已接受密码重置邮件，管理员无法查看新密码。'});
});

function groupView(row){return {...row,agentIds:parse(row.agent_ids,[]),contentKeys:parse(row.content_keys,[]),agent_ids:parse(row.agent_ids,[]),content_keys:parse(row.content_keys,[]),members:all('SELECT user_id FROM user_groups WHERE group_id=?',row.id).map(r=>r.user_id)};}
function groupAdminGuard(req,groupId){if(req.user.role!=='superadmin'&&(Object.values(setting('defaults')).includes(groupId)||get("SELECT u.id FROM user_groups ug JOIN users u ON ug.user_id=u.id WHERE ug.group_id=? AND u.role IN ('admin','superadmin') LIMIT 1",groupId)))throw new HttpError(403,'只有超级管理员可以修改默认组或包含管理员的组','ADMIN_ESCALATION');}
function groupInput(input){const body=z.object({name:str.optional(),agentIds:strings.optional(),contentKeys:strings.optional()}).parse({...input,agentIds:input.agentIds??input.agent_ids,contentKeys:input.contentKeys??input.content_keys});for(const agentId of body.agentIds||[])if(agentId!=='*')mustExist('agents',agentId);return body;}
adminRouter.get('/admin/groups',requirePermission('groups'),(req,res)=>res.json(all('SELECT * FROM groups').map(groupView)));
adminRouter.post('/admin/groups',requirePermission('groups'),(req,res)=>{const body=groupInput(req.body);if(!body.name)throw new HttpError(400,'请输入用户组名称');const groupId=id('group_');run('INSERT INTO groups VALUES(?,?,?,?)',groupId,body.name,JSON.stringify(body.agentIds||[]),JSON.stringify(body.contentKeys||[]));audit(req,'admin.group_created',groupId);res.status(201).json(groupView(mustExist('groups',groupId)));});
adminRouter.patch('/admin/groups/:id',requirePermission('groups'),(req,res)=>{mustExist('groups',req.params.id);groupAdminGuard(req,req.params.id);const body=groupInput(req.body);for(const [key,column]of [['name','name'],['agentIds','agent_ids'],['contentKeys','content_keys']])if(body[key]!==undefined)run(`UPDATE groups SET ${column}=? WHERE id=?`,key==='name'?body[key]:JSON.stringify(body[key]),req.params.id);audit(req,'admin.group_updated',req.params.id,{fields:Object.keys(body)});res.json(groupView(mustExist('groups',req.params.id)));});
adminRouter.delete('/admin/groups/:id',requirePermission('groups'),(req,res)=>{mustExist('groups',req.params.id);groupAdminGuard(req,req.params.id);if(Object.values(setting('defaults')).includes(req.params.id))throw new HttpError(400,'默认组不能删除，请先更换默认组');run('DELETE FROM groups WHERE id=?',req.params.id);audit(req,'admin.group_deleted',req.params.id);res.json({message:'用户组已删除'});});
adminRouter.get('/admin/groups/:id/members',requirePermission('groups'),(req,res)=>{
 mustExist('groups',req.params.id);
 const candidates=all("SELECT id,email,name,role FROM users ORDER BY name").filter(user=>req.user.role==='superadmin'||user.role==='user');
 const members=all('SELECT user_id FROM user_groups WHERE group_id=?',req.params.id).map(row=>row.user_id);
 res.json({members,candidates});
});
adminRouter.put('/admin/groups/:id/members',requirePermission('groups'),(req,res)=>{
 mustExist('groups',req.params.id);groupAdminGuard(req,req.params.id);
 const userIds=strings.parse(req.body.userIds);
 for(const userId of userIds){const user=mustExist('users',userId);if(req.user.role!=='superadmin'&&user.role!=='user')throw new HttpError(403,'普通管理员不能调整管理员用户组','ADMIN_ESCALATION');}
 transaction(()=>{run('DELETE FROM user_groups WHERE group_id=?',req.params.id);for(const userId of new Set(userIds))run('INSERT INTO user_groups(user_id,group_id) VALUES(?,?)',userId,req.params.id);});
 audit(req,'admin.group_members_updated',req.params.id,{count:userIds.length});res.json({message:'用户组成员已更新',members:userIds});
});

function integrationView(row){return {id:row.id,name:row.name,platform:row.platform,baseUrl:row.base_url,base_url:row.base_url,appId:row.app_id,app_id:row.app_id,hasSecret:Boolean(row.secret),config:parse(row.config),capabilities:parse(row.capabilities),created_at:row.created_at};}
function integrationInput(input){
 const body=z.object({name:str.optional(),platform:z.enum(['dify','dify-chatflow','dify-workflow','polymas','demo']).optional(),baseUrl:z.string().max(2000).optional(),appId:z.string().max(200).optional(),apiKey:z.string().max(16000).optional(),clearSecret:bool.optional(),config:z.record(z.string(),z.unknown()).optional()}).parse({...input,baseUrl:input.baseUrl??input.base_url,appId:input.appId??input.app_id,apiKey:input.apiKey??input.secret});
 if(body.baseUrl){let url;try{url=new URL(body.baseUrl);}catch{throw new HttpError(400,'API 地址格式不正确');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.search)throw new HttpError(400,'API 基础地址仅支持不含凭据、查询串及片段的 HTTP(S) URL');}
 if(body.platform==='demo'&&!(process.env.ENABLE_DEMO_ADAPTER==='true'&&process.env.NODE_ENV!=='production'))throw new HttpError(400,'生产环境禁止开发测试适配器');
 // Capabilities are measured by integration tests, never accepted as self-certified input.
 return body;
}
adminRouter.get('/admin/integrations',requirePermission('integrations'),(req,res)=>res.json(all('SELECT * FROM integrations ORDER BY created_at').map(integrationView)));
adminRouter.post('/admin/integrations',requirePermission('integrations'),requirePermission('credentials'),(req,res)=>{
 const body=integrationInput(req.body);if(!body.name||!body.platform)throw new HttpError(400,'需要名称和平台类型');const integrationId=id('int_');run('INSERT INTO integrations(id,name,platform,base_url,app_id,secret,config,created_at) VALUES(?,?,?,?,?,?,?,?)',integrationId,body.name,body.platform,body.baseUrl||'',body.appId||'',encrypt(body.apiKey||''),JSON.stringify(body.config||{}),now());audit(req,'admin.integration_created',integrationId,{fields:Object.keys(body).filter(k=>k!=='apiKey')});res.status(201).json(integrationView(mustExist('integrations',integrationId)));
});
adminRouter.patch('/admin/integrations/:id',requirePermission('integrations'),requirePermission('credentials'),(req,res)=>{
 mustExist('integrations',req.params.id);const body=integrationInput(req.body);
 transaction(()=>{
  for(const [field,column]of [['name','name'],['platform','platform'],['baseUrl','base_url'],['appId','app_id'],['config','config']])if(body[field]!==undefined)run(`UPDATE integrations SET ${column}=? WHERE id=?`,field==='config'?JSON.stringify(body[field]):body[field],req.params.id);
  if(body.apiKey||body.clearSecret)run('UPDATE integrations SET secret=? WHERE id=?',body.clearSecret?'':encrypt(body.apiKey),req.params.id);
  if(Object.keys(body).some(key=>key!=='name'))run("UPDATE integrations SET capabilities='{}' WHERE id=?",req.params.id);
 });audit(req,'admin.integration_updated',req.params.id,{fields:Object.keys(body).filter(k=>k!=='apiKey')});res.json(integrationView(mustExist('integrations',req.params.id)));
});

function agentView(row){return {...row,questions:parse(row.questions,[]),recommended:Boolean(row.recommended),published:Boolean(row.published),homepageVisible:Boolean(row.homepage_visible),sortOrder:row.sort_order,integrationId:row.integration_id};}
function agentInput(input){const body=z.object({name:str.optional(),avatar:z.string().max(1000).optional(),description:z.string().max(4000).optional(),category:z.string().max(100).optional(),questions:strings.optional(),sortOrder:z.coerce.number().int().min(-100000).max(100000).optional(),recommended:bool.optional(),published:bool.optional(),homepageVisible:bool.optional(),integrationId:z.string().optional()}).parse({...input,sortOrder:input.sortOrder??input.sort_order,homepageVisible:input.homepageVisible??input.homepage_visible,integrationId:input.integrationId??input.integration_id});if(body.integrationId)mustExist('integrations',body.integrationId);return body;}
adminRouter.get('/admin/agents',requirePermission('agents'),(req,res)=>res.json(all('SELECT * FROM agents ORDER BY sort_order,created_at').map(agentView)));
adminRouter.post('/admin/agents',requirePermission('agents'),(req,res)=>{const body=agentInput(req.body);if(!body.name||!body.integrationId)throw new HttpError(400,'需要名称和接入实例');const agentId=id('agent_');run('INSERT INTO agents(id,name,avatar,description,category,questions,sort_order,recommended,published,homepage_visible,integration_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',agentId,body.name,body.avatar||'🎓',body.description||'',body.category||'校园服务',JSON.stringify(body.questions||[]),body.sortOrder||0,Number(body.recommended||false),Number(body.published||false),Number(body.homepageVisible!==false),body.integrationId,now());audit(req,'admin.agent_created',agentId);res.status(201).json(agentView(mustExist('agents',agentId)));});
adminRouter.patch('/admin/agents/:id',requirePermission('agents'),(req,res)=>{mustExist('agents',req.params.id);const body=agentInput(req.body);for(const [field,column]of [['name','name'],['avatar','avatar'],['description','description'],['category','category'],['questions','questions'],['sortOrder','sort_order'],['recommended','recommended'],['published','published'],['homepageVisible','homepage_visible'],['integrationId','integration_id']])if(body[field]!==undefined)run(`UPDATE agents SET ${column}=? WHERE id=?`,field==='questions'?JSON.stringify(body[field]):typeof body[field]==='boolean'?Number(body[field]):body[field],req.params.id);audit(req,'admin.agent_updated',req.params.id,{fields:Object.keys(body)});res.json(agentView(mustExist('agents',req.params.id)));});
adminRouter.delete('/admin/agents/:id',requirePermission('agents'),(req,res)=>{mustExist('agents',req.params.id);run('UPDATE agents SET published=0,homepage_visible=0 WHERE id=?',req.params.id);audit(req,'admin.agent_unpublished',req.params.id);res.json({message:'智能体已下架，历史记录保留'});});

const content=z.union([z.string().max(12000),z.object({title:z.string().max(500).optional(),content:z.string().max(12000).optional(),text:z.string().max(12000).optional(),question:z.string().max(1000).optional(),answer:z.string().max(12000).optional(),description:z.string().max(12000).optional(),label:z.string().max(500).optional(),agentId:z.string().max(200).optional(),image:z.string().max(2000).optional(),url:z.string().max(2000).optional(),href:z.string().max(2000).optional(),groups:strings.optional()})]);
const homepageSchema=z.object({schoolName:z.string().max(200),platformName:z.string().max(200),logo:z.string().max(2000),themeColor:z.string().regex(/^#[a-fA-F0-9]{6}$/),welcome:z.string().max(500),subtitle:z.string().max(1000),announcements:z.array(content).max(100),banners:z.array(content).max(100),questions:z.array(content).max(100),faq:z.array(content).max(100),help:z.string().max(12000),contact:z.string().max(12000),footer:z.string().max(4000),modules:z.record(z.string(),z.boolean())});
const retentionSchema=z.object({guestBrowserDays:z.coerce.number().int().min(1).max(36500),guestServerDays:z.coerce.number().int().min(1).max(36500),usageDays:z.coerce.number().int().min(1).max(36500),auditDays:z.coerce.number().int().min(1).max(36500),shareDays:z.coerce.number().int().min(1).max(36500)});
function settingsView(req){const smtp=setting('smtp');return {homepage:hasPermission(req.user,'homepage')?setting('homepage'):undefined,retention:hasPermission(req.user,'settings')?setting('retention'):undefined,defaults:hasPermission(req.user,'settings')?setting('defaults'):undefined,smtp:hasPermission(req.user,'settings')?{...smtp,password:'',hasPassword:Boolean(smtp.password)}:undefined};}
adminRouter.get('/admin/settings',(req,res,next)=>{if(!hasPermission(req.user,'settings')&&!hasPermission(req.user,'homepage'))return next(new HttpError(403,'没有设置管理权限'));res.json(settingsView(req));});
adminRouter.post('/admin/retention/preview',requirePermission('settings'),requirePermission('cleanup'),(req,res)=>{
 const policy=retentionSchema.parse({...setting('retention'),...req.body});const day=86400000;
 const conversations=get("SELECT count(*) count FROM conversations WHERE owner_type='guest' AND last_active_at<?",now()-policy.guestServerDays*day).count;
 const usage=get('SELECT count(*) count FROM usage_logs WHERE started_at<?',now()-policy.usageDays*day).count;
 const audits=get('SELECT count(*) count FROM audit_logs WHERE created_at<?',now()-policy.auditDays*day).count;
 res.json({guestConversations:conversations,usageLogs:usage,auditLogs:audits,message:'此预览按当前时刻计算。保存缩短规则后，尚存的历史数据同样适用；定时任务每小时执行。'});
});
adminRouter.put('/admin/settings/:key',(req,res,next)=>{
 const key=req.params.key;if(!['homepage','retention','defaults','smtp'].includes(key))throw new HttpError(404,'设置项不存在');
 if(!hasPermission(req.user,key==='homepage'?'homepage':'settings'))throw new HttpError(403,'没有设置管理权限');
 let value;
 if(key==='homepage')value=homepageSchema.parse({...setting(key),...req.body});
 if(key==='retention'){
  value=retentionSchema.parse({...setting(key),...req.body});const shortening=Object.entries(value).some(([k,v])=>v<setting(key)[k]);
  if(shortening&&(!hasPermission(req.user,'cleanup')||req.body.confirmShortening!==true))throw new HttpError(400,'缩短保留期限需要清理权限，并确认规则将作用于已有记录','RETENTION_CONFIRMATION_REQUIRED');
 }
 if(key==='defaults'){
  if(req.user.role!=='superadmin')throw new HttpError(403,'只有超级管理员可更改默认权限组','ADMIN_ESCALATION');
  value=z.object({guestGroupId:str,userGroupId:str}).parse(req.body);validateGroups(Object.values(value));
 }
 if(key==='smtp'){
  if(!hasPermission(req.user,'credentials'))throw new HttpError(403,'SMTP 维护需要凭据权限');
  value=z.object({host:z.string().max(254),port:z.coerce.number().int().min(1).max(65535),encryption:z.enum(['starttls','tls','none']),from:z.union([z.literal(''),email]),username:z.string().max(254),password:z.string().max(16000)}).parse({...setting(key),...req.body,password:req.body.password||''});
  value.password=req.body.clearPassword?'':value.password?encrypt(value.password):setting(key).password;
 }
 setSetting(key,value);audit(req,'admin.settings_updated',key,{fields:Object.keys(req.body).filter(k=>!['password','confirmShortening'].includes(k))});res.json({message:'设置已保存',...settingsView(req)});
});
adminRouter.post('/admin/smtp/test',requirePermission('settings'),requirePermission('credentials'),async(req,res)=>{const to=email.parse(req.body.to);await sendMail(to,'校园智能体 SMTP 测试','这是一封真实 SMTP 测试邮件。请确认收件成功后再进行注册和密码找回验收。');audit(req,'admin.smtp_test','smtp',{recipientHash:hashToken(to),outcome:'accepted'});res.json({mailSent:true,message:'SMTP 已接受测试邮件，请在收件箱确认实际投递。'});});
adminRouter.get('/admin/audit',requirePermission('audit'),(req,res)=>{const action=String(req.query.action||'').slice(0,200);const from=Number(req.query.from)||0;const to=Number(req.query.to)||now();res.json(all('SELECT * FROM audit_logs WHERE created_at>=? AND created_at<=? AND action LIKE ? ORDER BY created_at DESC LIMIT 1000',from,to,'%'+action+'%').map(row=>({...row,details:parse(row.details)})));});
