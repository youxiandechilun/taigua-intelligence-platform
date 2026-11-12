/*
 * 中文导读：企业微信：wecom.client.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { createHash } from 'node:crypto';
import { BadRequestError } from '../../common/errors/badRequest.js';
export type WecomCredentials={secret:string;callbackToken?:string;aesKey?:string;agentId?:string};
type Json=Record<string,any>;
export class WecomSendError extends Error {
 constructor(public uncertain:boolean, message:string){super(message);}
}
const BASE='https://qyapi.weixin.qq.com/cgi-bin/';
const cache=new Map<string,{token:string;expires:number}>();
const pending=new Map<string,Promise<string>>();
export function wecomError(code:number){
 const explanations:Record<number,string>={40001:'企业微信 Secret 不正确。',40013:'企业 CorpID 不正确。',40014:'企业微信凭据已失效，请重新检查连接。',40029:'扫码凭据已失效，请重新发起扫码。',42001:'企业微信凭据已过期，请重新检查连接。',42003:'扫码凭据已过期，请重新发起扫码。',50001:'请在企业微信应用中配置当前系统域名为可信域名。',60020:'请在企业微信应用中将本服务器出口 IP 加入可信 IP。',48002:'当前应用没有客户联系权限，请在企微客户联系中授权此应用。',60011:'员工不在应用可见范围内。',60111:'员工 UserId 不存在。',84014:'员工尚未开通客户联系功能。'};
 return new BadRequestError(explanations[code]||`企业微信接口暂不可用（错误码 ${code}），请核对应用权限与客户联系配置。`);
}
export function wecomClient(org:string,corpId:string,c:WecomCredentials,fetcher:typeof fetch=fetch){
 const key=createHash('sha256').update(org+'\0'+corpId+'\0'+c.secret).digest('hex');
 async function request(path:string,body?:Json,query:Record<string,string>={}){
  const u=new URL(BASE+path);for(const[k,v]of Object.entries(query))u.searchParams.set(k,v);
  let res:Response;try{res=await fetcher(u,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw new BadRequestError('企业微信服务连接超时，请稍后重试。');}
  if(!res.ok)throw new BadRequestError('企业微信服务暂不可用，请稍后重试。');
  const data=await res.json() as Json;if(Number(data.errcode||0)!==0)throw wecomError(Number(data.errcode));return data;
 }
 async function token(force=false):Promise<string>{
  if(!force){const t=cache.get(key);if(t&&t.expires>Date.now())return t.token;}
  if(pending.has(key))return pending.get(key)!;
  const promise=request('gettoken',undefined,{corpid:corpId,corpsecret:c.secret}).then(d=>{if(typeof d.access_token!=='string'||!d.access_token)throw new BadRequestError('企业微信未返回有效凭据。');cache.set(key,{token:d.access_token,expires:Date.now()+Math.max(1,Number(d.expires_in||7200)-120)*1000});return d.access_token as string;});pending.set(key,promise);try{return await promise;}finally{pending.delete(key);}
 }
 async function call(path:string,body?:Json,query:Record<string,string>={}){const t=await token();try{return await request(path,body,{...query,access_token:t});}catch(e){if(e instanceof BadRequestError&&/凭据已(过期|失效)/.test(e.message)){cache.delete(key);return request(path,body,{...query,access_token:await token(true)});}throw e;}}
 async function sendText(user:string,content:string){
  if(!/^[A-Za-z0-9_.@-]{1,100}$/.test(user)||user.toLowerCase()==='@all'||!/^\d{1,10}$/.test(c.agentId||''))throw new WecomSendError(false,'员工或应用 ID 不正确，请检查企业微信配置。');
  if(Buffer.byteLength(content,'utf8')>2048)throw new WecomSendError(false,'通知内容过长。');
  let t:string;try{t=await token();}catch{throw new WecomSendError(false,'无法取得企微调用凭据，请检查连接。');}
  const u=new URL(BASE+'message/send');u.searchParams.set('access_token',t);
  let data:Json;
  try{
   const response=await fetcher(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({touser:user,msgtype:'text',agentid:Number(c.agentId),text:{content},safe:1,enable_duplicate_check:1,duplicate_check_interval:14400}),signal:AbortSignal.timeout(15000),redirect:'error'});
   if(!response.ok)throw new Error('unconfirmed');data=await response.json() as Json;
   if(typeof data.errcode!=='number')throw new Error('unconfirmed');
  }catch{throw new WecomSendError(true,'发送结果未确认，请在企业微信核对；系统不会自动重发。');}
  if(data.errcode!==0)throw new WecomSendError(false,wecomError(data.errcode).message);
  if([data.invaliduser,data.unlicenseduser].filter(Boolean).join('|').split('|').some(id=>id.toLowerCase()===user.toLowerCase()))throw new WecomSendError(false,'接收员工不在应用可见范围内，或没有基础接口权限。');
  return typeof data.msgid==='string'?data.msgid:'';
 }
 async function application(){if(!/^\d{1,10}$/.test(c.agentId||''))throw new BadRequestError('请填写有效的企微应用 ID。');const d=await call('agent/get',undefined,{agentid:c.agentId!});if(Number(d.agentid)!==Number(c.agentId)||Number(d.close)!==0)throw new BadRequestError('企微应用 ID 不匹配，或应用已停用。');return {
  users:(d.allow_userinfos?.user||[]).map((u:any)=>String(u.userid||'')).filter(Boolean) as string[],
  departments:(d.allow_partys?.partyid||[]).map(Number).filter((n:number)=>Number.isInteger(n)&&n>0) as number[],
  tags:(d.allow_tags?.tagid||[]).map(Number).filter((n:number)=>Number.isInteger(n)&&n>0) as number[],
 };}
 async function applicationAllows(user:string){
  // getuserinfo alone can return an employee outside the application's visible scope.
  const app=await application();
  if(app.users.some(u=>u.toLowerCase()===user.toLowerCase()))return true;
  if(app.departments.length){
   const profile=await call('user/get',undefined,{userid:user});
   if(String(profile.userid||'').toLowerCase()!==user.toLowerCase()||Number(profile.status)!==1)return false;
   const parents=new Map<number,number>();
   const departments=await call('department/list');
   for(const d of departments.department||[])parents.set(Number(d.id),Number(d.parentid));
   for(const id of profile.department||[]){let current=Number(id);const seen=new Set<number>();while(current>0&&!seen.has(current)){if(app.departments.includes(current))return true;seen.add(current);current=parents.get(current)||0;}}
  }
  for(const tag of app.tags.slice(0,100)){const members=await call('tag/get',undefined,{tagid:String(tag)});if((members.userlist||[]).some((u:any)=>String(u.userid||'').toLowerCase()===user.toLowerCase()))return true;}
  return false;
 }
 return {followUsers:async()=>{const d=await call('externalcontact/get_follow_user_list');return (d.follow_user||[]).map(String) as string[];},
  userInfo:(code:string)=>call('auth/getuserinfo',undefined,{code}),
  list:async(user:string)=>{const d=await call('externalcontact/list',undefined,{userid:user});return(d.external_userid||[]).map(String) as string[];},
  detail:(id:string)=>call('externalcontact/get',undefined,{external_userid:id}),
  addWay:(user:string,remark:string,state:string)=>call('externalcontact/add_contact_way',{type:1,scene:2,user:[user],remark,state,skip_verify:false,is_temp:false}),
  sendText,
  application, applicationAllows,
 };
}
