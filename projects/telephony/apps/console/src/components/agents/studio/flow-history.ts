/*
 * 中文导读：数字员工与话术的 flow-history 组件，封装该界面的展示与交互。
 */
import type {FlowGraph} from '@/src/lib/api/resources/playbook';

export type FlowHistory={past:FlowGraph[];future:FlowGraph[]};
export function rememberFlow(history:FlowHistory,current:FlowGraph):FlowHistory{
 return {past:[...history.past.slice(-39),current],future:[]};
}
export function travelFlow(history:FlowHistory,current:FlowGraph,direction:'undo'|'redo'):{graph:FlowGraph;history:FlowHistory}|null{
 if(direction==='undo'){
  const previous=history.past.at(-1);if(!previous)return null;
  return {graph:{...previous,viewport:current.viewport},history:{past:history.past.slice(0,-1),future:[current,...history.future]}};
 }
 const next=history.future[0];if(!next)return null;
 return {graph:{...next,viewport:current.viewport},history:{past:[...history.past.slice(-39),current],future:history.future.slice(1)}};
}
