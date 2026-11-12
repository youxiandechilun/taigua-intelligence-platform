/*
 * 中文导读：线路与语音外呼：callback.client.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {createHash} from 'node:crypto';

// This is the formal API supplied by the carrier, not the reference/demo site.
export const CALLBACK_ORIGIN='https://crm.hkh10086.com';
type Params=Record<string,string|number|undefined|null>;
export const callbackSign=(params:Params,secret:string)=>createHash('md5').update(secret+Object.keys(params).filter(k=>k!=='sign'&&params[k]!==undefined&&params[k]!==null&&params[k]!=='').sort().map(k=>k+String(params[k])).join(''),'utf8').digest('hex').toUpperCase();

// Supplier IDs exceed Number.MAX_SAFE_INTEGER. Preserve unquoted long integers
// too; never change number-looking text inside JSON strings.
export function parseProviderJson(text:string):any {
 let output='',quoted=false,escape=false;
 for(let i=0;i<text.length;i++){
  const c=text[i]!;
  if(quoted){output+=c;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;output+=c;continue;}
  if(c==='-'||/\d/.test(c)){
   const token=text.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
   if(token){output+=/^-?\d{16,}$/.test(token)?JSON.stringify(token):token;i+=token.length-1;continue;}
  }
  output+=c;
 }
 return JSON.parse(output);
}
export class CallbackRejected extends Error {
 constructor(public readonly providerCode:string){super('回拨平台未接受请求，请核对员工授权和线路额度（'+providerCode+'）。');}
}
export class CallbackUncertain extends Error {constructor(){super('回拨平台响应未确认，请核对话单；系统不会自动重拨。');}}
export class CallbackClient {
 constructor(private credentials:{appKey:string;appSecret:string},private transport:typeof fetch=fetch){}
 async request(action:'add-user'|'delete-user'|'update-phone'|'update-call-type'|'query-num'|'update-num'|'call'|'call-detail'|'get-count-detail',params:Params={}){
  const body={...params,appKey:this.credentials.appKey};
  let reply:Response;
  try{reply=await this.transport(CALLBACK_ORIGIN+'/admin/base/open-api/'+action,{method:'POST',headers:{'Content-Type':'application/json;charset=utf-8'},body:JSON.stringify({...body,sign:callbackSign(body,this.credentials.appSecret)}),redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new CallbackUncertain();}
  if(!reply.ok)throw new CallbackUncertain();
  let raw:string,data:any;
  try{raw=await reply.text();if(raw.length>2*1024*1024)throw new Error();data=parseProviderJson(raw);}catch{throw new CallbackUncertain();}
  if(!data||typeof data!=='object'||Array.isArray(data)||!('code'in data))throw new CallbackUncertain();
  if(data.code!==0&&data.code!=='0')throw new CallbackRejected(/^[a-zA-Z0-9_-]{1,24}$/.test(String(data.code))?String(data.code):'REJECTED');
  return data.data;
 }
}
