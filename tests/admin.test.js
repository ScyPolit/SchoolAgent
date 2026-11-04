import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
process.env.DATABASE_PATH=':memory:';
process.env.NODE_ENV='test';
process.env.ENABLE_DEMO_ADAPTER='true';
process.env.ENCRYPTION_KEY=randomBytes(32).toString('hex');
const {createApp}=await import('../server/index.js');
const {db,run,get,id,now,setting,parse}=await import('../server/db.js');
const {hashPassword}=await import('../server/security.js');
const app=createApp(),server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api`;
const password=randomBytes(20).toString('hex'),passwordHash=await hashPassword(password);
for(const [key,role,permissions]of [['root','superadmin',[]],['manager','admin',['users','groups','agents','integrations','homepage','settings']],['member','user',[]]]){
 run('INSERT INTO users(id,email,name,password_hash,role,permissions,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)',key,key+'@example.test',key,passwordHash,role,JSON.stringify(permissions),now());
 run("INSERT INTO user_groups(user_id,group_id) VALUES(?,'member')",key);
}
function client(){const jar=new Map();return async(path,method='GET',body)=>{
 const response=await fetch(base+path,{method,headers:{cookie:[...jar].map(([k,v])=>k+'='+v).join(';'),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 for(const c of response.headers.getSetCookie()){const pair=c.split(';')[0],split=pair.indexOf('=');jar.set(pair.slice(0,split),pair.slice(split+1));}
 return {status:response.status,body:await response.json()};
};}
const root=client(),manager=client(),guest=client(),member=client();
test.before(async()=>{for(const [request,name]of [[root,'root'],[manager,'manager'],[member,'member']])assert.equal((await request('/auth/login','POST',{email:name+'@example.test',password})).status,200);});
test.after(()=>{server.close();db.close();});
let newGroup,newAgent;
test('admin catalog exposes only option metadata and independent function authorization',async()=>{
 const catalog=await manager('/admin/catalog');assert.equal(catalog.status,200);assert.ok(catalog.body.integrations.length>=2);assert.deepEqual(Object.keys(catalog.body.integrations[0]).sort(),['id','name','platform']);
 assert.equal((await guest('/admin/catalog')).status,403);assert.equal((await member('/admin/users')).status,403);
 assert.equal((await manager('/admin/statistics')).status,403);
});
test('create group, manually maintain members, and prevent ordinary admin altering defaults or admin membership',async()=>{
 const created=await manager('/admin/groups','POST',{name:'图书馆服务用户',agentIds:['demo-campus'],contentKeys:['help']});assert.equal(created.status,201);newGroup=created.body.id;
 assert.equal((await manager(`/admin/groups/${newGroup}/members`,'PUT',{userIds:['member']})).status,200);
 assert.deepEqual((await manager(`/admin/groups/${newGroup}/members`)).body.members,['member']);
 assert.equal((await manager(`/admin/groups/${newGroup}/members`,'PUT',{userIds:['root']})).status,403);
 assert.equal((await manager('/admin/groups/guest','PATCH',{agentIds:['*']})).status,403);
});
test('bulk account import returns per-row success/failure, never passwords',async()=>{
 const result=await manager('/admin/users/import','POST',{rows:[{email:'imported@example.test',name:'导入用户',password,groupIds:[newGroup]},{email:'invalid',name:'错误行',password},{email:'imported@example.test',name:'重复行',password}]});
 assert.equal(result.status,200);assert.deepEqual(result.body.results.map(row=>row.success),[true,false,false]);assert.ok(result.body.results[1].error);assert.ok(result.body.results[2].error);assert.ok(!JSON.stringify(result.body).includes(password));
 const elevated=await manager('/admin/users','POST',{email:'no-elevation@example.test',name:'越权管理员',password,role:'superadmin'});assert.equal(elevated.status,403);
});
test('group and homepage configuration changes affect guest and account bootstrap',async()=>{
 const saved=await root('/admin/settings/homepage','PUT',{schoolName:'校内测试大学',modules:{cards:false,footer:false},announcements:[{title:'仅授权组公告',content:'restricted-body',groups:[newGroup]}],help:'分组帮助正文',footer:'hidden-footer'});assert.equal(saved.status,200);
 const guestData=(await guest('/bootstrap')).body;assert.equal(guestData.homepage.schoolName,'校内测试大学');assert.equal(guestData.homepage.modules.cards,false);assert.deepEqual(guestData.homepage.announcements,[]);
 // The member remains in the default group as well; remove it to test exact content scope.
 run("DELETE FROM user_groups WHERE user_id='member' AND group_id='member'");
 await root('/admin/settings/homepage','PUT',{modules:{cards:true,recommended:true,footer:true}});
 const userData=(await member('/bootstrap')).body;assert.equal(userData.homepage.help,'分组帮助正文');assert.deepEqual(userData.homepage.announcements,[]);assert.equal(userData.homepage.modules.footer,false);
 assert.equal(userData.homepage.modules.cards,false);assert.equal(userData.homepage.modules.recommended,false);
 assert.equal((await root(`/admin/groups/${newGroup}`,'PATCH',{contentKeys:['help','announcements']})).status,200);
 assert.equal((await member('/bootstrap')).body.homepage.announcements[0].content,'restricted-body');
});
test('homepage hidden agent is directly usable, unpublish and grant revocation reject new execution',async()=>{
 const created=await root('/admin/agents','POST',{name:'授权测试应用',integrationId:'demo',published:true,homepageVisible:false});assert.equal(created.status,201);newAgent=created.body.id;
 assert.equal((await root('/admin/groups/guest','PATCH',{agentIds:['demo-campus',newAgent]})).status,200);
 assert.equal((await guest('/agents/'+newAgent)).status,200);
 assert.equal((await guest('/bootstrap')).body.agents.some(a=>a.id===newAgent),false);
 assert.equal((await root('/admin/agents/'+newAgent,'PATCH',{published:false})).status,200);
 assert.equal((await guest('/conversations','POST',{agentId:newAgent})).status,403);
 await root('/admin/agents/'+newAgent,'PATCH',{published:true});await root('/admin/groups/guest','PATCH',{agentIds:['demo-campus']});
 assert.equal((await guest('/agents/'+newAgent)).status,403);
});
test('integration credentials require distinct permission and never return plaintext',async()=>{
 assert.equal((await manager('/admin/integrations/dify','PATCH',{apiKey:'private-api-key'})).status,403);
 const updated=await root('/admin/integrations/dify','PATCH',{apiKey:'private-api-key',baseUrl:'https://dify.example.test/v1',config:{mode:'workflow',queryField:'question',historyField:'history',answerField:'answer'}});
 assert.equal(updated.status,200);assert.equal(updated.body.hasSecret,true);assert.ok(!JSON.stringify(updated.body).includes('private-api-key'));
 assert.notEqual(get("SELECT secret FROM integrations WHERE id='dify'").secret,'private-api-key');
 assert.equal((await root('/admin/integrations/dify','PATCH',{baseUrl:'javascript:alert(1)'})).status,400);
});
test('retention shortening requires confirmation and cleanup permission; preview reports actual rows',async()=>{
 assert.equal((await root('/admin/settings/retention','PUT',{guestServerDays:30})).body.code,'RETENTION_CONFIRMATION_REQUIRED');
 assert.equal((await manager('/admin/settings/retention','PUT',{guestServerDays:30,confirmShortening:true})).status,400);
 assert.equal((await root('/admin/retention/preview','POST',{guestServerDays:30})).status,200);
 assert.equal((await root('/admin/settings/retention','PUT',{guestServerDays:30,confirmShortening:true})).status,200);
 assert.equal(setting('retention').guestServerDays,30);
});
test('admin audit stores operation metadata without passwords, keys or message bodies',async()=>{
 const rows=(await root('/admin/audit')).body;assert.ok(rows.some(row=>row.action==='admin.integration_updated'));const serialized=JSON.stringify(rows);assert.ok(!serialized.includes(password));assert.ok(!serialized.includes('private-api-key'));assert.ok(!serialized.includes('restricted-body'));
});
