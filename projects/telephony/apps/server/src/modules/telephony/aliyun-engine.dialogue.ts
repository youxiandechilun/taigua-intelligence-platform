/*
 * 中文导读：线路与语音外呼：aliyun-engine.dialogue.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import type { FlowGraph } from '../agent/agent.flow.js';
import { publishedFlowSchema } from '../agent/agent.flow.js';
import type { Row } from '../crm/crm.service.js';

type Message = { role: 'user' | 'assistant'; content: string };
const stateSchema = z.object({
  nodeId: z.string().max(100).default(''), steps: z.number().int().min(0).max(120).default(0),
  silent: z.number().int().min(0).max(2).default(0),
  optOutRequested: z.boolean().default(false), handoffRequested: z.boolean().default(false),
  flowTrace: z.array(z.object({ nodeId: z.string(), title: z.string(), branch: z.string(), timestamp: z.string() })).max(160).default([]),
  collected: z.record(z.string(), z.string().max(1000)).default({}), flowOutcome: z.string().default('neutral'),
  inputDigest: z.string().default(''), response: z.string().max(12000).default(''),
});
export type EngineDialogue = z.infer<typeof stateSchema>;
export function engineDialogue(raw: unknown, flow: unknown) {
  const graph = flow ? publishedFlowSchema.parse(flow) : null;
  const state = stateSchema.parse(raw || {});
  if (graph && !state.nodeId) state.nodeId = graph.entry;
  return { state, graph };
}

const plain = (text: string) => text.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim().slice(0, 1800);
const spoken = (text: string) => plain(text).replace(/&/g, '&amp;');
const comparable = (text: string) => plain(text).replace(/[\s\p{P}\p{S}]/gu, '');
function systemLine(runtime: Row, key: string, fallback: string) {
  const lang = String(runtime.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
  const value = runtime.systemSpeech?.[lang]?.[key];
  const clean = typeof value === 'string' ? plain(value) : '';
  return clean || fallback;
}
export function ending(text: string, forced = false, fallback = '好的，先不打扰您了，再见。') {
  const body = spoken(text) || spoken(fallback);
  return forced ? '<hangup-force>' + body + '</hangup-force>' : body + '<hangup/>';
}
export function engineEventReply(state: EngineDialogue, runtime: Row, messages: Message[], startedAt: Date) {
  if (state.optOutRequested) return ending(systemLine(runtime,'aliyunOptOut','好的，已记录不再联系，先不打扰您了，再见。'), true);
  if (Date.now() - startedAt.getTime() >= runtime.maxDurationSeconds * 1000) return ending(systemLine(runtime,'aliyunDurationEnd','今天先沟通到这里，感谢您的时间，再见。'));
  const last = messages.at(-1);
  if (last?.role === 'user' && /^\s*<silence\b[^>]*\/?>(?:\s*<\/silence>)?\s*$/i.test(last.content)) {
    state.silent = Math.min(2, state.silent + 1);
    return state.silent >= 2 ? ending(systemLine(runtime,'aliyunSilenceEnd','可能现在不方便，先不打扰您了，再见。')) : spoken(systemLine(runtime,'aliyunSilencePrompt','请问您还在听吗？'));
  }
  state.silent = 0;
  if (last?.role === 'user' && /^\s*<call-trigger-model\s*\/>\s*$/i.test(last.content)) {
    return messages.some(m => m.role === 'assistant' && plain(m.content)) ? spoken(systemLine(runtime,'aliyunContinue','我在听，您可以接着说。')) : spoken(runtime.opening);
  }
  return null;
}
export function engineMessages(messages: Message[]): Message[] {
  return messages.slice(-30).map(m => ({ ...m, content: plain(m.content.replace(/<\s*user-interrupt\s*\/>/gi, '（这句话被客户打断，未讲完）')) }));
}
export function engineDialogueInstructions(state: EngineDialogue, graph: FlowGraph | null) {
  const node = graph?.nodes.find(n => n.id === state.nodeId);
  const branches = graph?.edges.filter(e => e.source === state.nodeId).map(e => {
    let next=graph.nodes.find(n=>n.id===e.target);const seen=new Set<string>();
    while(next?.kind==='jump'&&!seen.has(next.id)){seen.add(next.id);const jump=graph.edges.find(edge=>edge.source===next!.id&&edge.branch==='全部');next=graph.nodes.find(n=>n.id===jump?.target);}
    return {branch:e.branch,condition:e.condition,next:next?{id:next.id,title:next.title,kind:next.kind,goal:next.text}:null};
  }) || [];
  return '\n【本次通话控制】\n每次只给下一句简短电话回答。开场已经由系统播报，不能重复自我介绍或已问过的问题。客户反问先回答，纠正先采纳，话未说完先听完。不知道答案时说明需人工核实，不因不知道就自行结束。不能输出XML、MSML或伪造工具结果。普通告别、拒绝继续沟通使用end_call；只有明确要求以后不要再联系才使用mark_do_not_call；要求人工或投诉使用request_handoff，安排人工跟进，不能声称已实时转接。调用工具时不再另外输出播报文本，结束语放入closing。' +
    (node ? '\n【流程当前位置】\n' + JSON.stringify({ node:{id:node.id,title:node.title,kind:node.kind,goal:node.text,field:node.field}, branches, collected: state.collected }) + '\n只有客户完整意思满足当前已配置分支时才调用advance_flow；response填写承接客户本轮回答、围绕所选分支下一步目标生成的一句自然回应或一个问题，不能照念目标说明、节点名称或后台操作。客户已说过的信息不重复追问。客户反问、换话题、纠正或意思不明时留在当前节点自然回应，不能强行推进，不重读节点。采集值必须原样来自客户明确给出的信息；拒绝、未知、跳过或结束分支不要求补齐采集值。优先结束与人工跟进不受流程限制。' : '');
}
export function engineDialogueTools(graph: FlowGraph | null, state: EngineDialogue) {
  const closing = { type: 'object', properties: { closing: { type: 'string', maxLength: 300, description: '一句简短礼貌结束语，不能声称实时转接成功' } }, required: ['closing'], additionalProperties: false };
  const tools: Row[] = [
    { type: 'function', function: { name: 'end_call', description: '客户普通告别或不想继续本次沟通，礼貌结束当前电话，不登记拒呼', parameters: closing } },
    { type: 'function', function: { name: 'mark_do_not_call', description: '客户明确要求以后不再联系时登记拒呼并结束', parameters: closing } },
    { type: 'function', function: { name: 'request_handoff', description: '客户要求人工或投诉，登记人工跟进并礼貌结束，尚未实时转接', parameters: closing } },
  ];
  const branches = graph?.edges.filter(e => e.source === state.nodeId).map(e => e.branch) || [];
  if (branches.length) tools.push({ type: 'function', function: { name: 'advance_flow', description: '根据客户已完整表达的意思前进到已配置分支，并给出围绕下一步目标的自然电话回应；不能跳过连线或照念操作要求', parameters: { type: 'object', properties: { branch: { type: 'string', enum: branches }, value: { type: 'string', maxLength: 1000 },response:{type:'string',maxLength:1800,description:'承接客户刚才的话，围绕目标节点生成简短口语；一次只问一个问题，不朗读节点操作说明'} }, required: ['branch','response'], additionalProperties: false } } });
  return tools;
}
function advance(state: EngineDialogue, graph: FlowGraph, branch: string, value: string, response:string, messages: Message[], runtime: Row) {
  if (state.steps >= 120) return ending(systemLine(runtime,'aliyunFlowLimit','今天先沟通到这里，后续请同事跟进，感谢您的时间，再见。'));
  const old = graph.nodes.find(n => n.id === state.nodeId);
  let next = graph.nodes.find(n => n.id === graph.edges.find(e => e.source === state.nodeId && e.branch === branch)?.target);
  if (!old || !next) return spoken(systemLine(runtime,'aliyunContinue','我在听，您可以接着说。'));
  const visited = new Set<string>();
  while (next.kind === 'jump') {
    if (visited.has(next.id)) return ending(systemLine(runtime,'aliyunFlowError','这个问题需要同事确认，今天先不打扰您了，再见。'));
    visited.add(next.id);
    const edge = graph.edges.find(e => e.source === next!.id && e.branch === '全部');
    const target = graph.nodes.find(n => n.id === edge?.target);
    if (!target) return ending(systemLine(runtime,'aliyunFlowError','这个问题需要同事确认，今天先不打扰您了，再见。'));
    next = target;
  }
  // The target text may be an internal goal, not a sentence to play aloud.
  // Invalid model output must leave the flow in place rather than reading it.
  const reply=spoken(response);
  if(!['end','handoff','ivr'].includes(next.kind)&&!reply)return spoken(systemLine(runtime,'aliyunNoReply','嗯，您接着说。'));
  const exiting = ['否定', '拒绝', '未识别', '中性', '未知', '不知道', '不清楚', '不愿回答', '跳过'].includes(branch) || ['end', 'handoff'].includes(next.kind);
  const evidence = comparable(value);
  const explicit = !!evidence && messages.some(m => m.role === 'user' && comparable(m.content).includes(evidence));
  if (old.kind === 'collect' && !exiting && !explicit) return spoken(systemLine(runtime,'aliyunUnclear','刚才的信息我还没有听清，您可以接着说。'));
  if (old.kind === 'collect' && old.field && explicit) state.collected = { ...state.collected, [old.field]: value.trim() };
  state.nodeId = next.id;
  state.steps++;
  if (state.flowTrace.length < 160) state.flowTrace.push({ nodeId: next.id, title: next.title, branch, timestamp: new Date().toISOString() });
  if (next.outcome) state.flowOutcome = next.outcome;
  if (next.kind === 'handoff') {
    state.handoffRequested = true;
    return ending(systemLine(runtime,'aliyunHandoff','已记录您的人工跟进需求，会请同事联系您。感谢您的时间，再见。'));
  }
  return next.kind === 'end' ? ending(next.text,false,systemLine(runtime,'aliyunDefaultEnd','好的，先不打扰您了，再见。')) : next.kind==='ivr'?spoken(next.text):reply;
}
export function engineModelReply(state: EngineDialogue, graph: FlowGraph | null, message: Row, messages: Message[], opening: string, runtime: Row = {}) {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (calls.length) {
    // At most one business transition is allowed for each complete customer turn.
    const call = calls.find(c => c.function?.name === 'mark_do_not_call') || calls[0];
    let args: unknown;
    try { args = JSON.parse(call.function?.arguments || '{}'); } catch { return spoken(systemLine(runtime,'aliyunContinue','我在听，您可以接着说。')); }
    const name = call.function?.name;
    if (['end_call', 'mark_do_not_call', 'request_handoff'].includes(name)) {
      const parsed = z.object({ closing: z.string().max(300) }).strict().safeParse(args);
      if (!parsed.success) return spoken(systemLine(runtime,'aliyunContinue','我在听，您可以接着说。'));
      if (name === 'mark_do_not_call') {
        state.optOutRequested = true;
        return ending(systemLine(runtime,'aliyunOptOut','好的，已记录不再联系，先不打扰您了，再见。'), true);
      }
      if (name === 'request_handoff') {
        state.handoffRequested = true;
        return ending(systemLine(runtime,'aliyunHandoff','已记录您的人工跟进需求，会请同事联系您。感谢您的时间，再见。'));
      }
      return ending(parsed.data.closing,false,systemLine(runtime,'aliyunDefaultEnd','好的，先不打扰您了，再见。'));
    }
    if (name === 'advance_flow' && graph) {
      const parsed = z.object({ branch: z.string().max(40), value: z.string().max(1000).default(''),response:z.string().max(1800).default('') }).strict().safeParse(args);
      if (parsed.success) return advance(state, graph, parsed.data.branch, parsed.data.value, parsed.data.response, messages, runtime);
    }
    return spoken(systemLine(runtime,'aliyunContinue','我在听，您可以接着说。'));
  }
  const text = typeof message.content === 'string' ? spoken(message.content) : '';
  const normalized = comparable(text);
  if (!normalized || normalized.length >= 8 && (normalized === comparable(opening) || messages.some(m => m.role === 'assistant' && comparable(m.content) === normalized))) return spoken(systemLine(runtime,'aliyunContinue','我在听，您可以接着说。'));
  return text;
}
