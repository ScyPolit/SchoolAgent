// Pure output-contract tests only. Browser/Chinese font/pagination acceptance is pending.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH=':memory:';
const {markdownExport,htmlExport}=await import('../server/exporter.js');
test('export keeps ordered Chinese messages, table/link source and active snapshot values',()=>{
 const snapshot={title:'校园服务',messages:[{role:'user',content:'联系电话？'},{role:'assistant',content:'| 部门 | 电话 |\n| --- | --- |\n| 服务中心 | [010-12345678](tel:01012345678) |'}]};
 const markdown=markdownExport(snapshot),html=htmlExport(snapshot);
 assert.ok(markdown.indexOf('联系电话？')<markdown.indexOf('服务中心'));
 assert.match(html,/<table>/);assert.match(html,/tel:01012345678/);assert.match(html,/Noto Sans CJK SC/);
});
test('export strips scripts, images and unsafe links from untrusted answers',()=>{
 const html=htmlExport({title:'<script>title</script>',messages:[{role:'assistant',content:'<script>alert(1)</script><img src="http://example.invalid/track">[bad](javascript:alert(1))'}]});
 assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/<img /);assert.doesNotMatch(html,/href="javascript:/);assert.match(html,/&lt;script&gt;/);
});
