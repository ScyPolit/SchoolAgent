import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const source = path.resolve(process.env.DATABASE_PATH || './data/school-agent.sqlite');
const requested = process.argv[2] || `./backups/school-agent-${new Date().toISOString().replaceAll(':','-')}.sqlite`;
const target=path.resolve(requested);
if(source===target) throw new Error('Backup path must differ from active database.');
mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});
try {
  await backup(db,target);
  const check=new DatabaseSync(target,{readOnly:true});
  try { if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error('Backup integrity check failed.'); } finally { check.close(); }
  console.log(`Consistent SQLite backup created: ${target}`);
  console.log('Keep the matching .secrets/encryption_key separately in secured backup storage.');
} finally { db.close(); }
