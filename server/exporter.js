import {Router} from 'express';
import {chromium} from 'playwright';
import {marked} from 'marked';
import sanitize from 'sanitize-html';
import {writePngArchive} from './zip.js';
import {requireUser,requirePermission,HttpError,audit} from './security.js';
import {ownedConversation,snapshotConversation} from './chat.js';
import {get} from './db.js';

export const exportRouter=Router();
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markdownOptions={gfm:true,breaks:true};
function renderMarkdown(content){return sanitize(marked.parse(content||'',markdownOptions),{allowedTags:sanitize.defaults.allowedTags.concat(['del','input']),allowedAttributes:{a:['href','title'],th:['align'],td:['align'],input:['type','checked','disabled']},allowedSchemes:['http','https','mailto','tel'],allowProtocolRelative:false,transformTags:{input:()=>({tagName:'input',attribs:{type:'checkbox',disabled:'disabled'}})}});}
export function markdownExport(snapshot){return `# ${snapshot.title}\n\n`+snapshot.messages.map(message=>`## ${message.role==='user'?'用户':'智能体'}\n\n${message.content}\n`).join('\n');}
export function htmlExport(snapshot){return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${escape(snapshot.title)}</title><style>
@page{size:A4;margin:18mm 15mm}*{box-sizing:border-box}body{margin:0;padding:32px;background:#fff;color:#212121;font:16px/1.85 "Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif;overflow-wrap:anywhere}h1{font-size:28px;margin:0 0 28px}h2{font-size:15px;color:#047857;margin:0 0 12px}.message{padding:22px 0;border-top:1px solid #e5e5e5}p{margin:0 0 12px}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}th,td{border:1px solid #d1d5db;padding:9px;text-align:left;overflow-wrap:anywhere}th{background:#f7f7f8}thead{display:table-header-group}tr{break-inside:avoid}pre{white-space:pre-wrap;background:#f7f7f8;padding:14px;border-radius:8px}code{font-family:Consolas,monospace;white-space:pre-wrap}a{color:#047857;text-decoration:underline}blockquote{border-left:3px solid #d1d5db;padding-left:14px;color:#6e6e80}img,script,iframe{display:none!important}li{margin:4px 0}.meta{font-size:12px;color:#6e6e80;margin:0 0 20px}@media print{body{padding:0}.message{break-inside:auto}a{overflow-wrap:anywhere}}</style></head><body><h1>${escape(snapshot.title)}</h1><p class="meta">校园智能体 · 当前活动回答版本 · 导出时间 ${escape(new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</p>${snapshot.messages.map(message=>`<section class="message"><h2>${message.role==='user'?'用户':'智能体'}</h2>${renderMarkdown(message.content)}</section>`).join('')}</body></html>`;}
let browserPromise;let activeRenders=0;
async function browser(){
 if(!browserPromise)browserPromise=chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']}).catch(error=>{browserPromise=undefined;throw error;});
 const instance=await browserPromise;if(!instance.isConnected()){browserPromise=undefined;return browser();}return instance;
}
export async function closeExporter(){if(browserPromise){const instance=await browserPromise.catch(()=>null);await instance?.close();browserPromise=undefined;}}
function disposition(filename){return `attachment; filename="conversation.${filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(filename)}`;}
async function exportResponse(req,res,snapshot,admin=false){
 const format=String(req.query.format||'md');if(!['md','pdf','png'].includes(format))throw new HttpError(400,'仅支持 MD、PDF 或 PNG 导出','INVALID_FORMAT');
 const safeTitle=snapshot.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'').slice(0,80)||'校园对话';
 audit(req,admin?'admin.conversation_export':'conversation.export',req.params.id,{format});
 if(format==='md'){res.set('Content-Disposition',disposition(`${safeTitle}.md`));return res.type('text/markdown; charset=utf-8').send(markdownExport(snapshot));}
 // This is a renderer resource limit, not a chat or account quota.
 if(activeRenders>=3)throw new HttpError(503,'导出渲染资源繁忙，请稍后重试','EXPORT_BUSY');
 activeRenders++;let context;
 try{
  const instance=await browser();context=await instance.newContext({viewport:{width:1100,height:1000},javaScriptEnabled:false,offline:true});
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();await page.setContent(htmlExport(snapshot),{waitUntil:'load',timeout:60000});await page.evaluate(()=>document.fonts.ready);
  if(format==='pdf'){
   const buffer=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,timeout:120000});
   res.set('Content-Disposition',disposition(`${safeTitle}.pdf`));return res.type('application/pdf').send(buffer);
  }
  await page.emulateMedia({media:'screen'});
  const height=await page.locator('body').evaluate(el=>Math.ceil(el.scrollHeight));const partHeight=16000;
  if(height<=partHeight){const buffer=await page.screenshot({type:'png',fullPage:true,timeout:120000});res.set('Content-Disposition',disposition(`${safeTitle}.png`));return res.type('image/png').send(buffer);}
  res.set('Content-Disposition',disposition(`${safeTitle}-分段长图.zip`));res.type('application/zip');
  await writePngArchive(res,{height,partHeight,capture:clip=>page.screenshot({type:'png',fullPage:true,clip,timeout:120000})});
 }catch(error){
  if(res.headersSent){res.destroy();return;}
  throw new HttpError(503,'导出渲染失败，请确认服务端 Chromium、中文字体与可用内存已准备好后重试','EXPORT_RENDER_FAILED');
 }finally{try{await context?.close();}finally{activeRenders--;}}
}
exportRouter.get('/conversations/:id/export',requireUser,async(req,res)=>{ownedConversation(req,req.params.id);return exportResponse(req,res,snapshotConversation(req.params.id));});
exportRouter.get('/admin/conversations/:id/export',requirePermission('content_view'),requirePermission('content_export'),async(req,res)=>{if(!get('SELECT id FROM conversations WHERE id=?',req.params.id))throw new HttpError(404,'对话不存在');return exportResponse(req,res,snapshotConversation(req.params.id),true);});

