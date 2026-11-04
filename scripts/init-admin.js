import { createInterface, emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { readFileSync } from 'node:fs';

function question(prompt) {
  const reader = createInterface({ input: stdin, output: stdout });
  return new Promise(resolve => reader.question(prompt, answer => { reader.close(); resolve(answer.trim()); }));
}
function passwordQuestion(prompt) {
  if (!stdin.isTTY) throw new Error('Interactive TTY required for hidden password input. Use docker compose exec without -T.');
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    emitKeypressEvents(stdin);
    stdin.setRawMode(true); stdin.resume();
    let value = '';
    const done = () => { stdin.removeListener('keypress', handler); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const handler = (text, key) => {
      if (key?.ctrl && key.name === 'c') { done(); reject(new Error('Cancelled.')); }
      else if (key?.name === 'return' || key?.name === 'enter') { done(); resolve(value); }
      else if (key?.name === 'backspace') { value = [...value].slice(0, -1).join(''); }
      else if (text && !key?.ctrl && !key?.meta) value += text;
    };
    stdin.on('keypress', handler);
  });
}

try {
  if (process.env.ENCRYPTION_KEY_FILE) process.env.ENCRYPTION_KEY = readFileSync(process.env.ENCRYPTION_KEY_FILE, 'utf8').trim();
  const email = (await question('Administrator email: ')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email address.');
  const name = (await question('Display name: ')) || '学校管理员';
  const password = await passwordQuestion('Password (12–256 characters, hidden): ');
  const confirm = await passwordQuestion('Confirm password (hidden): ');
  if (password !== confirm) throw new Error('Passwords do not match.');
  const { initCoreSchema, db, get, run, id, now, transaction } = await import('../server/db.js');
  const { hashPassword, audit } = await import('../server/security.js');
  const passwordHash = await hashPassword(password);
  initCoreSchema();
  if (get('SELECT id FROM users WHERE email=?', email)) throw new Error('Account already exists; use administrator settings to edit or reset it.');
  const userId=id('u_');
  transaction(() => {
    run("INSERT INTO users(id,email,name,password_hash,role,email_verified,created_at) VALUES(?,?,?,?,'superadmin',1,?)", userId,email,name,passwordHash,now());
    run("INSERT INTO user_groups(user_id,group_id) VALUES(?,'member')",userId);
    audit({identity:{id:'bootstrap-cli'}},'bootstrap.superadmin',userId,{outcome:'created'});
  });
  db.close();
  console.log('Administrator created. No password was printed or stored in plaintext.');
} catch(error) { console.error(error.message); process.exitCode=1; }
