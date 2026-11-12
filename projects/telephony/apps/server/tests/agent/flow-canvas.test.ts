/*
 * 中文导读：既有验证代码：flow-canvas.test 的输入、输出及边界场景。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeFlowPorts,deleteFlowNode,draftFlowProblem,flowContent,inspectFlow,previewBranch,putBranch,repairFlowInputPorts} from '../../../console/src/components/agents/studio/flow-model.js';
import {rememberFlow,travelFlow,type FlowHistory} from '../../../console/src/components/agents/studio/flow-history.js';
import type {FlowGraph,FlowNode} from '../../../console/src/lib/api/resources/playbook.js';
import {publishedFlowSchema} from '../../src/modules/agent/agent.flow.js';

const node=(id:string,kind:FlowNode['kind']):FlowNode=>({id,kind,title:id,text:kind==='jump'?'':'测试话术',field:kind==='collect'?'需求':'',outcome:kind==='handoff'?'follow_up':'neutral',x:0,y:0});
function fixture():FlowGraph{
 return {version:1,revision:'draft-1',entry:'speech',nodes:['speech','collect','text','ivr','jump','end','handoff'].map(kind=>node(kind,kind as FlowNode['kind'])),edges:[
  {id:'sc',source:'speech',branch:'肯定',target:'collect',condition:''},
  {id:'sh',source:'speech',branch:'拒绝',target:'handoff',condition:''},
  {id:'ct',source:'collect',branch:'肯定',target:'text',condition:''},
  {id:'ti',source:'text',branch:'全部',target:'ivr',condition:''},
  {id:'ij',source:'ivr',branch:'1',target:'jump',condition:''},
  {id:'ih',source:'ivr',branch:'2',target:'handoff',condition:''},
  {id:'je',source:'jump',branch:'全部',target:'end',condition:''},
 ]};
}
const errors=(graph:FlowGraph)=>inspectFlow(graph).filter(issue=>issue.severity==='error');

test('all seven node types form a publishable graph accepted by the server',()=>{
 const graph=fixture();assert.deepEqual(errors(graph),[]);assert.equal(publishedFlowSchema.safeParse(graph).success,true);
 assert.ok(inspectFlow(graph).some(issue=>issue.severity==='warning'&&issue.nodeId==='ivr'));
});
test('draft can be incomplete but invalid names and collection keys are actionable before saving',()=>{
 const graph=fixture();graph.nodes[0]!.text='';assert.equal(draftFlowProblem(graph),undefined);assert.ok(errors(graph).length);
 graph.nodes[0]!.title='';assert.ok(draftFlowProblem(graph)?.includes('节点名称'));
 graph.nodes[0]!.title='开场';graph.nodes[1]!.field='需求、时间';assert.ok(draftFlowProblem(graph)?.includes('采集字段'));
});
test('preview follows selected branches and automatic jumps without altering the draft',()=>{
 const graph=fixture(),before=JSON.stringify(graph);
 assert.equal(previewBranch(graph,'speech','肯定').nodeId,'collect');
 assert.equal(previewBranch(graph,'collect','肯定').nodeId,'text');
 assert.equal(previewBranch(graph,'text','全部').nodeId,'ivr');
 assert.deepEqual(previewBranch(graph,'ivr','1'),{nodeId:'end',via:['jump']});
 assert.equal(previewBranch(graph,'ivr','2').nodeId,'handoff');
 assert.equal(previewBranch(graph,'ivr','9').nodeId,'ivr');
 assert.ok(previewBranch(graph,'ivr','9').error);assert.equal(JSON.stringify(graph),before);
});
test('automatic jump cycles cannot be published or freeze preview',()=>{
 const graph=fixture();graph.edges.find(e=>e.id==='je')!.target='jump';
 assert.ok(errors(graph).some(issue=>issue.message.includes('自动跳转循环')));
 assert.equal(publishedFlowSchema.safeParse(graph).success,false);
 assert.ok(previewBranch(graph,'ivr','1').error?.includes('循环'));
});
test('unreachable nodes, missing next steps and empty collection fields are located',()=>{
 const graph=fixture();graph.nodes.push(node('orphan','speech'));graph.nodes.find(n=>n.id==='collect')!.field='';
 assert.ok(errors(graph).some(issue=>issue.nodeId==='orphan'&&issue.message.includes('无法从开场到达')));
 assert.ok(errors(graph).some(issue=>issue.nodeId==='orphan'&&issue.message.includes('尚未连接下一步')));
 assert.ok(errors(graph).some(issue=>issue.nodeId==='collect'&&issue.message.includes('采集字段')));
 assert.equal(publishedFlowSchema.safeParse(graph).success,false);
});
test('invalid IVR keys, duplicate branches, and terminal outgoing edges block publishing',()=>{
 const graph=fixture();graph.edges.push({id:'bad-key',source:'ivr',branch:'再说一次',target:'end',condition:''},{id:'dup',source:'speech',branch:'肯定',target:'end',condition:''},{id:'bad-end',source:'end',branch:'全部',target:'end',condition:''});
 const found=errors(graph);assert.ok(found.some(issue=>issue.edgeId==='bad-key'));assert.ok(found.some(issue=>issue.edgeId==='dup'));assert.ok(found.some(issue=>issue.nodeId==='end'));
});
test('reconnecting one branch preserves its id, condition and every other branch',()=>{
 const graph=fixture(),original=graph.edges[0]!;
 const changed=putBranch(graph,{...original,target:'end'});
 assert.equal(changed.edges.length,graph.edges.length);assert.equal(changed.edges.find(e=>e.id===original.id)?.target,'end');
 assert.deepEqual(changed.edges.filter(e=>e.id!==original.id),graph.edges.filter(e=>e.id!==original.id));
 assert.equal(graph.edges[0]!.target,'collect');
});
test('node deletion clears all attached edges and chooses an eligible replacement opening',()=>{
 const graph=fixture(),before=JSON.stringify(graph),changed=deleteFlowNode(graph,'speech');
 assert.equal(changed.entry,'collect');assert.ok(changed.edges.every(e=>e.source!=='speech'&&e.target!=='speech'));
 assert.equal(JSON.stringify(graph),before);
 const single={...graph,nodes:[graph.nodes[0]!],edges:[]};assert.equal(deleteFlowNode(single,'speech'),single);
});
test('legacy canvas ports are repaired from the saved graph geometry',()=>{
 const graph=fixture();graph.nodes.find(n=>n.id==='speech')!.x=0;graph.nodes.find(n=>n.id==='collect')!.x=400;graph.nodes.find(n=>n.id==='collect')!.ports={input:{side:'top',offset:0.5},outputs:{}};
 const repaired=repairFlowInputPorts(graph);
 assert.equal(repaired.nodes.find(n=>n.id==='collect')!.ports?.input?.side,'left');
 assert.notEqual(repaired,graph);
 const arranged=arrangeFlowPorts(repaired);assert.ok(arranged.nodes.every(n=>n.ports?.input));
});
test('undo and redo recover deleted content while retaining the current view',()=>{
 const graph=fixture(),changed={...deleteFlowNode(graph,'collect'),viewport:{x:120,y:40,zoom:0.7}};
 const history=rememberFlow({past:[],future:[]},graph),undo=travelFlow(history,changed,'undo')!;
 assert.equal(undo.graph.nodes.length,graph.nodes.length);assert.deepEqual(undo.graph.viewport,changed.viewport);
 const redo=travelFlow(undo.history,undo.graph,'redo')!;assert.deepEqual(redo.graph,changed);
 const fork=rememberFlow(undo.history,undo.graph);assert.equal(fork.future.length,0);
});
test('history retains forty snapshots and publishing comparison ignores layout only',()=>{
 const graph=fixture();let history:FlowHistory={past:[],future:[]};for(let i=0;i<55;i++)history=rememberFlow(history,{...graph,revision:'draft-'+i});
 assert.equal(history.past.length,40);assert.equal(travelFlow({past:[],future:[]},graph,'undo'),null);
 const moved={...graph,revision:'published-2',viewport:{x:10,y:30,zoom:0.5},nodes:graph.nodes.map(n=>({...n,x:999,y:888}))};
 assert.equal(flowContent(moved),flowContent(graph));moved.nodes[0]!.text='修改的话术';assert.notEqual(flowContent(moved),flowContent(graph));
});
