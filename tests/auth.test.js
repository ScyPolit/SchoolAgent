// Auth security scenarios against the actual HTTP API and isolated in-memory SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

process.env.DATABASE_PATH=':memory:';
process.env.NODE_ENV='test';
process.env.ENABLE_DEMO_ADAPTER='true';
process.env.ENCRYPTION_KEY=randomBytes(32).toString('hex');
const {createApp}=await import('../server/index.js');
const {db,run,get,id,now,parse,setting}=await import('../server/db.js');
const {hashPassword,hashToken}=await import('../server/security.js');
const app=createApp();
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api`;

function client(){
 const cookies=new Map();
 return async(path,method='GET',body)=>{
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join(';')},body:body===undefined?undefined:JSON.stringify(body)});
  for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0];const split=pair.indexOf('=');cookies.set(pair.slice(0,split),pair.slice(split+1));}
  return {status:response.status,body:await response.json()};
 };
}
test.after(()=>{server.close();db.close();});
const password='a-unique-long-test-password';
test('registration never says mail was sent when SMTP is missing; unverified user cannot login',async()=>{
 const request=client();const result=await request('/auth/register','POST',{email:'new@example.test',name:'新用户',password});
 assert.equal(result.status,201);assert.equal(result.body.mailSent,false);
 assert.equal((await request('/auth/login','POST',{email:'new@example.test',password})).body.code,'EMAIL_NOT_VERIFIED');
 const user=get('SELECT * FROM users WHERE email=?','new@example.test');
 const token=randomBytes(32).toString('base64url');
 run('INSERT INTO email_tokens(id,user_id,purpose,expires_at) VALUES(?,?,?,?)',hashToken(token),user.id,'verify',now()+60000);
 assert.equal((await request('/auth/verify','POST',{token})).status,200);
 assert.equal((await request('/auth/verify','POST',{token})).status,400);
 assert.equal((await request('/auth/login','POST',{email:user.email,password})).status,200);
});
test('password reset consumes token once and revokes existing sessions',async()=>{
 const request=client();const user=get('SELECT * FROM users WHERE email=?','new@example.test');
 await request('/auth/login','POST',{email:user.email,password});
 const token=randomBytes(32).toString('base64url');
 run('INSERT INTO email_tokens(id,user_id,purpose,expires_at) VALUES(?,?,?,?)',hashToken(token),user.id,'reset',now()+60000);
 assert.equal((await request('/auth/reset-password','POST',{token,password:password+'2'})).status,200);
 assert.equal((await request('/auth/me')).status,401);
 assert.equal((await request('/auth/reset-password','POST',{token,password})).status,400);
});
test('restricted admin cannot change roles, credentials, default groups or read/export/clear conversations',async()=>{
 const userId=id('u_');run('INSERT INTO users(id,email,name,password_hash,role,permissions,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)',userId,'limited@example.test','受限管理员',await hashPassword(password),'admin',JSON.stringify(['users','groups','logs','statistics','integrations']),now());
 run("INSERT INTO user_groups(user_id,group_id) VALUES(?,'member')",userId);
 const request=client();assert.equal((await request('/auth/login','POST',{email:'limited@example.test',password})).status,200);
 assert.equal((await request('/admin/users/'+userId,'PATCH',{permissions:['content_view']})).status,403);
 assert.equal((await request('/admin/groups/guest','PATCH',{agentIds:['*']})).status,403);
 assert.equal((await request('/admin/integrations/dify','PATCH',{apiKey:'a-secret-that-must-not-leak'})).status,403);
 assert.equal((await request('/admin/conversations/unknown')).status,403);
 assert.equal((await request('/admin/conversations/unknown/export?format=md')).status,403);
 assert.equal((await request('/admin/conversations/purge','POST',{ids:['unknown'],confirm:true})).status,403);
});
test('disabled accounts lose authenticated access immediately',async()=>{
 const request=client();await request('/auth/login','POST',{email:'limited@example.test',password});
 const user=get('SELECT id FROM users WHERE email=?','limited@example.test');run('UPDATE users SET active=0 WHERE id=?',user.id);
 assert.equal((await request('/auth/me')).status,401);
 assert.equal((await request('/auth/login','POST',{email:'limited@example.test',password})).body.code,'ACCOUNT_DISABLED');
});
test('cross-site state changes are rejected by service API',async()=>{
 const result=await fetch(base+'/auth/logout',{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}'});
 assert.equal(result.status,403);assert.equal((await result.json()).code,'CSRF_REJECTED');
});
