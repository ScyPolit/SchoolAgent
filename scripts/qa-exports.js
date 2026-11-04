// Local verification against the explicitly created, ignored QA fixture database.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const fixture=JSON.parse(readFileSync('artifacts/qa-credentials.json','utf8'));
const admin=fixture.credentials.find(item=>item.role==='superadmin');
if(!admin)throw new Error('Run explicit scripts/qa-fixtures.js against a new QA database first.');
const base=process.env.QA_BASE_URL||'http://127.0.0.1:3000';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base),'QA script is restricted to local service.');
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:admin.email,password:admin.password})});assert.equal(login.status,200,await login.clone().text());
const cookie=login.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ');
mkdirSync('artifacts/exports',{recursive:true});
const results=[];
for(const format of ['md','pdf','png']){
 const started=performance.now();
 const response=await fetch(`${base}/api/conversations/${fixture.conversationId}/export?format=${format}`,{headers:{cookie}});
 assert.equal(response.status,200,await response.clone().text().catch(()=>''));
 const bytes=Buffer.from(await response.arrayBuffer());const type=response.headers.get('content-type');
 const extension=type.includes('zip')?'zip':format;
 writeFileSync(`artifacts/exports/long-conversation.${extension}`,bytes);
 if(format==='md'){const source=bytes.toString('utf8');assert.ok(source.includes('END_OF_EXPORT_QA_20261104'));assert.ok(source.includes('| 部门 |'));assert.ok(!source.includes('OLD_VERSION_SHOULD_NOT_BE_EXPORTED'));}
 if(format==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');
 if(format==='png')assert.ok(type.includes('zip'),'Long fixture must return segmented PNG ZIP rather than truncate.');
 results.push({format,contentType:type,bytes:bytes.length,durationMs:Math.round(performance.now()-started)});
}
const guest=await fetch(`${base}/api/conversations/${fixture.conversationId}/export?format=md`);assert.equal(guest.status,401);
const created=await fetch(`${base}/api/conversations/${fixture.conversationId}/shares`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});assert.equal(created.status,201);const share=await created.json();
const publicResponse=await fetch(base+'/api/shares/'+share.id);assert.equal(publicResponse.status,200);const snapshot=await publicResponse.json();assert.equal(snapshot.messages.length,2);assert.ok(!JSON.stringify(snapshot).includes(admin.email));
const revoked=await fetch(base+'/api/shares/'+share.id,{method:'DELETE',headers:{cookie}});assert.equal(revoked.status,200);assert.equal((await fetch(base+'/api/shares/'+share.id)).status,404);
const evidence={recordedAt:new Date().toISOString(),environment:'local Node/Windows/Chromium; no Docker; no real workflow API',results,guestExportRejected:true,shareSnapshotReadAndRevoke:true};
writeFileSync('artifacts/exports/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
