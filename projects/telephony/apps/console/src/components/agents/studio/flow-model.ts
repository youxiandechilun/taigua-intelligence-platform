/*
 * 中文导读：数字员工与话术的 flow-model 组件，封装该界面的展示与交互。
 */
import type {ConversationPlaybook,FlowEdge,FlowGraph,FlowNode,FlowPortPosition} from "@/src/lib/api/resources/playbook";

export const nodeTitles:Record<FlowNode['kind'],string>={speech:'语音节点',collect:'采集节点',text:'文字节点',ivr:'按键节点',jump:'跳转节点',end:'结束节点',handoff:'人工跟进'};
export const nodeDescriptions:Record<FlowNode['kind'],string>={
 speech:'用自然口语表达话术，根据客户回应选择分支。',
 collect:'询问并记录客户明确提供的信息，再进入下一步。',
 text:'设置本步骤的文字要求，模型表达后根据“全部”分支继续。',
 ivr:'播报按键提示，客户在电话上按键后进入对应分支。',
 jump:'不播报话术，直接跳转到连接的下一节点。',
 end:'播报结束语，记录通话结果并结束电话。',
 handoff:'登记人工跟进意向，播报结束语并结束电话。',
};
export function defaultBranches(kind:FlowNode['kind']):string[]{
 return kind==='ivr'?['1','2','3','未识别']:['jump','text'].includes(kind)?['全部']:['end','handoff'].includes(kind)?[]:['肯定','否定','拒绝','未识别','中性'];
}
export function flowBranches(node:FlowNode,graph:FlowGraph){
 return [...new Set([...defaultBranches(node.kind),...graph.edges.filter(e=>e.source===node.id).map(e=>e.branch)])];
}

export type ResolvedFlowPort={key:string;branch:string|null;position:FlowPortPosition};
// Both the visible branch names and React Flow handles use these positions.
// Old layouts assigned only connected branches, which could collide with the
// default positions of unconnected branches. Spread only crowded neighbours.
export function resolveFlowPorts(node:FlowNode,branches:string[]):ResolvedFlowPort[]{
 const ports:ResolvedFlowPort[]=[
  {key:'input',branch:null,position:{...(node.ports?.input??{side:'top',offset:0.5})}},
  ...branches.map((branch,index)=>({key:'output:'+branch,branch,position:{...(node.ports?.outputs?.[branch]??{side:'bottom' as const,offset:(index+0.5)/branches.length})}})),
 ];
 for(const side of ['top','right','bottom','left'] as const){
  const group=ports.filter(port=>port.position.side===side).sort((a,b)=>a.position.offset-b.position.offset);
  const margin=0.09,gap=group.length>1?Math.min(side==='top'||side==='bottom'?0.18:0.15,(1-2*margin)/(group.length-1)):0;
  for(const port of group)port.position.offset=Math.max(margin,Math.min(1-margin,port.position.offset));
  for(let i=1;i<group.length;i++)group[i]!.position.offset=Math.max(group[i]!.position.offset,group[i-1]!.position.offset+gap);
  if(group.length&&group.at(-1)!.position.offset>1-margin){
   group.at(-1)!.position.offset=1-margin;
   for(let i=group.length-2;i>=0;i--)group[i]!.position.offset=Math.min(group[i]!.position.offset,group[i+1]!.position.offset-gap);
  }
 }
 return ports;
}

type FlowPortSide=FlowPortPosition["side"];
const oppositeFlowSide=(side:FlowPortSide):FlowPortSide=>side==='top'?'bottom':side==='right'?'left':side==='bottom'?'top':'right';
function flowSide(from:{x:number;y:number},to:{x:number;y:number}):FlowPortSide{
 const dx=to.x-from.x,dy=to.y-from.y;
 if(Math.abs(dx)>Math.abs(dy)*1.1)return dx>=0?'right':'left';
 return dy>=0?'bottom':'top';
}
function flowOutputPorts(graph:FlowGraph):Map<string,NonNullable<FlowNode['ports']>>{
 const byId=new Map(graph.nodes.map(node=>[node.id,node])),outgoing=new Map<string,FlowEdge[]>(),inputs=new Map<string,FlowEdge[]>();
 for(const edge of graph.edges){outgoing.set(edge.source,[...(outgoing.get(edge.source)||[]),edge]);inputs.set(edge.target,[...(inputs.get(edge.target)||[]),edge]);}
 const result=new Map<string,NonNullable<FlowNode['ports']>>();
 for(const node of graph.nodes){
  const source=byId.get(node.id)||node;
  const incoming=inputs.get(node.id)||[];
  const firstSource=incoming.map(edge=>byId.get(edge.source)).find(Boolean);
  const inputSide=firstSource?oppositeFlowSide(flowSide(firstSource,source)):(node.ports?.input?.side||'top');
  const input:FlowPortPosition={side:inputSide,offset:node.ports?.input?.offset??0.5};
  const groups=new Map<FlowPortSide,string[]>();
  for(const branch of flowBranches(node,graph)){
   const edge=outgoing.get(node.id)?.find(edge=>edge.branch===branch),target=edge?byId.get(edge.target):undefined;
   const side=target?flowSide(source,target):'bottom',group=groups.get(side);if(group)group.push(branch);else groups.set(side,[branch]);
  }
  const outputs:NonNullable<FlowNode['ports']>['outputs']={};
  for(const [side,group] of groups){group.forEach((branch,index)=>{outputs[branch]={side,offset:(index+0.5)/group.length};});}
  result.set(node.id,{input,outputs});
 }
 return result;
}
/**
 * Rebuild ports for an automatic layout. This is deliberately based on the
 * final node positions, so an older browser worker or an older saved graph
 * cannot leave an input handle on the wrong side of its card.
 */
export function arrangeFlowPorts(graph:FlowGraph):FlowGraph{
 const ports=flowOutputPorts(graph);
 return {...graph,nodes:graph.nodes.map(node=>({...node,ports:ports.get(node.id)}))};
}
/**
 * Infer missing legacy input handles for display. Explicitly placed handles
 * belong to the user and must never be repositioned when opening a draft.
 */
export function repairFlowInputPorts(graph:FlowGraph):FlowGraph{
 const byId=new Map(graph.nodes.map(node=>[node.id,node])),incoming=new Map<string,FlowEdge[]>();
 for(const edge of graph.edges)incoming.set(edge.target,[...(incoming.get(edge.target)||[]),edge]);
 let changed=false;
 const nodes=graph.nodes.map(node=>{
  const edge=incoming.get(node.id)?.[0],source=edge?byId.get(edge.source):undefined;
  if(!source)return node;
  const side=oppositeFlowSide(flowSide(source,node)),input=node.ports?.input;
  if(input)return node;
  changed=true;
  return {...node,ports:{...node.ports,input:{side,offset:0.5}}};
 });
 return changed?{...graph,nodes}:graph;
}
export function flowContent(graph:FlowGraph|null|undefined){
 if(!graph)return '';
 return JSON.stringify({entry:graph.entry,nodes:graph.nodes.map(({x:_x,y:_y,ports:_ports,...node})=>node),edges:graph.edges.map(({id:_id,...edge})=>edge)});
}
export function putBranch(graph:FlowGraph,edge:FlowEdge):FlowGraph{
 return {...graph,edges:[...graph.edges.filter(e=>e.id!==edge.id&&!(e.source===edge.source&&e.branch===edge.branch)),edge]};
}
export function deleteFlowNode(graph:FlowGraph,id:string):FlowGraph{
 if(graph.nodes.length<=1)return graph;
 const nodes=graph.nodes.filter(n=>n.id!==id);
 return {...graph,entry:graph.entry===id?(nodes.find(n=>!['end','handoff','jump'].includes(n.kind))?.id||nodes[0]!.id):graph.entry,nodes,edges:graph.edges.filter(e=>e.source!==id&&e.target!==id)};
}
// The simple editor keeps the surrounding conversation connected when a step is removed.
export function deleteConversationStep(graph:FlowGraph,id:string):FlowGraph{
 if(id===graph.entry||!graph.nodes.some(node=>node.id===id))return graph;
 const outgoing=graph.edges.filter(edge=>edge.source===id&&edge.target!==id);
 const next=outgoing.find(edge=>edge.branch==='全部')||outgoing.find(edge=>edge.branch==='肯定')||outgoing[0];
 const edges=graph.edges.flatMap(edge=>{
  if(edge.source===id)return [];
  if(edge.target!==id)return [edge];
  return next&&next.target!==edge.source?[{...edge,target:next.target}]:[];
 });
 return {...graph,nodes:graph.nodes.filter(node=>node.id!==id),edges};
}
export type FlowIssue={severity:'error'|'warning';message:string;nodeId?:string;edgeId?:string};
export function draftFlowProblem(graph:FlowGraph):string|undefined{
 if(!graph.nodes.length||graph.nodes.length>80||graph.edges.length>240)return '话术最多 80 个步骤、240 个回应分支。';
 for(const node of graph.nodes){
  if(!node.title.trim())return '请填写场景名称后保存草稿。';
  if(!/^[\p{L}\p{N}_]{0,50}$/u.test(node.field))return `“${node.title}”的采集字段只能包含文字、数字和下划线。`;
 }
 for(const edge of graph.edges)if(!edge.branch.trim())return '请填写回应分支名称后保存草稿。';
}
export function inspectFlow(graph:FlowGraph,recordedOpening=false):FlowIssue[]{
 const issues:FlowIssue[]=[],nodes=new Map(graph.nodes.map(n=>[n.id,n])),outgoing=new Map<string,FlowEdge[]>();
 const add=(message:string,nodeId?:string,severity:FlowIssue['severity']='error',edgeId?:string)=>issues.push({message,nodeId,severity,edgeId});
 if(graph.nodes.length<1||graph.nodes.length>80)add('流程需要 1 至 80 个节点');
 if(graph.edges.length>240)add('连线最多 240 条');
 if(nodes.size!==graph.nodes.length)add('节点编号重复');
 if(new Set(graph.edges.map(e=>e.id)).size!==graph.edges.length)add('连线编号重复');
 const entry=nodes.get(graph.entry);
 if(!entry)add('请选择开场节点');
 else if(['end','handoff','jump'].includes(entry.kind))add('开场必须是语音、文字、采集或按键节点',entry.id);
 const seen=new Set<string>();
 for(const edge of graph.edges){
  if(!nodes.has(edge.source)||!nodes.has(edge.target))add('连线连接到了不存在的节点',edge.source,'error',edge.id);
  const key=JSON.stringify([edge.source,edge.branch]);
  if(seen.has(key))add('同一分支只能连接一个目标',edge.source,'error',edge.id);
  seen.add(key);
  if(!edge.branch.trim()||edge.branch.length>40)add('分支名称需填写，且不超过 40 个字',edge.source,'error',edge.id);
  if(edge.condition.length>300)add('分支条件不能超过 300 个字',edge.source,'error',edge.id);
  const from=nodes.get(edge.source);
  if(from?.kind==='ivr'&&!/^([0-9*#]|未识别)$/.test(edge.branch))add('按键分支只能使用单个 0–9、*、# 或“未识别”',edge.source,'error',edge.id);
  outgoing.set(edge.source,[...(outgoing.get(edge.source)||[]),edge]);
 }
 for(const node of graph.nodes){
  const name=`“${node.title||nodeTitles[node.kind]}”`;
  if(!node.title.trim()||node.title.trim().length>100)add(`${name}的节点名称需填写，且不超过 100 个字`,node.id);
  if(node.kind!=='jump'&&!(recordedOpening&&node.id===graph.entry)&&!node.text.trim())add(`${name}尚未填写话术`,node.id);
  if(node.text.length>4000)add(`${name}的话术不能超过 4000 个字`,node.id);
  if(!/^[\p{L}\p{N}_]{0,50}$/u.test(node.field))add(`${name}的采集字段只能使用文字、数字和下划线，最多 50 个字`,node.id);
  if(node.kind==='collect'&&!node.field.trim())add(`${name}尚未填写采集字段`,node.id);
  const edges=outgoing.get(node.id)||[];
  if(['end','handoff'].includes(node.kind)&&edges.length)add(`${name}不能继续连线`,node.id);
  else if(!['end','handoff'].includes(node.kind)&&!edges.length)add(`${name}尚未连接下一步`,node.id);
  if(['jump','text'].includes(node.kind)&&(edges.length!==1||edges[0]?.branch!=='全部'))add(`${name}只能连接一个“全部”分支`,node.id);
  if(['speech','collect','ivr'].includes(node.kind)&&!edges.some(e=>e.branch==='未识别'))add(`${name}未设置“未识别”分支，没听清时将留在当前节点`,node.id,'warning');
 }
 const reachable=new Set<string>(),queue=entry?[entry.id]:[];
 for(let i=0;i<queue.length;i++){const id=queue[i]!;if(reachable.has(id))continue;reachable.add(id);for(const edge of outgoing.get(id)||[])if(nodes.has(edge.target))queue.push(edge.target);}
 for(const node of graph.nodes)if(!reachable.has(node.id))add(`“${node.title}”无法从开场到达`,node.id);
 const ending=new Set(graph.nodes.filter(n=>['end','handoff'].includes(n.kind)).map(n=>n.id));
 for(let i=0;i<graph.nodes.length;i++)for(const edge of graph.edges)if(ending.has(edge.target))ending.add(edge.source);
 for(const node of graph.nodes)if(!ending.has(node.id))add(`“${node.title}”没有可到达的结束路径`,node.id);
 for(const node of graph.nodes){let current:FlowNode|undefined=node;const chain=new Set<string>();while(current?.kind==='jump'){
  if(chain.has(current.id)){add(`“${node.title}”存在自动跳转循环`,node.id);break;}
  chain.add(current.id);current=nodes.get((outgoing.get(current.id)||[]).find(e=>e.branch==='全部')?.target||'');
 }}
 return issues;
}
export type PreviewStep={nodeId:string;via:string[];error?:string};
// Use the same explicit branch choice and automatic jump rules as the call engine.
export function previewBranch(graph:FlowGraph,nodeId:string,branch:string):PreviewStep{
 const edge=graph.edges.find(e=>e.source===nodeId&&e.branch===branch),via:string[]=[];
 if(!edge)return {nodeId,via,error:'这个分支尚未连接，流程留在当前节点。'};
 let next=graph.nodes.find(n=>n.id===edge.target);const seen=new Set<string>();
 while(next?.kind==='jump'){
  if(seen.has(next.id))return {nodeId,via,error:'跳转形成循环，请先修改连线。'};
  seen.add(next.id);via.push(next.title);const jump=graph.edges.find(e=>e.source===next!.id&&e.branch==='全部');next=graph.nodes.find(n=>n.id===jump?.target);
 }
 return next?{nodeId:next.id,via}:{nodeId,via,error:'下一节点不存在或跳转未连接，请先修改连线。'};
}
export function seedCanvas(p:ConversationPlaybook):FlowGraph{
 const nodes:FlowNode[]=[{id:'opening',kind:'speech',title:'开场白',text:p.opening,x:350,y:40,field:'',outcome:'neutral'},...p.flow.map((n,i)=>({id:'step-'+n.id,kind:'speech' as const,title:n.title,text:n.instruction,x:350+(i%2)*390,y:310+Math.floor(i/2)*300,field:'',outcome:'neutral' as const})),{id:'success',kind:'end',title:'成功结束',text:'感谢您的时间，后续由同事按您同意的方式跟进，再见。',x:830,y:40,field:'',outcome:'interested'},{id:'declined',kind:'end',title:'礼貌结束',text:'好的，了解了，先不打扰您。感谢接听，再见。',x:-60,y:310,field:'',outcome:'declined'}];
 const main=nodes.filter(n=>n.kind==='speech');
 return {version:1,revision:crypto.randomUUID(),entry:'opening',nodes,edges:main.flatMap((n,i)=>[{id:'yes-'+n.id,source:n.id,target:main[i+1]?.id||'success',branch:'肯定',condition:''},{id:'refuse-'+n.id,source:n.id,target:'declined',branch:'拒绝',condition:'客户明确拒绝继续沟通'}])};
}

// The graph owns opening and steps. The legacy fields are compatibility mirrors,
// while the original text remains available as a read-only backup.
export function syncScript(p:ConversationPlaybook):ConversationPlaybook{
 if(p.scriptMode!=='canvas'||!p.canvas)return p;
 return {...p,opening:p.canvas.nodes.find(n=>n.id===p.canvas!.entry)?.text??'',flow:p.canvas.nodes.filter(n=>n.id!==p.canvas!.entry).map(n=>({id:n.id,title:n.title,instruction:n.text}))};
}
export function unifiedScript(p:ConversationPlaybook):ConversationPlaybook{
 const canvas=p.canvas||p.publishedFlow||seedCanvas(p);
 return syncScript({...p,scriptMode:'canvas',canvas,...(!p.scriptMode&&!p.legacyScript?{legacyScript:{opening:p.opening,flow:p.flow.map(n=>({...n}))}}:{})});
}
export function patchScript(p:ConversationPlaybook,changes:Partial<ConversationPlaybook>):ConversationPlaybook{
 let canvas=changes.canvas||p.canvas;
 if(p.scriptMode==='canvas'&&canvas&&changes.opening!==undefined&&!changes.canvas){
  canvas={...canvas,nodes:canvas.nodes.map(n=>n.id===canvas!.entry?{...n,text:changes.opening!}:n)};
 }
 return syncScript({...p,...changes,...(canvas?{canvas}:{})});
}
export function scriptOpening(p:ConversationPlaybook){
 const graph=p.scriptMode==='canvas'?p.canvas:p.publishedFlow;
 return graph?graph.nodes.find(n=>n.id===graph.entry)?.text??'':p.opening;
}
export function flowText(graph:FlowGraph){
 const titles=new Map(graph.nodes.map(n=>[n.id,n.title]));
 return graph.nodes.map(n=>[
  `【${n.title}${n.id===graph.entry?' · 开场':''}】`,
  `类型：${nodeTitles[n.kind]}`,n.text||'（未填写话术）',
  n.field?`采集：${n.field}`:'',
  ...graph.edges.filter(e=>e.source===n.id).map(e=>`${e.branch}${e.condition?`（${e.condition}）`:''} → ${titles.get(e.target)||'目标已删除'}`),
  ['end','handoff'].includes(n.kind)?`结果：${({neutral:'未判定',interested:'有意向',declined:'拒绝沟通',follow_up:'需要跟进'})[n.outcome]}`:'',
 ].filter(Boolean).join('\n')).join('\n\n');
}
