import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createSmtpCapture, mailText } from './fixtures/smtp-capture.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.ENABLE_DEMO_ADAPTER = 'true';
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
const smtp = await createSmtpCapture();
const { createApp } = await import('../server/index.js');
const { db, setSetting, get, all, run, now, id } = await import('../server/db.js');
const { hashToken, hashPassword, encrypt } = await import('../server/security.js');
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.PUBLIC_URL = origin;
const smtpSetting = { host:smtp.host,port:smtp.port,encryption:'none',from:'campus@example.test',username:'',password:'' };
setSetting('smtp',smtpSetting);
const password = 'local-smtp-original-password-123';
const replacement = 'local-smtp-replacement-password-456';

function client() {
  const cookies = new Map();
  return async (path, method='GET', body) => {
    const response = await fetch(origin+'/api'+path, {method,headers:{'content-type':'application/json',origin,cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join(';')},body:body===undefined?undefined:JSON.stringify(body)});
    for (const header of response.headers.getSetCookie()) { const [pair]=header.split(';'), split=pair.indexOf('=');cookies.set(pair.slice(0,split),pair.slice(split+1)); }
    return {status:response.status,body:await response.json()};
  };
}
function latestLink(action) {
  const latest=smtp.messages.at(-1), body=mailText(latest.raw);
  const value=body.match(/https?:\/\/[^\s]+/)?.[0];
  assert.ok(value, 'captured real SMTP message contains a usable account link');
  const url=new URL(value);assert.equal(url.origin,origin);assert.equal(url.searchParams.get('action'),action);
  assert.equal(url.pathname, action==='verify'?'/verify':'/reset-password');
  assert.ok(url.searchParams.get(action==='verify'?'email':'userId'));
  assert.match(body,/校内网络/);
  return {token:url.searchParams.get('token'),body,envelope:latest};
}
test.after(async()=>{await new Promise(resolve=>server.close(resolve));await smtp.close();db.close();});

test('registration sends an actual SMTP verification message, and its link verifies once',async()=>{
  const request=client();const before=smtp.messages.length;
  const result=await request('/auth/register','POST',{email:'mail-user@example.test',name:'真实邮件测试用户',password});
  assert.equal(result.status,201);assert.equal(result.body.mailSent,true);assert.equal(smtp.messages.length,before+1);
  const mail=latestLink('verify');assert.deepEqual(mail.envelope.to,['<mail-user@example.test>']);
  assert.equal((await request('/auth/login','POST',{email:'mail-user@example.test',password})).body.code,'EMAIL_NOT_VERIFIED');
  assert.equal((await request('/auth/verify','POST',{token:mail.token})).status,200);
  assert.equal((await request('/auth/verify','POST',{token:mail.token})).body.code,'INVALID_TOKEN');
  assert.equal((await request('/auth/login','POST',{email:'mail-user@example.test',password})).status,200);
  assert.equal(get('SELECT id FROM email_tokens WHERE id=?',hashToken(mail.token)).id,hashToken(mail.token));
  assert.equal(JSON.stringify(all('SELECT * FROM audit_logs')).includes(mail.token),false);
});

test('resending verification invalidates the previous emailed token',async()=>{
  const request=client();
  assert.equal((await request('/auth/register','POST',{email:'resend@example.test',name:'重新验证',password})).body.mailSent,true);
  const first=latestLink('verify').token;
  assert.equal((await request('/auth/resend-verification','POST',{email:'resend@example.test'})).body.mailSent,true);
  const second=latestLink('verify').token;assert.notEqual(first,second);
  assert.equal((await request('/auth/verify','POST',{token:first})).body.code,'INVALID_TOKEN');
  assert.equal((await request('/auth/verify','POST',{token:second})).status,200);
});

test('password recovery sends a real SMTP reset link, replaces password and revokes all sessions',async()=>{
  const first=client(),second=client();
  assert.equal((await first('/auth/login','POST',{email:'mail-user@example.test',password})).status,200);
  assert.equal((await second('/auth/login','POST',{email:'mail-user@example.test',password})).status,200);
  assert.equal((await first('/auth/forgot-password','POST',{email:'mail-user@example.test'})).body.mailSent,true);
  const token=latestLink('reset').token;
  assert.equal((await first('/auth/reset-password','POST',{token,password:replacement})).status,200);
  assert.equal((await first('/auth/me')).status,401);assert.equal((await second('/auth/me')).status,401);
  assert.equal((await first('/auth/reset-password','POST',{token,password})).body.code,'INVALID_TOKEN');
  assert.equal((await first('/auth/login','POST',{email:'mail-user@example.test',password})).body.code,'INVALID_CREDENTIALS');
  assert.equal((await first('/auth/login','POST',{email:'mail-user@example.test',password:replacement})).status,200);
});

test('expired emailed verification and reset tokens cannot be consumed',async()=>{
  const request=client();
  assert.equal((await request('/auth/register','POST',{email:'expired@example.test',name:'过期链接',password})).body.mailSent,true);
  const verify=latestLink('verify').token;run('UPDATE email_tokens SET expires_at=? WHERE id=?',now()-1,hashToken(verify));
  assert.equal((await request('/auth/verify','POST',{token:verify})).body.code,'INVALID_TOKEN');
  assert.equal((await request('/auth/forgot-password','POST',{email:'mail-user@example.test'})).body.mailSent,true);
  const reset=latestLink('reset').token;run('UPDATE email_tokens SET expires_at=? WHERE id=?',now()-1,hashToken(reset));
  assert.equal((await request('/auth/reset-password','POST',{token:reset,password})).body.code,'INVALID_TOKEN');
});

test('SMTP recipient rejection is explicit and does not leave a usable unsent token',async()=>{
  smtp.control.rejectRecipients=true;
  try {
    const request=client(),before=smtp.messages.length;
    const registration=await request('/auth/register','POST',{email:'reject@example.test',name:'拒收测试',password});
    assert.equal(registration.status,201);assert.equal(registration.body.mailSent,false);assert.equal(registration.body.code,'SMTP_SEND_FAILED');
    const rejected=get('SELECT id FROM users WHERE email=?','reject@example.test');assert.equal(get('SELECT count(*) count FROM email_tokens WHERE user_id=?',rejected.id).count,0);
    assert.equal((await request('/auth/forgot-password','POST',{email:'mail-user@example.test'})).body.code,'SMTP_SEND_FAILED');
    assert.equal(smtp.messages.length,before);
  } finally { smtp.control.rejectRecipients=false; }
});

test('encrypted SMTP credentials authenticate real transport; wrong credentials report failure',async()=>{
  smtp.control.credentials={username:'local-sender',password:'smtp-fixture-password'};
  setSetting('smtp',{...smtpSetting,username:'local-sender',password:encrypt('smtp-fixture-password')});
  try {
    const request=client();
    assert.equal((await request('/auth/register','POST',{email:'authenticated@example.test',name:'发信认证',password})).body.mailSent,true);
    assert.equal(latestLink('verify').envelope.authenticated,true);
    setSetting('smtp',{...smtpSetting,username:'local-sender',password:encrypt('wrong-smtp-password')});
    const result=await request('/auth/resend-verification','POST',{email:'authenticated@example.test'});
    assert.equal(result.status,502);assert.equal(result.body.code,'SMTP_SEND_FAILED');
    const audits=JSON.stringify(all('SELECT * FROM audit_logs'));
    assert.equal(audits.includes('smtp-fixture-password'),false);assert.equal(audits.includes(password),false);
  } finally {smtp.control.credentials=null;setSetting('smtp',smtpSetting);}
});

test('administrator SMTP configuration encrypts credentials, masks responses and sends a real test message',async()=>{
  const adminId=id('u_');
  run("INSERT INTO users(id,email,name,password_hash,role,email_verified,created_at) VALUES(?,?,?,?,'superadmin',1,?)",adminId,'mail-admin@example.test','邮件管理员',await hashPassword(password),now());
  run("INSERT INTO user_groups(user_id,group_id) VALUES(?,'member')",adminId);
  const request=client();assert.equal((await request('/auth/login','POST',{email:'mail-admin@example.test',password})).status,200);
  smtp.control.credentials={username:'api-sender',password:'admin-configured-smtp-password'};
  try {
    const configured=await request('/admin/settings/smtp','PUT',{...smtpSetting,username:'api-sender',password:'admin-configured-smtp-password'});
    assert.equal(configured.status,200);assert.equal(configured.body.smtp.password,'');assert.equal(configured.body.smtp.hasPassword,true);
    const stored=get("SELECT value FROM settings WHERE key='smtp'").value;
    assert.equal(stored.includes('admin-configured-smtp-password'),false);
    const visible=await request('/admin/settings');assert.equal(visible.body.smtp.password,'');assert.equal(visible.body.smtp.hasPassword,true);
    const before=smtp.messages.length;const sent=await request('/admin/smtp/test','POST',{to:'operator@example.test'});
    assert.equal(sent.status,200);assert.equal(sent.body.mailSent,true);assert.equal(smtp.messages.length,before+1);
    assert.deepEqual(smtp.messages.at(-1).to,['<operator@example.test>']);assert.equal(smtp.messages.at(-1).authenticated,true);
    assert.match(mailText(smtp.messages.at(-1).raw),/SMTP 测试邮件/);
    assert.ok(get("SELECT id FROM audit_logs WHERE action='admin.smtp_test' AND actor_id=?",adminId));
    assert.equal(JSON.stringify(all('SELECT * FROM audit_logs')).includes('admin-configured-smtp-password'),false);
    // A previously accepted credential is retained when a form saves blank password.
    assert.equal((await request('/admin/settings/smtp','PUT',{...smtpSetting,username:'api-sender',password:''})).status,200);
    assert.equal((await request('/admin/smtp/test','POST',{to:'operator@example.test'})).body.mailSent,true);
  } finally {smtp.control.credentials=null;setSetting('smtp',smtpSetting);}
});
