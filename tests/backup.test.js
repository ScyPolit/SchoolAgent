import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
test('online SQLite backup includes committed WAL and offline restore preserves rollback snapshot',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'school-agent-backup-'));const source=path.join(directory,'source.sqlite'),target=path.join(directory,'backup.sqlite');
 let db;
 try{
  db=new DatabaseSync(source);db.exec("PRAGMA journal_mode=WAL; CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('已提交WAL正文');");
  const environment={...process.env,DATABASE_PATH:source};
  const result=spawnSync(process.execPath,['scripts/backup.js',target],{cwd:process.cwd(),env:environment,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  db.exec("UPDATE marker SET value='恢复前内容';");db.close();db=null;
  const rejected=spawnSync(process.execPath,['scripts/restore.js',target],{cwd:process.cwd(),env:environment,encoding:'utf8'});assert.notEqual(rejected.status,0);
  const restored=spawnSync(process.execPath,['scripts/restore.js',target,'--confirm-offline'],{cwd:process.cwd(),env:environment,encoding:'utf8'});assert.equal(restored.status,0,restored.stderr);
  db=new DatabaseSync(source);assert.equal(db.prepare('SELECT value FROM marker').get().value,'已提交WAL正文');db.close();db=null;
  const rollback=readdirSync(directory).find(name=>name.startsWith('source.sqlite.before-restore-'));assert.ok(rollback);
  db=new DatabaseSync(path.join(directory,rollback));assert.equal(db.prepare('SELECT value FROM marker').get().value,'恢复前内容');
 }finally{db?.close();assert.ok(directory.startsWith(path.join(tmpdir(),'school-agent-backup-')));rmSync(directory,{recursive:true,force:true});}
});
