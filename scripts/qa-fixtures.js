// Explicit local QA fixture only. Never called by startup, migrations or Docker.
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
if(process.env.NODE_ENV!=='test'||process.env.ALLOW_QA_FIXTURES!=='true')throw new Error('QA fixtures require NODE_ENV=test and ALLOW_QA_FIXTURES=true.');
const {initCoreSchema,run,get,id,now,transaction,db}=await import('../server/db.js');
const {hashPassword}=await import('../server/security.js');
const {initChatSchema}=await import('../server/chat.js');
initCoreSchema();initChatSchema();
const credentials=[];
for(const [email,name,role,permissions]of [['qa.admin@example.test','测试管理员','superadmin',[]],['qa.member@example.test','测试用户','user',[]],['qa.limited@example.test','统计管理员','admin',['statistics','logs']]]){
 if(get('SELECT id FROM users WHERE email=?',email))continue;
 const password=randomBytes(24).toString('base64url');const userId=id('u_');const hash=await hashPassword(password);
 transaction(()=>{run('INSERT INTO users(id,email,name,password_hash,role,permissions,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)',userId,email,name,hash,role,JSON.stringify(permissions),now());run("INSERT INTO user_groups(user_id,group_id) VALUES(?,'member')",userId);});
 credentials.push({email,password,id:userId,role});
}
const owner=get("SELECT id FROM users WHERE email='qa.admin@example.test'");
const conversationId=id('c_'),messageId=id('m_'),versionId=id('v_'),stamp=now();
const content=Array.from({length:90},(_,i)=>`## 第 ${i+1} 节：校园服务中文导出\n\n这是用于检查中文字体、长文本换行、分页与分段图片的固定测试内容。部门联系方式、办理指南、办公地点与材料清单按消息顺序保留。请核对完整性，不应静默截断。\n\n| 部门 | 联系方式 | 办公地点 |\n| --- | --- | --- |\n| 校园服务 ${i+1} | [010-12345678](tel:01012345678) | 综合楼 ${i+1} 层 |\n\n[安全链接](https://example.test/service)\n`).join('\n')+'\n\n完整性末尾标记：一期导出验收终点 END_OF_EXPORT_QA_20261104';
transaction(()=>{
 run('INSERT INTO conversations(id,owner_type,owner_id,agent_id,title,upstream_user,active_version_id,created_at,updated_at,last_active_at) VALUES(?,?,?,?,?,?,?,?,?,?)',conversationId,'user',owner.id,'demo-campus','中文长文本导出检查',id('qa_upstream_'),versionId,stamp,stamp,stamp);
 run('INSERT INTO messages(id,conversation_id,content,created_at) VALUES(?,?,?,?)',messageId,conversationId,'请展示长文本、中文、表格和电话链接。',stamp);
 run('INSERT INTO answer_versions(id,message_id,invocation_id,content,status,created_at,finished_at) VALUES(?,?,?,?,?,?,?)',id('v_'),messageId,id('qa_call_'),'OLD_VERSION_SHOULD_NOT_BE_EXPORTED','completed',stamp-1,stamp-1);
 run('INSERT INTO answer_versions(id,message_id,invocation_id,content,status,created_at,finished_at) VALUES(?,?,?,?,?,?,?)',versionId,messageId,id('qa_call_'),content,'completed',stamp,stamp);
});
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/qa-credentials.json',JSON.stringify({credentials,conversationId},null,2),{mode:0o600});
db.close();console.log('Local QA fixtures created. Random credentials are stored in ignored artifacts/qa-credentials.json, not printed.');
