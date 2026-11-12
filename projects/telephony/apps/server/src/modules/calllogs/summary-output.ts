/*
 * 中文导读：通话记录：summary-output.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {callSummarySchema,groundCallSummary,type TranscriptLine,type CallSummary} from './call-analysis.js';

const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const quotes=(v:unknown,max:number)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&!!x.trim()).slice(0,max).map(x=>x.trim().slice(0,600)):[];

// Provider formatting must not discard a completed call. Only transcript-backed
// statements survive grounding; malformed output falls back to customer quotes.
export function parseSummaryOutput(content:unknown,rows:TranscriptLine[],metadata:unknown={}):{summary:CallSummary;warning:string|null}{
 let raw:unknown,warning:string|null=null;
 try{
  if(typeof content!=='string'||content.length>100000)throw new Error();
  raw=JSON.parse(content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error();
 }catch{raw={};warning='INVALID_JSON';}
 const r=obj(raw),e=obj(r.evidence),q=obj(r.quality);
 if(!warning&&!callSummarySchema.safeParse(raw).success)warning='NORMALIZED_FIELDS';
 const candidate={
  summary:text(r.summary,1500)||'客户需求待核对。',need:text(r.need,600),
  intent:['INTERESTED','FOLLOW_UP','NO_NEED','OPT_OUT','UNKNOWN'].includes(String(r.intent))?r.intent:'UNKNOWN',
  handoff:r.handoff===true,reason:text(r.reason,600),nextAction:text(r.nextAction,600),
  evidence:{summary:quotes(e.summary,6),need:quotes(e.need,4),intent:quotes(e.intent,4),handoff:quotes(e.handoff,4)},
  quality:{outcome:['GOOD','NEEDS_IMPROVEMENT','INSUFFICIENT'].includes(String(q.outcome))?q.outcome:'INSUFFICIENT',summary:text(q.summary,1000)||'模型未提供完整评估，请结合原始通话核对。',issues:Array.isArray(q.issues)?q.issues.slice(0,8).map(i=>obj(i)).map(i=>({issue:text(i.issue,300),evidence:text(i.evidence,600),suggestion:text(i.suggestion,600)})).filter(i=>i.issue&&i.evidence):[]},
 };
 const summary=groundCallSummary(callSummarySchema.parse(candidate),rows,metadata)!;
 return {summary,warning};
}
