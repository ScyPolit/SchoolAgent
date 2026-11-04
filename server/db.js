import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

const databasePath = process.env.DATABASE_PATH || './data/school-agent.sqlite';
if(databasePath !== ':memory:') mkdirSync(path.dirname(path.resolve(databasePath)), {recursive:true});
export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
export const all=(sql,...params)=>db.prepare(sql).all(...params);
export const get=(sql,...params)=>db.prepare(sql).get(...params);
export const run=(sql,...params)=>db.prepare(sql).run(...params);
export const id=(prefix='')=>prefix+randomUUID();
export const now=()=>Date.now();
export function parse(value,fallback={}) {try{return value==null?fallback:JSON.parse(value);}catch{return fallback;}}
export const setting=(key,fallback={})=>parse(get('SELECT value FROM settings WHERE key=?',key)?.value,fallback);
export const setSetting=(key,value)=>run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));
export function transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}

export function initCoreSchema(){
 db.exec(`
 CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL COLLATE NOCASE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin','superadmin')),permissions TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,email_verified INTEGER NOT NULL DEFAULT 0,session_version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,agent_ids TEXT NOT NULL DEFAULT '[]',content_keys TEXT NOT NULL DEFAULT '["*"]');
 CREATE TABLE IF NOT EXISTS user_groups(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,PRIMARY KEY(user_id,group_id));
 CREATE TABLE IF NOT EXISTS guests(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,version INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
 CREATE TABLE IF NOT EXISTS email_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
 CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens(user_id,purpose);
 CREATE TABLE IF NOT EXISTS external_identities(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,subject TEXT NOT NULL,group_mapping TEXT NOT NULL DEFAULT '{}',UNIQUE(provider,subject));
 CREATE TABLE IF NOT EXISTS integrations(id TEXT PRIMARY KEY,name TEXT NOT NULL,platform TEXT NOT NULL,base_url TEXT NOT NULL DEFAULT '',app_id TEXT NOT NULL DEFAULT '',secret TEXT NOT NULL DEFAULT '',config TEXT NOT NULL DEFAULT '{}',capabilities TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar TEXT NOT NULL DEFAULT '🏫',description TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '校园服务',questions TEXT NOT NULL DEFAULT '[]',sort_order INTEGER NOT NULL DEFAULT 0,recommended INTEGER NOT NULL DEFAULT 0,published INTEGER NOT NULL DEFAULT 0,homepage_visible INTEGER NOT NULL DEFAULT 1,integration_id TEXT REFERENCES integrations(id),created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS audit_time ON audit_logs(created_at);
 INSERT OR IGNORE INTO schema_migrations VALUES(1,unixepoch()*1000);
 `);
 const initial = {
  homepage:{schoolName:'校园智慧服务',platformName:'校园智能体',logo:'',themeColor:'#047857',welcome:'你好，今天需要什么帮助？',subtitle:'让校园服务触手可及。选择智能体，开始一次高效的对话。',announcements:[{title:'欢迎使用校园智能体平台',content:'仅供校内网络或 VPN 访问。真实应用接入状态请查看智能体说明。',groups:[]}],banners:[],questions:['如何查找部门联系电话？','校园服务有哪些办理入口？','如何联系服务支持？'],faq:[{question:'可以在校外使用吗？',answer:'请先连接学校 VPN，所有入口均限校内网络访问。'},{question:'游客的聊天会保存多久？',answer:'当前浏览器默认保留访问权限 7 天；服务器正文按学校保留策略管理。'}],help:'选择智能体即可提问。请勿输入与问题无关的个人敏感信息。',contact:'请由学校管理员配置服务联系方式',footer:'校园智能体 · 让服务更有温度',modules:{announcements:true,banners:true,recommended:true,categories:true,cards:true,questions:true,faq:true,help:true,contact:true,footer:true}},
  retention:{guestBrowserDays:7,guestServerDays:180,usageDays:180,auditDays:180,shareDays:7},defaults:{guestGroupId:'guest',userGroupId:'member'},smtp:{host:process.env.SMTP_HOST||'',port:Number(process.env.SMTP_PORT)||587,encryption:process.env.SMTP_ENCRYPTION||'starttls',from:process.env.SMTP_FROM||'',username:'',password:''}
 };
 for(const [key,value] of Object.entries(initial)) if(!get('SELECT key FROM settings WHERE key=?',key)) setSetting(key,value);
 run("INSERT OR IGNORE INTO groups(id,name,agent_ids,content_keys) VALUES('guest','游客默认组','[]','[\"*\"]')");
 run("INSERT OR IGNORE INTO groups(id,name,agent_ids,content_keys) VALUES('member','注册用户默认组','[]','[\"*\"]')");
 for(const [integrationId,name,platform] of [['polymas','Polymas · 待正式资料','polymas'],['dify','校内 Dify · 待配置','dify-chatflow']]){
  run('INSERT OR IGNORE INTO integrations(id,name,platform,created_at) VALUES(?,?,?,?)',integrationId,name,platform,now());
 }
 run('INSERT OR IGNORE INTO agents(id,name,description,category,avatar,integration_id,created_at) VALUES(?,?,?,?,?,?,?)','directory','电话本 / 政务服务智能体','电话查询与办事指南；待配置正式 Polymas API 后上架。','校园服务','☎️','polymas',now());
 run('INSERT OR IGNORE INTO agents(id,name,description,category,avatar,integration_id,created_at) VALUES(?,?,?,?,?,?,?)','dify-campus','校内 Dify 智能体','待填写校内发布应用信息后上架。','校园服务','🎓','dify',now());
 if(process.env.ENABLE_DEMO_ADAPTER==='true' && process.env.NODE_ENV!=='production'){
  run('INSERT OR IGNORE INTO integrations(id,name,platform,created_at) VALUES(?,?,?,?)','demo','开发测试适配器 · 非真实 AI','demo',now());
  run('INSERT OR IGNORE INTO agents(id,name,description,category,avatar,recommended,published,integration_id,questions,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)','demo-campus','校园助手 · 开发测试','仅用于验证聊天、版本、分享和导出流程；不是真实校园业务回答。','开发测试','🧪',1,1,'demo',JSON.stringify(['介绍一下平台的功能','如何保留对话记录？','展示表格与电话链接']),now());
  for(const groupId of ['guest','member']){
   const group=get('SELECT agent_ids FROM groups WHERE id=?',groupId);const ids=parse(group.agent_ids,[]);
   if(!ids.includes('demo-campus')) run('UPDATE groups SET agent_ids=? WHERE id=?',JSON.stringify([...ids,'demo-campus']),groupId);
  }
 }
}
