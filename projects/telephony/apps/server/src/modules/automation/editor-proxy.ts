/*
 * 中文导读：自动化流程：editor-proxy.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { Router } from 'express';
import http from 'node:http';
import authMiddleware from '../../middleware/auth.middleware.js';
import { requireSystemAdmin } from '../../middleware/system-admin.middleware.js';
import { companyContext } from '../workspace/company-access.js';
import { trustedOrigins } from '../../config/origins.js';
const shellAssets = '<link rel="stylesheet" href="/integrations/n8n-shell.css?v=20261013-6"><script src="/integrations/n8n-shell.js?v=20261013-6" defer></script>';

function configuredEditorOrigin() {
  for (const origin of trustedOrigins) {
    try {
      const url = new URL(origin);
      if (['http:', 'https:'].includes(url.protocol) && url.origin === origin)
        return url;
    }
    catch { /* Only explicit valid origins may be forwarded to the editor. */ }
  }
  throw new Error('Editor origin unavailable');
}
function editorRedirect(location: string, origin: URL): string | null {
  if (location.includes('\\') || location.includes('\0') || location.startsWith('//'))
    return null;
  try {
    const url = new URL(location, origin);
    if (!trustedOrigins.includes(url.origin) || !['http:', 'https:'].includes(url.protocol))
      return null;
    const prefix = url.pathname === '/workflow-editor' || url.pathname.startsWith('/workflow-editor/') ? '' : '/workflow-editor';
    return prefix + url.pathname + url.search + url.hash;
  }
  catch {
    return null;
  }
} function assetCache(path: string, contentType: string, status: number) {
 if(status !== 200) return 'private, no-store';
 const pathname=path.split('?')[0] ?? '';
 if(/^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?|png|svg|webp|jpg)$/.test(pathname) && !contentType.includes('text/html')) return 'private, max-age=31536000, immutable';
 if(/^\/static\/[a-zA-Z0-9_./-]+\.(?:css|woff2?|png|svg|webp|jpg)$/.test(pathname) && !contentType.includes('text/html')) return 'private, max-age=3600';
 return 'private, no-store';
}
// This shared editor is for platform operators only. Employee configuration uses scoped business APIs.
const router=Router();
let engineCookie='';let expiresAt=0;let loginPromise:Promise<string>|undefined;
async function login(){
 if(engineCookie&&Date.now()<expiresAt)return engineCookie;
 if(loginPromise)return loginPromise;
 loginPromise=(async()=>{
  const email=process.env.N8N_OPERATOR_EMAIL,password=process.env.N8N_OPERATOR_PASSWORD;
  if(!email||!password)throw new Error('Editor unavailable');
  const response=await fetch('http://127.0.0.1:5678/rest/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailOrLdapLoginId:email,password}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Editor login unavailable');
  const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]).filter(Boolean);
  if(!cookies.length)throw new Error('Editor session unavailable');
  engineCookie=cookies.join('; ');expiresAt=Date.now()+10*60*1000;return engineCookie;
 })();try{return await loginPromise;}finally{loginPromise=undefined;}
}
router.use(authMiddleware,requireSystemAdmin);
router.use(async(req,res)=>{
 try{
  if(!req.auth?.activeOrganizationId){res.status(403).send('请先选择工作区。');return;}
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Content-Security-Policy',"frame-ancestors 'self'");
  await companyContext(req.auth.activeOrganizationId,req.auth.userId);
  if(!['GET','HEAD'].includes(req.method)&&!trustedOrigins.includes(req.get('origin')||'')){res.status(403).send('请在系统正式地址操作。');return;}
  if(req.url.startsWith('//')||req.url.includes('\\')||req.url.includes('\0')){res.sendStatus(400);return;}
  const cookie=await login();
   const editorOrigin = configuredEditorOrigin();
   const headers: http.OutgoingHttpHeaders = { cookie, host: editorOrigin.host, 'x-forwarded-host': editorOrigin.host, 'x-forwarded-proto': editorOrigin.protocol.slice(0, -1), accept: req.get('accept') || '*/*', 'accept-encoding': 'identity' };
  for(const key of ['content-type','content-length','user-agent','last-event-id','n8n-browser-id','push-ref','origin'])if(req.get(key))headers[key]=req.get(key);
  const upstream=http.request({hostname:'127.0.0.1',port:5678,path:req.url,method:req.method,headers},response=>{
   res.status(response.statusCode??502);
   const contentType=String(response.headers['content-type'] ?? '');
   const adaptHtml=req.method==='GET' && response.statusCode===200 && contentType.includes('text/html');
   for(const [key,value] of Object.entries(response.headers)){
    if(value!==undefined&&!['set-cookie','connection','transfer-encoding','content-security-policy','x-frame-options','location','cache-control',...(adaptHtml?['content-length','etag','content-encoding']:[])].includes(key))res.setHeader(key,value);
   }
   if(response.statusCode===401){engineCookie='';expiresAt=0;}
   const location=response.headers.location;
    if (location) { const redirect = editorRedirect(location, editorOrigin); if (redirect) res.setHeader('Location', redirect); }
   res.setHeader('Cache-Control',assetCache(req.url,contentType,response.statusCode??502));res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Content-Security-Policy',"frame-ancestors 'self'");
   if(adaptHtml){
    const chunks:Buffer[]=[];let size=0;
    response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>2*1024*1024){response.destroy();if(!res.headersSent)res.status(502).send('流程界面加载异常，请稍后重试。');return;}chunks.push(chunk);});
    response.on('end',()=>{if(response.destroyed&&!response.complete)return;const html=Buffer.concat(chunks).toString('utf8');res.send(html.replace('<head>','<head>'+shellAssets));});
    response.on('error',()=>{if(!res.headersSent)res.status(502).send('流程界面加载异常，请稍后重试。');else res.end();});
   }else response.pipe(res);
  });
  upstream.setTimeout(120000,()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent)res.status(502).send('流程编辑器暂未连接，请稍后刷新。');else res.end();});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 }catch{res.status(503).send('流程编辑器暂未配置完成，请联系平台管理员。');}
});
export default router;
