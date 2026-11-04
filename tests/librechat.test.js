import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root=new URL('../',import.meta.url);
const baseline=JSON.parse(readFileSync(new URL('third_party/librechat-latest/baseline.json',root)));
test('runtime frontend is the pinned full latest-dev LibreChat workspace',()=>{
  assert.equal(baseline.commit,'f4154b649efa37e1345ccc517a4d8d1ed2178c82');
  assert.equal(baseline.runtimeFrontend,'upstream/LibreChat/client');
  const project=JSON.parse(readFileSync(new URL('upstream/LibreChat/package.json',root)));
  const frontend=JSON.parse(readFileSync(new URL('upstream/LibreChat/client/package.json',root)));
  assert.equal(project.version,baseline.version);
  assert.equal(frontend.name,'@librechat/frontend');
  for(const file of ['client/src/main.jsx','client/src/App.jsx','client/src/components/Chat/ChatView.tsx','client/src/components/Nav/Settings/Sidebar.tsx','packages/client/src/index.ts','packages/chat/src/index.ts']) {
    assert.ok(existsSync(new URL('upstream/LibreChat/'+file,root)),file);
  }
  const scripts=JSON.parse(readFileSync(new URL('package.json',root))).scripts;
  assert.equal(scripts.build,'node scripts/librechat.js build');
  assert.equal(existsSync(new URL('client/main.jsx',root)),false,'old custom application is not an active root client');
});
test('complete latest LibreChat MIT license is preserved unchanged',()=>{
  const upstream=readFileSync(new URL('upstream/LibreChat/LICENSE',root));
  const archived=readFileSync(new URL('third_party/librechat-latest/LICENSE',root));
  assert.deepEqual(archived,upstream);
  assert.equal(createHash('sha256').update(archived).digest('hex'),baseline.licenseSha256);
  assert.match(archived.toString(),/MIT License/);
  assert.match(archived.toString(),/Copyright \(c\) 2026 LibreChat/);
  assert.match(archived.toString(),/THE SOFTWARE IS PROVIDED "AS IS"/);
});
