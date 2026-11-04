// Downstream launch scenario allowed by upstream/e2e/lighthouse/README.md.
// Uses the original audit runner against our disposable local SQLite fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { freemem, totalmem } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const origin=new URL(process.env.LIGHTHOUSE_BASE_URL||'http://127.0.0.1:3000');
if(origin.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw new Error('Performance fixture is restricted to a local disposable server.');
const output=resolve(root,'artifacts/performance-campus');
if(!output.startsWith(resolve(root,'artifacts')+sep))throw new Error('Unexpected performance report path');
mkdirSync(output,{recursive:true});
// Keep failed cold-browser evidence when a later attempt succeeds.
const attemptDirectory=resolve(output,`attempt-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);
mkdirSync(attemptDirectory,{recursive:true});
const fixture=JSON.parse(readFileSync(resolve(root,'artifacts/qa-credentials.json'),'utf8'));
const account=fixture.credentials.find(value=>value.role==='user');
if(!account)throw new Error('Local QA user fixture is missing.');
const cookieJar=new Map();
async function request(path,body) {
  const response=await fetch(new URL('/api'+path,origin),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin:origin.origin,cookie:[...cookieJar].map(([key,value])=>`${key}=${value}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});
  for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],index=pair.indexOf('=');cookieJar.set(pair.slice(0,index),pair.slice(index+1));}
  return response;
}
const login=await request('/auth/login',{email:account.email,password:account.password});
if(!login.ok)throw new Error(`Performance fixture authentication failed (${login.status}).`);
const marker='Campus Lighthouse transcript';
const created=await request('/conversations',{agentId:'demo-campus',title:'LibreChat production performance audit'});
if(!created.ok)throw new Error(`Performance fixture conversation creation failed (${created.status}).`);
const conversation=await created.json();
const content=marker+'. '+('这是已保存的校园对话性能样本，用于检查真实消息正文可见，而不是空壳、登录页或加载动画。独立读取可以并行，权限必须先检查，再返回会话内容。').repeat(5);
const sent=await request(`/conversations/${encodeURIComponent(conversation.id)}/messages`,{content});
if(!sent.ok)throw new Error(`Performance fixture message creation failed (${sent.status}).`);
const stream=await sent.text();
if(!stream.includes('"status":"completed"'))throw new Error('Performance fixture did not finish its local demo answer.');
const url=new URL(`/c/${encodeURIComponent(conversation.id)}`,origin).href;
const cookies=[...cookieJar].map(([name,value])=>({name,value,domain:origin.hostname,path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}));
process.env.CHROME_PATH ||= chromium.executablePath();
process.env.LIGHTHOUSE_CHROME_FLAGS ||= '--no-sandbox --disable-dev-shm-usage';
// audit.ts is normally transpiled by Playwright; its only CommonJS use is the
// CLI resolver. Supplying the original workspace resolver lets Node24 reuse it.
globalThis.require=createRequire(resolve(root,'upstream/LibreChat/package.json'));
const {auditPage,lcpElement}=await import(pathToFileURL(resolve(root,'upstream/LibreChat/e2e/lighthouse/audit.ts')).href);
process.chdir(attemptDirectory);
const memoryBefore={totalBytes:totalmem(),freeBytes:freemem()};
writeFileSync(resolve(output,'summary.json'),JSON.stringify({passed:false,status:'running',reportDirectory:attemptDirectory.slice(root.length+1).replaceAll('\\','/'),startedAt:new Date().toISOString()},null,2)+'\n');
let failure;
try {
  const reports=await auditPage({url,cookies,runs:3});
  for(const report of reports){
    assert.equal(report.finalDisplayedUrl,url,'Performance navigation must not redirect to login');
    assert.ok(lcpElement(report).includes(marker),'Saved transcript must be the LCP element');
    const calls=report.audits['network-requests']?.details?.items?.filter(item=>typeof item.url==='string'&&new URL(item.url).pathname==='/api/librechat/agents/tools/calls')||[];
    assert.ok(calls.length>0,'Native tool-call metadata path must be observed');
    assert.ok(calls.every(item=>item.statusCode===200),'Disabled tool-call metadata must return authorized empty data instead of retrying errors');
  }
}catch(error){failure=error;}
finally {
  const directory=resolve(attemptDirectory,'.lighthouse');
  const reports=existsSync(directory)?readdirSync(directory).filter(file=>/\.report\.json$/.test(file)).map(file=>JSON.parse(readFileSync(resolve(directory,file),'utf8'))):[];
  const metric=key=>reports.map(report=>report.audits[key]?.numericValue).filter(Number.isFinite).sort((a,b)=>a-b);
  const median=key=>{const values=metric(key);return values.length?values[values.length>>1]:null;};
  const summary={sourceCommit:'f4154b649efa37e1345ccc517a4d8d1ed2178c82',frontend:'actual upstream production build',database:'campus SQLite; no upstream Mongo latency injection',reportDirectory:attemptDirectory.slice(root.length+1).replaceAll('\\','/'),memoryBefore,runs:reports.length,validRuns:reports.filter(report=>!report.runtimeError).length,runtimeErrors:reports.flatMap(report=>report.runtimeError?[report.runtimeError.code]:[]),budgets:{lcpMs:4500,cls:0.1,tbtMs:500},measured:{lcpMs:median('largest-contentful-paint'),cls:median('cumulative-layout-shift'),tbtMs:median('total-blocking-time')},transcriptIsLcp:reports.map(report=>{try{return lcpElement(report).includes(marker);}catch{return false;}}),passed:!failure&&reports.length===3&&reports.every(report=>!report.runtimeError),completedAt:new Date().toISOString()};
  const serialized=JSON.stringify(summary,null,2)+'\n';
  writeFileSync(resolve(attemptDirectory,'summary.json'),serialized);
  writeFileSync(resolve(output,'summary.json'),serialized);
}
if(failure)throw failure;
console.log('Actual LibreChat production conversation performance passed all original median budgets and transcript checks.');
