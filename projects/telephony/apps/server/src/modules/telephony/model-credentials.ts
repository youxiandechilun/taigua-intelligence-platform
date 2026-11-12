/*
 * 中文导读：按工作区解析模型凭据的作用域。
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,unlink,open,stat,chmod} from 'node:fs/promises';
import {z} from 'zod';
import prisma from '../../config/prisma.js';
import {companyContext} from '../workspace/company-access.js';
import {type Scope} from '../crm/crm.service.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {platformConfiguration,platformEnabled} from '../platform/platform-client.js';

const providers={qwen:{name:'阿里云百炼',key:'DASHSCOPE_API_KEY'},deepseek:{name:'DeepSeek',key:'DEEPSEEK_API_KEY'},zhipu:{name:'智谱',key:'ZHIPU_API_KEY'},stepfun:{name:'阶跃星辰',key:'STEPFUN_API_KEY'}} as const;
const variable=/^TG_[A-F0-9]{64}_(DASHSCOPE|DEEPSEEK|ZHIPU|STEPFUN)_API_KEY$/;
const value=/^[A-Za-z0-9_.-]{16,512}$/;
export const credentialScope=(workspaceId:string)=>createHash('sha256').update(workspaceId).digest('hex').toUpperCase();
const storePath=()=>process.env.TAIGUA_MODEL_ENV_FILE||'';
async function readStore(){
 const path=storePath();if(!path)return {} as Record<string,string>;
 const info=await stat(path);if(info.size>256*1024 || (info.mode&0o007)!==0)throw new BadRequestError('模型密钥存储权限异常，请联系系统管理员。');
 const entries:Record<string,string>={};
 for(const line of (await readFile(path,'utf8')).split('\n')){
  if(!line||line.startsWith('#'))continue;
  const index=line.indexOf('='),key=line.slice(0,index),secret=line.slice(index+1);
  if(index<0||!variable.test(key)||!value.test(secret))throw new BadRequestError('模型密钥配置格式异常，请联系系统管理员。');
  entries[key]=secret;
 }
 return entries;
}
export async function modelKey(workspaceId:string,key:string){
 if(platformEnabled()){
  const configuration=await platformConfiguration();
  if(configuration.telephony.enabled&&configuration.telephony.api_key)return configuration.telephony.api_key;
  return configuration.model.enabled?configuration.model.api_key:'';
 }
 const scoped='TG_'+credentialScope(workspaceId)+'_'+key,entries=await readStore();
 // Managed values become process environment variables; secrets never enter
 // source, database settings or audit metadata. Plaintext is available only
 // through the separate super-administrator credential endpoint.
 if(entries[scoped]){process.env[scoped]=entries[scoped];return process.env[scoped]!;}
 delete process.env[scoped];return process.env[key]||'';
}
export async function credentialStatus(workspaceId:string){
 return Promise.all(Object.entries(providers).map(async([id,p])=>({id,name:p.name,configured:!!await modelKey(workspaceId,p.key).catch(()=>''),canSave:!!storePath()})));
}
export async function saveCredential(s:Scope,input:unknown){
 if(!(await companyContext(s.workspaceId,s.userId)).isSystemAdmin)throw new ForbiddenError('模型密钥仅系统超级管理员可以配置。');
 const data=z.object({provider:z.enum(['qwen','deepseek','zhipu','stepfun']),apiKey:z.string().trim().regex(value,'请填写有效的模型 API Key')}).strict().parse(input);
 const path=storePath();if(!path)throw new BadRequestError('模型配置入口尚未部署，请联系系统管理员。');
 let lock;
 try{lock=await open(path+'.lock','wx',0o600);}catch{throw new BadRequestError('模型配置正在保存，请稍后重试。');}
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{
  const entries=await readStore(),key='TG_'+credentialScope(s.workspaceId)+'_'+providers[data.provider].key;
  entries[key]=data.apiKey;
  await writeFile(temporary,Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v+'\n').join(''),{mode:0o640,flag:'wx'});
  await chmod(temporary,0o640);await rename(temporary,path);process.env[key]=data.apiKey;
 }catch{throw new BadRequestError('模型密钥未能保存，请联系系统管理员核对。');}
 finally{await lock.close();await unlink(path+'.lock').catch(()=>{});await unlink(temporary).catch(()=>{});}
 await prisma.auditLog.create({data:{organizationId:s.workspaceId,userId:s.userId,action:'MODEL_CREDENTIAL_SAVED',resourceType:'WorkspaceModelSettings',resourceId:s.workspaceId,metadata:{provider:data.provider}}});
 return {saved:true,verified:false};
}

export async function readCredential(s:Scope,provider:unknown){
 if(!(await companyContext(s.workspaceId,s.userId)).isSystemAdmin)throw new ForbiddenError('仅系统超级管理员可以查看模型密钥。');
 const id=z.enum(['qwen','deepseek','zhipu','stepfun']).parse(provider);
 const apiKey=await modelKey(s.workspaceId,providers[id].key);
 await prisma.auditLog.create({data:{organizationId:s.workspaceId,userId:s.userId,action:'MODEL_CREDENTIAL_VIEWED',resourceType:'WorkspaceModelSettings',resourceId:s.workspaceId,metadata:{provider:id}}});
 return {provider:id,apiKey};
}
