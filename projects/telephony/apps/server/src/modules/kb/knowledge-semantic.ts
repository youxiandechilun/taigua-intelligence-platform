/*
 * 中文导读：知识库：knowledge-semantic.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {createHash,randomUUID} from 'node:crypto';
import {crmDb} from '../crm/crm.db.js';
import {modelKey} from '../telephony/model-credentials.js';
import {observeTextUsage,keyFingerprint} from '../telephony/model-telemetry.js';
import type {Row} from '../crm/crm.service.js';

export const embeddingModel='text-embedding-v4';
const dimensions=1024;
const endpoint='https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
const cache=new Map<string,{vector:number[];until:number}>();
const running=new Map<string,Promise<number[]>>();
type IndexedPassage={vector:Float32Array;note:Row;agentId:string|null};
const passageCache=new Map<string,{version:string;checkedAt:number;items:IndexedPassage[]}>();
const passageLoads=new Map<string,Promise<IndexedPassage[]>>();
let activeLookups=0;
export const knowledgeFingerprint=(n:{title:string;content:string;tags?:string[]})=>createHash('md5').update(n.title+'\n'+n.content+'\n'+(n.tags||[]).join('\n')).digest('hex');
export async function semanticConnection(org:string){
 const settings=(await crmDb.query('SELECT "semanticEnabled" FROM "KnowledgeRetrievalSettings" WHERE "organizationId"=$1',[org]))[0];
 if(settings?.semanticEnabled===false)return null;
 const enabled=(await crmDb.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[org]))[0]?.settings?.enabled||[];
 if(!enabled.some((v:string)=>v.startsWith('qwen')))return null;
 const key=await modelKey(org,'DASHSCOPE_API_KEY');return key?{key}:null;
}
function unit(raw:unknown):number[]{
 if(!Array.isArray(raw)||raw.length!==dimensions||raw.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new Error('invalid_embedding');
 const magnitude=Math.sqrt(raw.reduce((a,n)=>a+n*n,0));if(magnitude<1e-8)throw new Error('empty_embedding');return raw.map(n=>n/magnitude);
}
async function embeddings(org:string,key:string,input:string[],timeout:number,purpose:string){
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:embeddingModel,input,dimensions,encoding_format:'float'}),signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw new Error('embedding_http_'+response.status);
 const text=await response.text();if(text.length>2000000)throw new Error('embedding_response_too_large');
 const body=JSON.parse(text) as {data?:{index:number;embedding:unknown}[];usage?:unknown};
 if(!Array.isArray(body.data)||body.data.length!==input.length)throw new Error('embedding_count');
 const data=[...body.data].sort((a,b)=>a.index-b.index);if(data.some((v,i)=>v.index!==i))throw new Error('embedding_order');
 const vectors=data.map(v=>unit(v.embedding));
 await observeTextUsage(org,{id:embeddingModel,key:'DASHSCOPE_API_KEY'},body,purpose).catch(()=>console.warn('[knowledge] embedding usage observation delayed'));
 return vectors;
}
async function queryVector(org:string,key:string,question:string){
 const id=createHash('sha256').update(org+':'+keyFingerprint(key)+':'+embeddingModel+':'+question).digest('hex');
 const saved=cache.get(id);if(saved&&saved.until>Date.now())return saved.vector;
 if(running.has(id))return running.get(id)!;
 const promise=embeddings(org,key,[question],2200,'KNOWLEDGE_SEARCH').then(v=>{if(cache.size>=200)cache.delete(cache.keys().next().value!);cache.set(id,{vector:v[0]!,until:Date.now()+15*60000});return v[0]!;});
 running.set(id,promise);try{return await promise;}finally{running.delete(id);}
}
async function indexedPassages(org:string):Promise<IndexedPassage[]>{
 const cached=passageCache.get(org);if(cached&&Date.now()-cached.checkedAt<1000)return cached.items;
 const inflight=passageLoads.get(org);if(inflight)return inflight;
 const load=(async()=>{
  const stamp=(await crmDb.query('SELECT count(*)::int AS n,max("updatedAt")::text AS latest FROM "KnowledgeIndexJob" WHERE "organizationId"=$1',[org]))[0];
  const version=JSON.stringify(stamp);
  if(cached?.version===version){cached.checkedAt=Date.now();return cached.items;}
  const items:IndexedPassage[]=[];
  // Load in small batches and retain compact vectors once per workspace, not once per call.
  for(let offset=0;offset<24000;offset+=256){
   const rows=await crmDb.query(`SELECT p."vector",p."content" AS passage,n."id",n."title",n."agentId",n."sourceTitle",n."sourceQuote",n."documentId",n."validUntil",n."revision" FROM "KnowledgePassage" p JOIN "WorkspaceKnowledge" n ON n."id"=p."knowledgeId" AND n."organizationId"=p."organizationId" WHERE p."organizationId"=$1 AND p."model"=$2 AND n."enabled"=true AND n."deletedAt" IS NULL AND (n."validUntil" IS NULL OR n."validUntil">NOW()) AND p."contentHash"=md5(n."title"||E'\n'||n."content"||E'\n'||array_to_string(n."tags",E'\n')) ORDER BY n."id",p."position" LIMIT 256 OFFSET $3`,[org,embeddingModel,offset]);
   for(const row of rows){const {vector,passage,agentId,...note}=row;if(Array.isArray(vector)&&vector.length===dimensions&&vector.every(Number.isFinite))items.push({vector:Float32Array.from(vector),agentId,note:{...note,content:passage}});}
   if(rows.length<256)break;
  }
  passageCache.clear();passageCache.set(org,{version,checkedAt:Date.now(),items});return items;
 })();
 passageLoads.set(org,load);try{return await load;}finally{passageLoads.delete(org);}
}
export async function semanticKnowledge(org:string,agentId:string|null,question:string){
 if(activeLookups>=4)return {items:[] as Row[],state:'BUSY'};
 activeLookups++;
 try{
  const connection=await semanticConnection(org);if(!connection)return {items:[] as Row[],state:'DISABLED'};
  const passages=(await indexedPassages(org)).filter(p=>(!p.agentId||p.agentId===agentId)&&(!p.note.validUntil||new Date(p.note.validUntil).getTime()>Date.now()));
  if(!passages.length)return {items:[] as Row[],state:'INDEXING'};
  const vector=await queryVector(org,connection.key,question.trim().slice(-1000)),best=new Map<string,Row>();
  for(const p of passages){let score=0;for(let i=0;i<dimensions;i++)score+=vector[i]!*p.vector[i]!;if(!Number.isFinite(score)||score<0.58)continue;const n=p.note,current=best.get(n.id);if(!current||score>current.similarity)best.set(n.id,{...n,similarity:score,match:'semantic'});}
  return {items:[...best.values()].sort((a,b)=>b.similarity-a.similarity).slice(0,5),state:'READY'};
 }finally{activeLookups--;}
}
function passages(n:Row){
 const output:string[]=[];let from=0;
 while(from<n.content.length){let to=Math.min(from+1600,n.content.length);if(to<n.content.length){const p=n.content.lastIndexOf('\n',to);if(p>from+1000)to=p;}output.push(n.content.slice(from,to));if(to===n.content.length)break;from=Math.max(from+1,to-180);}
 return output.slice(0,24);
}
async function indexTick(){
 const candidates=await crmDb.query(`SELECT j."knowledgeId",j."organizationId" FROM "KnowledgeIndexJob" j WHERE j."status"='PENDING' OR j."status"='PROCESSING' AND j."leaseUntil"<NOW() ORDER BY j."updatedAt" LIMIT 20`);
 for(const candidate of candidates){
  const connection=await semanticConnection(candidate.organizationId).catch(()=>null);if(!connection)continue;
  const attempt=randomUUID();
  const jobs=await crmDb.query(`UPDATE "KnowledgeIndexJob" j SET "status"='PROCESSING',"attemptId"=$3,"leaseUntil"=NOW()+INTERVAL '3 minutes',"error"='',"updatedAt"=NOW() WHERE j."organizationId"=$1 AND j."knowledgeId"=$2 AND (j."status"='PENDING' OR j."status"='PROCESSING' AND j."leaseUntil"<NOW()) RETURNING j.*`,[candidate.organizationId,candidate.knowledgeId,attempt]);
  if(!jobs.length)continue;
  const job=jobs[0]!;
  try{
   const note=(await crmDb.query('SELECT * FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "id"=$2 AND "enabled"=true AND "deletedAt" IS NULL AND ("validUntil" IS NULL OR "validUntil">NOW())',[job.organizationId,job.knowledgeId]))[0];
   if(!note||knowledgeFingerprint(note as {title:string;content:string;tags:string[]})!==job.contentHash){await crmDb.query('UPDATE "KnowledgeIndexJob" SET "status"=\'INACTIVE\',"leaseUntil"=NULL WHERE "knowledgeId"=$1 AND "attemptId"=$2 RETURNING "knowledgeId"',[job.knowledgeId,attempt]);return;}
   const parts=passages(note),vectors:number[][]=[];
   for(let i=0;i<parts.length;i+=10){
    const current=await semanticConnection(job.organizationId);if(!current||current.key!==connection.key)throw new Error('authorization_changed');
    vectors.push(...await embeddings(job.organizationId,current.key,parts.slice(i,i+10).map(p=>note.title+'\n'+(note.tags||[]).join('、')+'\n'+p),20000,'KNOWLEDGE_INDEX'));
   }
   await crmDb.transaction(async db=>{
    const current=(await db.query('SELECT * FROM "KnowledgeIndexJob" WHERE "knowledgeId"=$1 AND "attemptId"=$2 AND "contentHash"=$3 FOR UPDATE',[job.knowledgeId,attempt,job.contentHash]))[0];if(!current)return;
    await db.query('DELETE FROM "KnowledgePassage" WHERE "organizationId"=$1 AND "knowledgeId"=$2 RETURNING "id"',[job.organizationId,job.knowledgeId]);
    for(let i=0;i<parts.length;i++)await db.query('INSERT INTO "KnowledgePassage" ("id","organizationId","knowledgeId","contentHash","model","position","content","vector") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING "id"',[randomUUID(),job.organizationId,job.knowledgeId,job.contentHash,embeddingModel,i,parts[i],JSON.stringify(vectors[i])]);
    await db.query('UPDATE "KnowledgeIndexJob" SET "status"=\'READY\',"leaseUntil"=NULL,"updatedAt"=NOW() WHERE "knowledgeId"=$1 AND "attemptId"=$2 RETURNING "knowledgeId"',[job.knowledgeId,attempt]);
   });
   passageCache.delete(job.organizationId);
  }catch(e){
   const reason=e instanceof Error&&e.message==='authorization_changed'?'模型授权已变化，请核对后重建索引。':'语义索引未完成，请核对阿里云模型权限、余额和用量后重试。';
   await crmDb.query('UPDATE "KnowledgeIndexJob" SET "status"=\'ERROR\',"error"=$3,"leaseUntil"=NULL,"updatedAt"=NOW() WHERE "knowledgeId"=$1 AND "attemptId"=$2 RETURNING "knowledgeId"',[job.knowledgeId,attempt,reason]).catch(()=>{});
  }
  return;
 }
}
let timer:ReturnType<typeof setInterval>|undefined,work:Promise<void>|undefined,stopping=false;
export function startKnowledgeIndexWorker(){if(timer)return;stopping=false;timer=setInterval(()=>{if(stopping||work)return;work=indexTick().catch(()=>console.warn('[knowledge] semantic index queue unavailable')).finally(()=>{work=undefined;});},6000);timer.unref();}
export async function stopKnowledgeIndexWorker(){stopping=true;if(timer)clearInterval(timer);timer=undefined;await work;}
