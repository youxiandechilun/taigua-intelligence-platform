/*
 * 中文导读：数字员工与话术：agent.flow.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';

const id = z.string().regex(/^[\w-]{1,100}$/);
const flowPortSchema=z.object({side:z.enum(['top','right','bottom','left']),offset:z.number().min(0).max(1)}).strict();
const flowPortsSchema=z.object({input:flowPortSchema.optional(),outputs:z.record(z.string().min(1).max(40),flowPortSchema).refine(value=>Object.keys(value).length<=245,'连接点数量超出限制').optional()}).strict();
export const flowNodeSchema = z.object({
  id, kind: z.enum(['speech','collect','text','ivr','jump','end','handoff']),
  title: z.string().trim().min(1).max(100), text: z.string().max(4000),
  x: z.number().min(-10000).max(10000), y: z.number().min(-10000).max(10000),
  field: z.string().regex(/^[\p{L}\p{N}_]{0,50}$/u).default(''),
  outcome: z.enum(['neutral','interested','declined','follow_up']).default('neutral'),
  ports:flowPortsSchema.optional(),
}).strict();
export const flowGraphSchema = z.object({
  version: z.literal(1), revision: id, entry: id,
  nodes: z.array(flowNodeSchema).min(1).max(80),
  edges: z.array(z.object({id,source:id,target:id,branch:z.string().trim().min(1).max(40),condition:z.string().trim().max(300).default('')}).strict()).max(240),
  viewport: z.object({x:z.number(),y:z.number(),zoom:z.number().min(0.1).max(4)}).strict().optional(),
}).strict();
export type FlowGraph = z.infer<typeof flowGraphSchema>;

export function flowProblems(g: FlowGraph, recordedOpening=false): string[] {
  const problems: string[]=[];
  const ids=new Set(g.nodes.map(n=>n.id));
  if(ids.size!==g.nodes.length)problems.push('节点编号重复');
  if(new Set(g.edges.map(e=>e.id)).size!==g.edges.length)problems.push('连线编号重复');
  if(!ids.has(g.entry))problems.push('请选择开场节点');
  const entry=g.nodes.find(n=>n.id===g.entry);if(entry&&['end','handoff','jump'].includes(entry.kind))problems.push('开场必须是语音、文字、采集或按键节点');
  const seen=new Set<string>();
  for(const e of g.edges){
    if(!ids.has(e.source)||!ids.has(e.target))problems.push('存在连接到已删除节点的分支');
    const k=e.source+':'+e.branch;
    if(seen.has(k))problems.push('同一节点的同一分支只能连接一个目标');
    seen.add(k);
  }
  for(const n of g.nodes){
    if(!n.text.trim()&&n.kind!=='jump'&&!(recordedOpening&&n.id===g.entry))problems.push(`“${n.title}”尚未填写话术`);
    if(n.kind==='collect'&&!n.field)problems.push(`“${n.title}”尚未填写采集字段`);
    const outgoing=g.edges.filter(e=>e.source===n.id);
    if(['end','handoff'].includes(n.kind)&&outgoing.length)problems.push(`“${n.title}”是结束节点，不能继续连线`);
    if(!['end','handoff'].includes(n.kind)&&!outgoing.length)problems.push(`“${n.title}”尚未连接下一步`);
    if(n.kind==='jump'&&(outgoing.length!==1||outgoing[0]?.branch!=='全部'))problems.push(`“${n.title}”跳转节点只能连接一个“全部”分支`);
  }
  const reachable=new Set<string>();
  const visit=(n:string)=>{if(reachable.has(n))return;reachable.add(n);g.edges.filter(e=>e.source===n).forEach(e=>visit(e.target));};visit(g.entry);
  for(const n of g.nodes)if(!reachable.has(n.id))problems.push(`“${n.title}”无法从开场到达`);
  const ending=new Set(g.nodes.filter(n=>['end','handoff'].includes(n.kind)).map(n=>n.id));
  for(let i=0;i<g.nodes.length;i++)for(const e of g.edges)if(ending.has(e.target))ending.add(e.source);
  for(const n of g.nodes)if(!ending.has(n.id))problems.push(`“${n.title}”没有可到达的结束路径`);
  // Automatic jumps must never form a cycle without a customer turn.
  for(const n of g.nodes){let current=n;const chain=new Set<string>();while(current.kind==='jump'){
    if(chain.has(current.id)){problems.push('跳转节点存在自动循环');break;}chain.add(current.id);
    const next=g.nodes.find(v=>v.id===g.edges.find(e=>e.source===current.id)?.target);if(!next)break;current=next;
  }}
  return [...new Set(problems)];
}
export const publishedFlowSchema=flowGraphSchema.superRefine((g,ctx)=>{for(const message of flowProblems(g))ctx.addIssue({code:'custom',message});});
export function compileFlow(g:FlowGraph){
  return '【已发布可视化话术流程】\n版本：'+g.revision+'；入口：'+g.entry+'\n每次只执行当前节点；客户回应后按分支条件选择下一步，不能一次念完整个流程。中间节点的文字作为沟通目标和参考说法，理解后结合客户当前回答自然表达，不朗读操作说明、标题或分支标签。肯定、否定、中性、拒绝、未识别按当前问题的语义区分，没听清不猜测。只有客户明确要求不再联系才记录拒呼。\n'+g.nodes.map(n=>{
    const branches=g.edges.filter(e=>e.source===n.id).map(e=>`${e.branch}${e.condition?'（'+e.condition+'）':''} → ${e.target}`).join('；');
    return `节点 ${n.id}「${n.title}」类型=${n.kind}\n${n.id===g.entry||['end','handoff','ivr'].includes(n.kind)?'参考话术':'本步目标与参考说法'}：${n.text}${n.field?'\n采集字段：'+n.field:''}\n分支：${branches||'结束'}${n.outcome!=='neutral'?'\n结果意向：'+n.outcome:''}`;
  }).join('\n\n');
}
