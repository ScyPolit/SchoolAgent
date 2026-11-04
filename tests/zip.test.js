import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';
import { writePngArchive } from '../server/zip.js';

// Read standard ZIP central/local records so the test verifies the delivered
// artifact independently of the library that authored it. No files are extracted.
function entries(zip) {
  const end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  assert.ok(end>=0,'ZIP end record is present');
  const count=zip.readUInt16LE(end+10), result=new Map();let offset=zip.readUInt32LE(end+16);
  for(let index=0;index<count;index++) {
    assert.equal(zip.readUInt32LE(offset),0x02014b50);
    const method=zip.readUInt16LE(offset+10), size=zip.readUInt32LE(offset+20);
    const nameLength=zip.readUInt16LE(offset+28), extraLength=zip.readUInt16LE(offset+30), commentLength=zip.readUInt16LE(offset+32);
    const name=zip.subarray(offset+46,offset+46+nameLength).toString('utf8');
    const local=zip.readUInt32LE(offset+42);assert.equal(zip.readUInt32LE(local),0x04034b50);
    const dataOffset=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28), compressed=zip.subarray(dataOffset,dataOffset+size);
    result.set(name,method===8?inflateRawSync(compressed):compressed);
    offset+=46+nameLength+extraLength+commentLength;
  }
  return result;
}
test('long-image ZIP finishes streaming with ordered complete segments and Chinese instructions',async()=>{
  const chunks=[], clips=[];
  const output=new Writable({write(chunk,encoding,next){chunks.push(Buffer.from(chunk));next();}});
  await writePngArchive(output,{height:32001,capture:async clip=>{clips.push(clip);return Buffer.from(`segment ${clip.y}`);}});
  assert.equal(output.writableFinished,true);
  assert.deepEqual(clips.map(clip=>[clip.y,clip.height]),[[0,16000],[16000,16000],[32000,1]]);
  const files=entries(Buffer.concat(chunks));
  assert.deepEqual([...files.keys()],['阅读说明.txt','对话-001.png','对话-002.png','对话-003.png']);
  assert.match(files.get('阅读说明.txt').toString(),/共 3 张图片/);
  assert.equal(files.get('对话-003.png').toString(),'segment 32000');
  assert.ok([...files.keys()].every(name=>!name.includes('/')&&!name.includes('..')));
});
test('failed segment rendering tears down ZIP destination and reports failure',async()=>{
  const output=new Writable({write(chunk,encoding,next){next();}});
  await assert.rejects(writePngArchive(output,{height:20000,capture:async clip=>{if(clip.y)throw new Error('render failed');return Buffer.from('first segment');}}),/render failed/);
  assert.equal(output.destroyed,true);
});
