// Authenticated HTTP integration with a local Polymas protocol fixture, not the cloud service.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, createHash, createDecipheriv } from 'node:crypto';
import { readSSE } from '../server/adapters/sse.js';

process.env.DATABASE_PATH=':memory:';
process.env.NODE_ENV='test';
process.env.ENCRYPTION_KEY=randomBytes(32).toString('hex');
const {createApp}=await import('../server/index.js');
const {db,run,get,now}=await import('../server/db.js');
const {hashPassword}=await import('../server/security.js');
const password=randomBytes(24).toString('hex');
const app=createApp();
run('INSERT INTO users(id,email,name,password_hash,role,permissions,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)','fixture-admin','polymas-admin@example.test','管理员',await hashPassword(password),'superadmin','[]',now());
run("INSERT INTO user_groups(user_id,group_id) VALUES('fixture-admin','member')");
const calls=[];
let releaseStream;
const upstream=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url.startsWith('/api/token?')) {
    const params=new URL(req.url,'http://localhost').searchParams;
    assert.equal(params.get('appId'),'fixture-gateway');
    assert.equal(params.get('sign'),createHash('md5').update('fixture-gatewayfixture-app-key'+params.get('timestamp')).digest('hex'));
    res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({code:200,data:{access_token:'fixture-access-token',expires_in:7200}}));
  }
  let bytes='';for await(const chunk of req)bytes+=chunk;
  let body=JSON.parse(bytes);
  if(body.secretParam){const key=Buffer.from(createHash('md5').update('fixture-param-key').digest('hex'),'utf8');const cipher=createDecipheriv('aes-256-ecb',key,null);cipher.setAutoPadding(false);body=JSON.parse(Buffer.concat([cipher.update(Buffer.from(body.secretParam,'base64')),cipher.final()]).toString('utf8').replace(/\0+$/,''));}
  calls.push({path:req.url,auth:req.headers.authorization,body});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(body.appCode==='fixture-stream-bot') {
    res.write(`event:ANSWER\ndata:${JSON.stringify({text:'实时第一段',event:{eventType:'LLM'}})}\n\n`);
    releaseStream=()=>res.end(`event:OUT_COMPLETE\ndata:${JSON.stringify({text:'正式最终答案',context:{sessionNid:'stream-session',chatNid:'stream-chat'}})}\n\n`);
    return;
  }
  if(req.url==='/bot/v2/tool')res.end(`event:ANSWER\ndata:${JSON.stringify({text:'private internal draft'})}\n\nevent:OUT_COMPLETE\ndata:${JSON.stringify({text:JSON.stringify({answer:'工作流最终答案'}),context:{sessionNid:'fixture-session',chatNid:'fixture-chat'}})}\n\n`);
  else res.end(`data:${JSON.stringify({messageType:'TEXT',end:true,context:{answer:'助手最终答案',sessionNid:'fixture-assistant-session',chatNid:'fixture-assistant-chat'}})}\n\n`);
});

async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
const upstreamUrl=await listen(upstream),server=http.createServer(app),base=await listen(server);
function client(){const jar=new Map();return async(path,method='GET',body)=>{
 const response=await fetch(base+'/api'+path,{method,headers:{cookie:[...jar].map(([key,value])=>`${key}=${value}`).join('; '),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],separator=pair.indexOf('=');jar.set(pair.slice(0,separator),pair.slice(separator+1));}
 return response;
};}
const admin=client(),guest=client();
test.after(async()=>{await Promise.all([server,upstream].map(server=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();})));db.close();});

test('real campus cookies configure encrypted Polymas credentials, execute tool and assistant protocols, and persist only selected public answers',async()=>{
 assert.equal((await admin('/auth/login','POST',{email:'polymas-admin@example.test',password})).status,200);
 let response=await admin('/admin/integrations','POST',{name:'Polymas fixture',platform:'polymas',baseUrl:upstreamUrl,appId:'fixture-published-bot',credentials:{gatewayAppId:'fixture-gateway',appKey:'fixture-app-key',paramKey:'fixture-param-key'},config:{mode:'tool',queryField:'query',historyField:'history',answerField:'answer'}});
 assert.equal(response.status,201);const integration=await response.json();
 assert.ok(!JSON.stringify(integration).includes('fixture-app-key'));
 assert.equal((await guest(`/admin/integrations/${integration.id}/test`,'POST')).status,403);
 response=await admin('/admin/agents','POST',{name:'Polymas fixture agent',integrationId:integration.id,published:true});assert.equal(response.status,201);const agent=await response.json();
 await admin('/admin/groups/guest','PATCH',{agentIds:[agent.id]});
 response=await guest('/conversations','POST',{agentId:agent.id});const conversation=await response.json();
 async function send(content){const response=await guest(`/conversations/${conversation.id}/messages`,'POST',{content});assert.equal(response.status,200);const events=[];for await(const event of readSSE(response.body))events.push(JSON.parse(event.data));assert.ok(!events.some(event=>event.type==='error'),JSON.stringify(events));return events;}
 const first=await send('第一问');assert.ok(!JSON.stringify(first).includes('private internal draft'));
 await send('追问');
 assert.equal(calls[0].auth,'fixture-access-token');assert.equal(calls[0].body.appCode,'fixture-published-bot');
 assert.deepEqual(JSON.parse(calls[1].body.flowData.history),[{role:'user',content:'第一问'},{role:'assistant',content:'工作流最终答案'}]);
 const usage=get('SELECT * FROM usage_logs WHERE conversation_id=? ORDER BY started_at DESC LIMIT 1',conversation.id);
 assert.equal(usage.status,'completed');assert.equal(usage.execution_requested,1);assert.equal(usage.upstream_message_id,'fixture-chat');
 response=await admin(`/admin/integrations/${integration.id}`,'PATCH',{config:{mode:'assistant',encryption:'aes-ecb-zero'}});assert.equal(response.status,200);
 await send('助手追问');const assistant=calls.at(-1);
 assert.equal(assistant.path,'/bot/t/v1/completions/chat/stream');assert.ok(assistant.body.question.includes('工作流最终答案'));assert.equal('sessionNid'in assistant.body,false);
 const saved=await(await guest('/conversations/'+conversation.id)).json();assert.equal(saved.messages.at(-1).versions.at(-1).content,'助手最终答案');
 const tested=await(await admin(`/admin/integrations/${integration.id}/test`,'POST',{prompt:'接口测试'})).json();
 assert.equal(tested.capabilities.connection.state,'observed');assert.equal(tested.capabilities.cancellation.state,'local_only');assert.equal(tested.capabilities.multiTurn.state,'unverified');
});

test('native LibreChat SSE delivers a real partial answer before the upstream final and records first-answer latency',{timeout:10000},async()=>{
 const response=await admin('/admin/integrations','POST',{name:'Streaming fixture',platform:'polymas',baseUrl:upstreamUrl,appId:'fixture-stream-bot',credentials:{gatewayAppId:'fixture-gateway',appKey:'fixture-app-key'},config:{mode:'tool',queryField:'question',answerField:'text',toolTextMode:'delta',historyMode:'question'}});
 assert.equal(response.status,201);const integration=await response.json();
 const agent=await(await admin('/admin/agents','POST',{name:'Streaming fixture agent',integrationId:integration.id,published:true})).json();
 await admin('/admin/groups/guest','PATCH',{agentIds:[agent.id]});
 const startedResponse=await guest('/librechat/agents/chat/campus','POST',{text:'测试真实流式',model:agent.id,messageId:'stream-fixture-client'});
 assert.equal(startedResponse.status,200);const started=await startedResponse.json();
 const streamResponse=await guest('/librechat/agents/chat/stream/'+started.streamId);
 const reader=readSSE(streamResponse.body)[Symbol.asyncIterator]();
 const frames=[];
 try {
   for(let i=0;i<20;i++) {
     const next=await reader.next();assert.equal(next.done,false);const frame=JSON.parse(next.value.data);frames.push(frame);
     if(frame.message===true&&frame.text) break;
   }
   assert.equal(frames.find(frame=>frame.message===true&&frame.text)?.text,'实时第一段');
   const running=get('SELECT status,first_answer_ms FROM usage_logs WHERE version_id=?',started.versionId);
   assert.equal(running.status,'running');assert.ok(running.first_answer_ms>=0);
 } finally { releaseStream?.(); }
 for await(const frame of { [Symbol.asyncIterator]:()=>reader }) frames.push(JSON.parse(frame.data));
 const final=frames.find(frame=>frame.final);
 assert.equal(final.terminalStatus,'complete');assert.equal(final.responseMessage.text,'正式最终答案');
 const saved=get('SELECT content,status FROM answer_versions WHERE id=?',started.versionId);
 assert.deepEqual({...saved},{content:'正式最终答案',status:'completed'});
});
