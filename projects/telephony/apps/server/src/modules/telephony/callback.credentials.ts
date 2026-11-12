/*
 * 中文导读：线路与语音外呼：callback.credentials.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,unlink,open,stat} from 'node:fs/promises';
import {BadRequestError} from '../../common/errors/badRequest.js';

export type CallbackCredentials={appKey:string;appSecret:string;hookToken:string};
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
const file=()=>process.env.TAIGUA_CALLBACK_CREDENTIAL_FILE||'';
export const canStoreCallbackCredentials=()=>!!file();
async function store():Promise<Record<string,CallbackCredentials>>{
 if(!file())return {};
 try{
  const info=await stat(file());if(info.size>256*1024||(info.mode&0o077)!==0)throw new Error();
  return JSON.parse(await readFile(file(),'utf8'));
 }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw new BadRequestError('人工回拨密钥存储不可用，请联系系统管理员。');}
}
export async function callbackCredentials(workspaceId:string){return (await store())[workspaceId]||null;}
export async function writeCallbackCredentials(workspaceId:string,value:{appKey:string;appSecret:string}){
 if(!file())throw new BadRequestError('人工回拨密钥存储尚未部署。');
 const lock=await open(file()+'.lock','wx',0o600).catch(()=>{throw new BadRequestError('配置正在保存，请稍后重试。');});
 const temporary=file()+'.'+randomUUID()+'.tmp';
 try{
  const entries=await store(),prior=entries[workspaceId];
  const next={...value,hookToken:prior?.hookToken||randomBytes(32).toString('hex')};
  entries[workspaceId]=next;
  await writeFile(temporary,JSON.stringify(entries),{mode:0o600,flag:'wx'});await rename(temporary,file());return next;
 }finally{await lock.close();await unlink(file()+'.lock').catch(()=>{});await unlink(temporary).catch(()=>{});}
}
