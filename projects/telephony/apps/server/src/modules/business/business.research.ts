/*
 * 中文导读：业务线索：business.research.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { XMLParser } from 'fast-xml-parser';
import { assertSafeRemoteUrl } from '../../lib/url-safety.js';
import { normalizePhone as crmPhone } from '../crm/crm.phone.js';

export type Lead = { companyName: string; phone: string; industry: string; address: string; business: string; sourceUrl: string };
export type ResearchReason = 'ACCEPTED' | 'IRRELEVANT' | 'REGION' | 'NO_COMPANY' | 'NO_PHONE' | 'UNAVAILABLE';
export type ResearchResult = { leads: Lead[]; reason: ResearchReason; pages: number };
export type SearchResult = { urls: string[]; provider: string; query: string; candidates: number; filtered: number; unavailable: number; blocked: boolean };
export const cities = ['', '广州', '深圳', '上海', '苏州', '杭州', '宁波', '东莞', '佛山', '中山', '无锡', '南京', '青岛', '济南', '武汉', '成都', '天津', '北京', '郑州', '长沙', '厦门', '泉州', '温州', '台州', '合肥', '重庆', '西安', '石家庄', '南通', '常州'];
const aliases: Record<string, string[]> = { 机械: ['机械', '设备', '自动化'], 包装: ['包装', '纸箱', '彩盒'], 照明: ['照明', '灯具', 'LED'], 家具: ['家具', '家私'], 塑料: ['塑料', '塑胶'], 食品: ['食品', '食业'], 服装: ['服装', '服饰'], 物流: ['物流', '货运'], 化妆品: ['化妆品', '护肤'], 电子: ['电子', '电路'] };
export function industryTerms(industry: string) {
 const keyword=industry.normalize('NFKC').trim();
 const core=keyword.replace(/\s/g,'').replace(/(?:行业|制造业)$/,'');
 // Only broad industry names get broad synonyms. A specific product keeps its exact scope.
 return [...new Set([keyword,core,...(aliases[core] || [])])].filter(Boolean);
}
const excluded = ['bing.com', 'baidu.com', 'sogou.com', 'so.com', 'qcc.com', 'tianyancha.com', '1688.com', 'alibaba.com', 'gov.cn', 'zhihu.com', 'zhipin.com', 'liepin.com', 'qidian.com', 'jjwxc.net', 'fanqienovel.com', 'sohu.com', 'sina.com.cn', 'xinhuanet.com', 'news.cn', 'huanqiu.com', 'toutiao.com', 'people.com.cn', 'thepaper.cn', 'tripadvisor.com', 'ctrip.com', 'meet-in-shanghai.net', 'fsonline.com.cn'];
export function publicCompanyUrl(raw: string) {
 try {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.port && !['80','443'].includes(u.port)) || excluded.some(h => u.hostname === h || u.hostname.endsWith('.'+h))) return '';
  u.hash=''; for(const key of [...u.searchParams.keys()]) if(/^utm_|^(?:spm|from|ref)$/i.test(key))u.searchParams.delete(key);
  return u.href;
 } catch { return ''; }
}
// Validate every DNS address and redirect; pin the socket, retaining TLS verification.
async function readDocument(raw: string, redirects = 0, deadline = Date.now()+12000): Promise<{html:string;url:string}> {
 const left=deadline-Date.now(); if(left<=0)throw new Error('PAGE_TIMEOUT');
 let addresses: {address:string;family:number}[] = [];
 const parsed = new URL(raw); if(parsed.port && !['80','443'].includes(parsed.port)) throw new Error('PORT_NOT_ALLOWED');
 let dnsTimer: ReturnType<typeof setTimeout> | undefined;
 const validated=assertSafeRemoteUrl(raw, { allowedProtocols: ['http:', 'https:'], lookup: async host => {
   const found = await lookup(host, { all: true }); addresses = found; return found;
 } });
 const u=await Promise.race([validated,new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('PAGE_TIMEOUT')),left);})]).finally(()=>clearTimeout(dnsTimer));
 if (!addresses.length) addresses = [{address:u.hostname.replace(/^\[|\]$/g,''),family:u.hostname.includes(':')?6:4}];
 const pinned = addresses.find(address=>address.family===4)||addresses[0]; if (!pinned) throw new Error('NO_ADDRESS');
 return new Promise((resolve, reject) => {
   const transport = u.protocol === 'https:' ? https : http;
   const request = transport.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TaiguaBusinessResearch/2.0)', 'Accept': 'text/html,application/xml,text/xml', 'Accept-Language':'zh-CN,zh;q=0.9', 'Accept-Encoding': 'identity' }, lookup: (_host, options, cb) => options.all ? cb(null, [pinned]) : cb(null, pinned.address, pinned.family) }, response => {
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
     response.resume(); clearTimeout(totalTimer); if (redirects >= 3) { reject(new Error('REDIRECT_LIMIT')); return; }
     readDocument(new URL(response.headers.location, u).href, redirects+1,deadline).then(resolve,reject); return;
    }
    if (response.statusCode !== 200) { response.resume(); reject(new Error('PAGE_UNAVAILABLE')); return; }
    const type = response.headers['content-type'] || '';
    if (!/text|html|xml/.test(type)) { response.resume(); reject(new Error('NOT_TEXT')); return; }
    const chunks: Buffer[]=[]; let size=0;
    response.on('data', chunk => { size+=chunk.length; if(size>1500000) { request.destroy(new Error('PAGE_TOO_LARGE')); return; } chunks.push(chunk); });
    response.on('error',reject); response.on('end',()=>{
     const bytes=Buffer.concat(chunks);
     const charset = type.match(/charset\s*=\s*([^;]+)/i)?.[1]?.replace(/["']/g,'') || bytes.subarray(0,8192).toString('ascii').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
     try { resolve({html:new TextDecoder(charset).decode(bytes),url:u.href}); } catch { resolve({html:bytes.toString('utf8'),url:u.href}); }
    });
   });
   const totalTimer=setTimeout(()=>request.destroy(new Error('PAGE_TIMEOUT')),Math.max(1,deadline-Date.now()));
   request.setTimeout(8000,()=>request.destroy(new Error('PAGE_TIMEOUT')));
   request.on('error',reject);
   request.on('close',()=>clearTimeout(totalTimer));
 });
}
export async function readPublicPage(raw: string): Promise<string> { return (await readDocument(raw)).html; }
function decode(s: string) { return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;|&#160;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(?:x([a-f\d]+)|(\d+));/gi,(_,hex,n)=>{const code=parseInt(hex||n,hex?16:10);return code<=0x10ffff?String.fromCodePoint(code):'';}); }
function plain(html: string) { return decode(html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/?(?:p|div|li|br|h[1-6]|section|footer|td|tr|dt|dd)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')).normalize('NFKC').replace(/[ \t]+/g,' ').split('\n').map(s=>s.trim()).filter(Boolean).join('\n'); }
export function normalizePhone(raw: string, region='') {
 try{return crmPhone(raw.normalize('NFKC').replace(/[‐‑–—]/g,'-'),'',region).phoneKey;}catch{return '';}
}
const matchesIndustry=(text:string,industry:string)=>industryTerms(industry).some(t=>text.replace(/\s/g,'').toLowerCase().includes(t.replace(/\s/g,'').toLowerCase()));
const blockedPage=(html:string)=>/百度安全验证|搜狗搜索验证码|请完成验证|访问过于频繁|异常流量|verify\.baidu\.com|captcha-container/i.test(html) || /<title[^>]*>[^<]*(?:验证码|安全验证|访问验证)/i.test(html);
function searchLink(raw:string,base:string) {
 try {
  const u=new URL(decode(raw),base);
  if(u.hostname.endsWith('bing.com') && u.pathname==='/ck/a') {
   const encoded=u.searchParams.get('u'); if(encoded?.startsWith('a1'))return publicCompanyUrl(Buffer.from(encoded.slice(2),'base64url').toString('utf8'));
  }
  if ((u.hostname === 'www.so.com' && u.pathname === '/link') || (u.hostname === 'www.baidu.com' && u.pathname === '/link') || (u.hostname === 'www.sogou.com' && u.pathname === '/link')) return u.href;
  return publicCompanyUrl(u.href);
 }catch{return '';}
}
function htmlResults(html:string,base:string): Array<{url:string;text:string}> {
 const rows:Array<{url:string;text:string}>=[];
 for(const m of html.matchAll(/<h[23]\b[^>]*>[\s\S]*?<\/h[23]>/gi)) {
  const anchor=m[0].match(/<a\b[^>]*href=["']([^"']+)["']/i);
  if(!anchor)continue;
  const start=m.index||0;
  const rest=html.slice(start,Math.min(html.length,start+2200));
  const next=rest.slice(m[0].length).search(/<h[23]\b/i);
  const context=next<0?rest:rest.slice(0,m[0].length+next);
  // Baidu exposes the destination on the result card, not just its tracking link.
  const destination=context.match(/(?:data-landurl|mu)=["']([^"']+)["']/i)?.[1] || context.match(/&quot;url&quot;\s*:\s*&quot;([^&]+)&quot;/i)?.[1] || context.match(/"url"\s*:\s*"([^"]+)"/i)?.[1] || anchor[1]!;
  rows.push({url:searchLink(destination,base),text:plain(context).slice(0,1000)});
 }
 return rows;
}
export async function searchCompanyPages(industry: string, region: string, cursor: number): Promise<SearchResult> {
 const terms=industryTerms(industry); const city=region==='中国大陆'?cities[Math.floor(cursor/3)%cities.length]:region;
 const suffix=['公司 官网 联系电话','厂家 联系我们','企业 地址 电话'][cursor%3];
 const query=`${city} ${terms[Math.floor(cursor/(cities.length*3))%terms.length]} ${suffix}`.trim();
 const first=Math.floor(cursor/(cities.length*3*terms.length))*10+1;
 const providers=[
  {name:'360 搜索',url:'https://www.so.com/s?'+new URLSearchParams({q:query,pn:String(Math.floor(first/10)+1)}),rss:false},
  {name:'必应网页',url:'https://cn.bing.com/search?'+new URLSearchParams({q:query,mkt:'zh-CN',first:String(first)}),rss:false},
  {name:'百度',url:'https://www.baidu.com/s?'+new URLSearchParams({wd:query,pn:String(first-1)}),rss:false},
  {name:'搜狗',url:'https://www.sogou.com/web?'+new URLSearchParams({query,page:String(Math.floor(first/10)+1)}),rss:false},
  {name:'必应公开索引',url:'https://cn.bing.com/search?'+new URLSearchParams({q:query,format:'rss',mkt:'zh-CN',first:String(first)}),rss:true},
 ];
 const report:SearchResult={urls:[],provider:'',query,candidates:0,filtered:0,unavailable:0,blocked:false};
 // Prefer the domestic index; rotate backups after an empty or blocked response.
 for(let offset=0;offset<2;offset++) {
  const provider=offset === 0 ? providers[0]! : providers[1+cursor%(providers.length-1)]!;report.provider=provider.name;
  try {
   const html=await readPublicPage(provider.url);
   if(blockedPage(html)){report.blocked=true;report.unavailable++;continue;}
   let rows:Array<{url:string;text:string}>;
   if(provider.rss) {
    const parsed=new XMLParser({ignoreAttributes:true}).parse(html);const items=parsed.rss?.channel?.item;
    rows=(Array.isArray(items)?items:items?[items]:[]).map((r:{link?:string;title?:string;description?:string})=>({url:publicCompanyUrl(String(r.link||'')),text:String(r.title||'')+' '+plain(String(r.description||''))}));
   }else rows=htmlResults(html,provider.url);
   if(!rows.length)report.unavailable++;
   report.candidates+=rows.length;
   const relevant=rows.filter(row => {
    if(!row.url || !matchesIndustry(row.text,industry) || /小说|章节|书评|旅游攻略|招聘岗位/.test(row.text.slice(0,140))){report.filtered++;return false;}
    return true;
   }).slice(0,10);
   const destinations=await Promise.allSettled(relevant.map(async row => {
    const direct=publicCompanyUrl(row.url);if(direct)return direct;
    // Follow only the official search redirect endpoints admitted by searchLink.
    const destination=await readDocument(row.url);
    return blockedPage(destination.html)?'':publicCompanyUrl(destination.url);
   }));
   for(const destination of destinations) {
    if(destination.status === 'fulfilled' && destination.value)report.urls.push(destination.value);
    else report.unavailable++;
   }
   report.urls=[...new Set(report.urls)];
   if(report.urls.length)break;
  }catch{report.unavailable++;}
 }
 return report;
}
function companyNameFrom(html:string,text:string) {
 const title=plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
 const pattern=/[\u4e00-\u9fffA-Za-z（）()·]{2,60}(?:股份有限公司|有限责任公司|有限公司|公司|工厂)/;
 const clean=(s:string)=>s.replace(/^(?:欢迎访问|欢迎来到|官方网站|官网|首页|关于我们|联系我们)+/,'').slice(0,160);
 return clean(title.match(pattern)?.[0] || text.match(pattern)?.[0] || '');
}
function phonesFrom(text:string,region:string) {
 const numbers=new Set<string>();const lines=text.split('\n');
 for(let i=0;i<lines.length;i++) {
  const line=lines[i]!;if(/^(?:传真|fax)\s*[:：]?/i.test(line) || /\+(?!86(?:\D|$))\d/.test(line) || /统一社会信用|ICP备|备案号/.test(line))continue;
  const labeled=/电话|热线|手机|联系|tel\b|phone/i.test(line);
  const previousLabel=lines.slice(Math.max(0,i-2),i).reverse().map(previous=>[...previous.matchAll(/传真|fax|电话|热线|手机|tel\b|phone/gi)].at(-1)?.[0]).find(Boolean);
  if(!labeled && previousLabel && /传真|fax/i.test(previousLabel))continue;
  const part=(labeled?[line,...lines.slice(i+1,i+3)].join('\n'):line).split(/传真|fax|统一社会信用|备案号|ICP备/i)[0]||'';
  // Complete numbers can stand on their own; local numbers require a contact label and explicit city.
  const pattern=/(?<![\d+])(?:\+86[\s-]*|0086[\s-]*)?(?:1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}|(?:400|800)[\s-]?\d{3}[\s-]?\d{4}|\(?0\d{2,3}\)?[\s-]*[2-9]\d{2,3}[\s-]?\d{4})(?!\d)/g;
  for(const m of part.matchAll(pattern)) {const n=normalizePhone(m[0]);if(n)numbers.add(n);}
  if(labeled)for(const m of part.matchAll(/(?<![\d+])(?:\(?[1-9]\d{1,2}\)?[ -]+)?[2-9]\d{6,7}(?!\d)/g)){const n=normalizePhone(m[0],region);if(n)numbers.add(n);}
 }
 return numbers;
}
export async function researchCompanyDetailed(raw: string, industry: string, region: string): Promise<ResearchResult> {
 const url=publicCompanyUrl(raw);if(!url)return {leads:[],reason:'IRRELEVANT',pages:0};
 let initial: {html:string;url:string};try{initial=await readDocument(url);}catch{return {leads:[],reason:'UNAVAILABLE',pages:0};}
 if(!publicCompanyUrl(initial.url)||blockedPage(initial.html))return {leads:[],reason:'UNAVAILABLE',pages:0};
 const root=new URL(initial.url);const pages=[{url:initial.url,html:initial.html,text:plain(initial.html)}];
 const links=[...initial.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .filter(m=>/contact|联系|关于|about/i.test(m[1]+' '+plain(m[2]||'')))
  .sort((a,b)=>Number(/contact|联系/i.test(b[1]+' '+b[2]))-Number(/contact|联系/i.test(a[1]+' '+a[2])))
  .map(m=>{try{const u=new URL(decode(m[1]||''),root);return u.hostname===root.hostname?publicCompanyUrl(u.href):'';}catch{return '';}}).filter(Boolean);
 const extra=await Promise.allSettled([...new Set(links)].filter(link=>link!==root.href).slice(0,3).map(async link=>{
  const page=await readDocument(link);return publicCompanyUrl(page.url)&&new URL(page.url).hostname===root.hostname&&!blockedPage(page.html)?{url:page.url,html:page.html,text:plain(page.html)}:null;
 }));
 for(const page of extra)if(page.status==='fulfilled'&&page.value)pages.push(page.value);
 const text=pages.map(p=>p.text.split(/相关企业|相关公司|其他企业|猜你喜欢|推荐企业|热门企业|附近公司|同行业企业|同城企业/)[0]).join('\n');const compact=text.replace(/\s/g,'');const count=pages.length;
 if(!matchesIndustry(text,industry))return {leads:[],reason:'IRRELEVANT',pages:count};
 const companyName=companyNameFrom(initial.html,text);if(!companyName)return {leads:[],reason:'NO_COMPANY',pages:count};
 const address=(text.match(/(?:公司地址|工厂地址|地\s*址|Address)\s*[:：]?\s*([^\n]{4,160})/i)?.[1]||'').split(/电话|手机|传真|邮箱|备案|Copyright/i)[0]?.trim()||'';
 const domestic=/[京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘粤桂琼渝川贵云藏陕甘青宁新]ICP备/.test(text)||cities.some(city=>city&&[address,companyName].join('').includes(city))||/中国|广东|江苏|浙江|山东|福建|河北|河南|四川|安徽|湖南|湖北|江西|广西|云南|贵州/.test(address);
 const rawPhones=new Map<string,string>();
 for(const page of pages) {
  for(const phone of phonesFrom(page.text.split(/相关企业|相关公司|其他企业|猜你喜欢|推荐企业|热门企业|附近公司|同行业企业|同城企业/)[0]||'',address||companyName))rawPhones.set(phone,page.url);
  for(const m of (page.html.split(/相关企业|相关公司|其他企业|猜你喜欢|推荐企业|热门企业|附近公司|同行业企业|同城企业/)[0]||'').matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
   const context=plain(page.html.slice(Math.max(0,(m.index||0)-220),m.index));
   const label=[...context.matchAll(/传真|fax|电话|热线|手机|tel\b|phone/gi)].at(-1)?.[0];
   if(label && /传真|fax/i.test(label))continue;
   const phone=normalizePhone(decode(m[1]||''),address||companyName);if(phone)rawPhones.set(phone,page.url);
  }
 }
 // Mainland phone format plus Chinese enterprise identity is enough; address/ICP are optional.
 if((region!=='中国大陆'&&!compact.includes(region)) || (!domestic&&(/香港|澳门|台湾|Hong Kong|Taiwan/i.test(address+companyName+root.hostname)||!/[\u4e00-\u9fff]/.test(companyName))))return {leads:[],reason:'REGION',pages:count};
 if(!rawPhones.size)return {leads:[],reason:'NO_PHONE',pages:count};
 const business=(text.match(/(?:主营产品|主营业务|经营范围|专业生产|主要生产|专注于|致力于)\s*[:：]?\s*[^\n。]{5,140}/)?.[0] || '').slice(0,140);
 return {reason:'ACCEPTED',pages:count,leads:[...rawPhones].map(([phone,sourceUrl])=>({companyName,phone,industry,address,business,sourceUrl}))};
}
export async function researchCompany(raw:string,industry:string,region:string):Promise<Lead[]> {return (await researchCompanyDetailed(raw,industry,region)).leads;}
