/*
 * 中文导读：知识库：recording-knowledge.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {randomUUID} from 'node:crypto';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {type Scope} from '../crm/crm.service.js';
import {canTrain} from '../agent/agent.release.js';
import {learningSuggestionSchema, type LearningSource} from '../agent/agent.learning-analysis.js';
import {analysisSchema, knowledgeHash, normalizedKnowledge, writeKnowledge, knowledgeAccess} from './knowledge-library.js';

// This step reuses the paid analysis already received. It never calls a model,
// enables a fact, or changes a digital employee's script.
export async function recordingKnowledge(s:Scope&{agentId:string},id:string){
 return writeKnowledge(s,'update',async db=>{
  if(!canTrain((await knowledgeAccess(s,'update',db)).permissions))throw new BadRequestError('录音学习由培训负责人维护。');
  const r=(await db.query(`SELECT * FROM "AgentLearningRecording" WHERE "workspaceId"=$1 AND "agentId"=$2 AND "id"=$3 AND "status"='READY' AND "deletedAt" IS NULL FOR UPDATE`,[s.workspaceId,s.agentId,id]))[0];
  if(!r)throw new BadRequestError('录音尚未整理完成或已归档。');
  const ref='recording:'+id;
  const existing=(await db.query('SELECT "id","status","revision","deletedAt" FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1 AND "sourceRef"=$2 ORDER BY "createdAt" LIMIT 1',[s.workspaceId,ref]))[0];
  // Once handed to the knowledge reviewers, their edits and review state own
  // the document. Reopening a recording cannot overwrite accepted knowledge.
  if(existing)return existing;
  const a=learningSuggestionSchema.parse({...r.analysis,removed:(r.analysis.removed||[]).slice(0,60)});
  const sources=(r.analysis.sourceSegments||[]) as LearningSource[];
  const content=(sources.map(v=>v.text).join('\n\n')||r.transcript||'').trim();
  if(!content||content.length>60000)throw new BadRequestError('原始转写为空或超过资料长度上限，请分段整理。');
  const candidates:Array<{id:string;title:string;content:string;category:string;tags:string[];quote:string;needsConfirmation:boolean;requiresExpiry:boolean}>=[];
  let excluded=0;
  const keywords=[...new Set((a.keywords||[]).map(k=>k.word.slice(0,30)))].slice(0,12);
  function add(title:string,answer:string,category:string,evidence?:{sourceId:number;quote:string}){
   const source=sources.find(v=>v.id===evidence?.sourceId),quote=evidence?.quote||'';
   if(!source||!normalizedKnowledge(source.text).includes(normalizedKnowledge(quote))||normalizedKnowledge(quote).length<2||!normalizedKnowledge(content).includes(normalizedKnowledge(quote))||/(?:\+?86[- ]?)?1[3-9]\d{9}/.test(title+answer)){excluded++;return;}
   const text=title+' '+answer+' '+quote;
   const requiresExpiry=/(?:今晚|今[天晚]|明[天晚]|后天|本周|这周|下周|本月|下个月|本次|此次|[一二三四五六日天]点|\d{1,2}[点时:：]|\d{1,2}月\d{1,2}[日号]|\d{4}[-年/]\d{1,2})/.test(text);
   const needsConfirmation=requiresExpiry||/(?:免费|不收费|费用|收费|价格|价钱|\d+\s*[元万块]|保证|承诺|上门|包教|资质|认证|收益|盈利|回本|百分之|\d+%)/.test(text)||a.unverifiedClaims.some(claim=>normalizedKnowledge(claim).length>3&&normalizedKnowledge(text).includes(normalizedKnowledge(claim)));
   if(!candidates.some(v=>normalizedKnowledge(v.content)===normalizedKnowledge(answer)))candidates.push({id:'r'+(candidates.length+1),title:title.slice(0,100),content:answer,category,tags:keywords,quote,needsConfirmation,requiresExpiry});
  }
  for(const f of a.faqs)add(f.question,f.answer,'常见问答',f.evidence);
  for(const o of a.objections)add(o.trigger,o.response,'异议处理',o.evidence);
  const analysis=analysisSchema.parse({summary:a.summary.slice(0,1500),keywords,removed:[...new Set((r.analysis.removed||[]).map((v:{reason:string})=>v.reason))].slice(0,19).concat(excluded?['缺少可靠原文依据的建议已排除']:[]),warnings:[...a.unverifiedClaims.map(c=>c.slice(0,300)),...(candidates.some(c=>c.requiresExpiry)?['临时时间与活动安排需改成明确日期并设置有效期。']:[])].slice(0,20),candidates});
  const size=(await db.query('SELECT count(*)::int AS n,COALESCE(sum(COALESCE(octet_length("fileData"),0)+octet_length("content")),0)::bigint AS bytes FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1',[s.workspaceId]))[0];
  if(Number(size?.n)>=150||Number(size?.bytes)+Buffer.byteLength(content)>200*1024*1024)throw new BadRequestError('资料库容量已满，请先整理资料。');
  const doc=randomUUID();
  // Keep the recording scoped to the digital employee it was uploaded for.
  // The reviewed knowledge can still be made workspace-wide explicitly by a
  // manager during review, but it must never become global by accident.
  await db.query(`INSERT INTO "WorkspaceKnowledgeDocument" ("id","organizationId","agentId","createdBy","name","content","contentHash","sourceKind","sourceRef","status","analysis","analysisModel") VALUES ($1,$2,$3,$4,$5,$6,$7,'RECORDING',$8,'REVIEW',$9::jsonb,'录音分析结果') RETURNING "id"`,[doc,s.workspaceId,r.agentId,s.userId,r.name.slice(0,160),content,knowledgeHash(content),ref,JSON.stringify(analysis)]);
  return {id:doc,status:'REVIEW',revision:1,deletedAt:null};
 });
}
