import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {db,initCoreSchema,all,get,setting,now,run} from './db.js';
import {HttpError,identityMiddleware,originProtection,homepageFor,canUseAgent,publicAgent,publicUser,hashToken} from './security.js';
import {authRouter,guestConversationCount} from './auth.js';
import {adminRouter} from './admin.js';
import {chatRouter,initChatSchema,runRetention} from './chat.js';
import {exportRouter,closeExporter} from './exporter.js';
import {librechatStartupRouter} from './librechat-startup.js';
import {librechatCompatRouter} from './librechat-compat.js';

export function createApp(){
 initCoreSchema();initChatSchema();
 const app=express();app.disable('x-powered-by');
 // Trust exactly the configured proxy hop count; never trust arbitrary forwarded addresses.
 app.set('trust proxy',Number(process.env.TRUST_PROXY_HOPS)||false);
 const https=process.env.PUBLIC_URL?.startsWith('https://');
 const hashFile=path.resolve('dist/csp-hashes.json');
 const scriptHashes=existsSync(hashFile)?JSON.parse(readFileSync(hashFile,'utf8')).filter(value=>/^'sha256-[A-Za-z0-9+/]+='$/.test(value)):[];
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'",...scriptHashes],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:','http:'],connectSrc:["'self'"],fontSrc:["'self'",'data:'],workerSrc:["'self'",'blob:'],objectSrc:["'none'"],frameAncestors:["'none'"],baseUri:["'self'"],upgradeInsecureRequests:https?[]:null}},crossOriginEmbedderPolicy:false,strictTransportSecurity:https?undefined:false}));
 app.get(['/api/health','/health'],(req,res)=>{get('SELECT 1');res.json({status:'ok',service:'school-agent',time:now()});});
 app.use('/api',express.json({limit:'2mb'}),cookieParser(),originProtection,(req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   if(req.body!=null&&(typeof req.body!=='object'||Array.isArray(req.body)))return next(new HttpError(400,'请求体必须是 JSON 对象','INVALID_BODY'));
   req.body??={};
  }
  next();
 },identityMiddleware,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.get('/api/bootstrap',(req,res)=>{
  const agents=all('SELECT * FROM agents WHERE published=1 AND homepage_visible=1 ORDER BY sort_order,created_at').filter(agent=>canUseAgent(req.identity,agent)).map(publicAgent);
  res.json({user:publicUser(req.user),guestMigrationCount:req.user?guestConversationCount(req.guestId):0,homepage:homepageFor(req.identity),agents,retention:{guestBrowserDays:setting('retention').guestBrowserDays},development:process.env.ENABLE_DEMO_ADAPTER==='true'&&process.env.NODE_ENV!=='production'});
 });
 app.get('/api/agents/:id',(req,res)=>{const agent=get('SELECT * FROM agents WHERE id=?',req.params.id);if(!canUseAgent(req.identity,agent))throw new HttpError(403,'智能体已下架或当前身份无权使用','AGENT_UNAVAILABLE');res.json(publicAgent(agent));});
 app.use('/api/librechat',librechatStartupRouter,librechatCompatRouter);
 app.use('/api',authRouter,adminRouter,chatRouter,exportRouter);
 app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在',code:'NOT_FOUND'}));
 const dist=path.resolve('dist');
 if(existsSync(path.join(dist,'index.html'))){app.use(express.static(dist,{index:false,maxAge:'1h',setHeaders:(res,file)=>{if(file.endsWith('index.html')||file.endsWith('sw.js'))res.setHeader('Cache-Control','no-cache');}}));app.use('/assets',(req,res)=>res.status(404).type('text/plain').send('资源不存在，请刷新页面'));app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));}
 else app.get('/',(req,res)=>res.type('text/plain').send('前端尚未构建。开发请使用 npm run dev；部署请先执行 npm run build。'));
 app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error instanceof z.ZodError)return res.status(400).json({error:error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('；'),code:'VALIDATION_ERROR'});
  if(error instanceof HttpError)return res.status(error.status).json({error:error.message,code:error.code});
  if(error.type==='entity.too.large')return res.status(413).json({error:'请求内容过大',code:'PAYLOAD_TOO_LARGE'});
  if(error instanceof SyntaxError&&'body'in error)return res.status(400).json({error:'请求 JSON 格式不正确',code:'INVALID_JSON'});
  if(error.code==='ERR_SQLITE_ERROR'&&/UNIQUE constraint/.test(error.message))return res.status(409).json({error:'记录已存在或发生并发冲突，请刷新后重试',code:'CONFLICT'});
  // Do not log raw error messages: upstream exceptions can contain credentials or bodies.
  console.error(JSON.stringify({event:'request_failed',method:req.method,code:error.code||'INTERNAL_ERROR'}));
  res.status(500).json({error:'服务暂时无法完成请求，请稍后重试',code:'INTERNAL_ERROR'});
 });
 return app;
}
export function startServer(){
 const app=createApp();const server=app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log(`校园智能体服务已启动 http://localhost:${Number(process.env.PORT)||3000}`));
 server.requestTimeout=0;server.headersTimeout=60000;
 const maintenance=setInterval(async()=>{
  try{await runRetention();run('DELETE FROM sessions WHERE expires_at<?',now());run('DELETE FROM email_tokens WHERE expires_at<?',now());}catch{console.error(JSON.stringify({event:'retention_failed'}));}
 },3600000);maintenance.unref();
 async function shutdown(){clearInterval(maintenance);server.close();server.closeIdleConnections();await closeExporter();setTimeout(()=>process.exit(0),5000).unref();}
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
