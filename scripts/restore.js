import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

if(!process.argv.includes('--confirm-offline')) throw new Error('Stop the app first, then pass --confirm-offline. See README backup/restore instructions.');
const source=path.resolve(process.argv[2]||'');
const target=path.resolve(process.env.DATABASE_PATH||'./data/school-agent.sqlite');
if(!process.argv[2]||!existsSync(source)||source===target) throw new Error('Pass an existing backup file distinct from the target database.');
mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
const staging=target+'.restore-'+Date.now();
const check=new DatabaseSync(source,{readOnly:true});
try {
  if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error('Source backup integrity check failed.');
  await backup(check,staging);
} finally { check.close(); }
// --confirm-offline is the operator assertion that no app process holds this DB.
// Use SQLite backup for the rollback copy as well, preserving committed WAL data.
if(existsSync(target)) {
  const previous=new DatabaseSync(target,{readOnly:true});
  try { await backup(previous,target+'.before-restore-'+Date.now()); } finally { previous.close(); }
}
rmSync(target,{force:true});
for(const suffix of ['-wal','-shm']) rmSync(target+suffix,{force:true});
renameSync(staging,target);
console.log('Restore complete. Verify matching encryption secret, then start app. Previous main database retained for rollback.');
