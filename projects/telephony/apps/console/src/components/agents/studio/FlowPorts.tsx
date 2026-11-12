/*
 * 中文导读：数字员工与话术的 FlowPorts 组件，封装该界面的展示与交互。
 */
"use client";

import {createContext,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type PointerEvent,type ReactNode} from 'react';
import {Handle,Position,useUpdateNodeInternals} from '@xyflow/react';
import type {FlowNode,FlowPortPosition} from '@/src/lib/api/resources/playbook';
import {resolveFlowPorts} from './flow-model';
import styles from './flow-canvas.module.css';

export type PortChange=(id:string,branch:string|null,position:FlowPortPosition)=>void;
const PortContext=createContext<{adjusting:boolean;onChange:PortChange}>({adjusting:false,onChange:()=>{}});
export function FlowPortControls({adjusting,onChange,children}:{adjusting:boolean;onChange:PortChange;children:ReactNode}){
 const value=useMemo(()=>({adjusting,onChange}),[adjusting,onChange]);
 return <PortContext.Provider value={value}>{children}</PortContext.Provider>;
}
const sides={top:Position.Top,right:Position.Right,bottom:Position.Bottom,left:Position.Left};
function placement(position:FlowPortPosition):CSSProperties{
 const offset=`${position.offset*100}%`;
 return {left:position.side==='left'?0:position.side==='right'?'100%':offset,top:position.side==='top'?0:position.side==='bottom'?'100%':offset,right:'auto',bottom:'auto',transform:'translate(-50%, -50%)'};
}
function nearest(x:number,y:number,width:number,height:number):FlowPortPosition{
 x=Math.max(0,Math.min(width,x));y=Math.max(0,Math.min(height,y));
 const closest=([{side:'top',distance:y,offset:x/width},{side:'right',distance:width-x,offset:y/height},{side:'bottom',distance:height-y,offset:x/width},{side:'left',distance:x,offset:y/height}] as const).reduce((a,b)=>b.distance<a.distance?b:a);
 const margin=18/(closest.side==='top'||closest.side==='bottom'?width:height);
 return {side:closest.side,offset:Math.round(Math.max(margin,Math.min(1-margin,closest.offset))*10000)/10000};
}
function nudge(position:FlowPortPosition,forward:boolean):FlowPortPosition{
 const order=['top','right','bottom','left'] as const,index=order.indexOf(position.side),reverse=index>=2;
 let offset=position.offset+(forward!==reverse?0.04:-0.04),side=position.side;
 if(offset>0.96||offset<0.04){const next=(index+(forward?1:3))%4;side=order[next]!;offset=next>=2?(forward?0.96:0.04):(forward?0.04:0.96);}
 return {side,offset:Math.round(offset*10000)/10000};
}

export function FlowPorts({node,branches,canEdit}:{node:FlowNode;branches:string[];canEdit:boolean}){
 const {adjusting,onChange}=useContext(PortContext),update=useUpdateNodeInternals();
 const [temporary,setTemporary]=useState<{key:string;position:FlowPortPosition}|null>(null);
 const drag=useRef<{key:string;branch:string|null;rect:DOMRect;position:FlowPortPosition;pointer:number}|null>(null),frame=useRef<number|null>(null);
 const active=adjusting&&canEdit;
 useLayoutEffect(()=>{update(node.id);},[node.id,node.ports,branches.join('|'),temporary,update]);
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
 function cancel(){if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}if(drag.current)document.querySelector('[data-moving="port"]')?.removeAttribute('data-moving');drag.current=null;setTemporary(null);}
 useEffect(()=>{if(!active)cancel();},[active]);
 function start(event:PointerEvent<HTMLButtonElement>,key:string,branch:string|null,position:FlowPortPosition){
  if(!active||event.button!==0)return;
  event.preventDefault();event.stopPropagation();const card=event.currentTarget.closest('[data-flow-card]');if(!card)return;
  event.currentTarget.setPointerCapture(event.pointerId);drag.current={key,branch,rect:card.getBoundingClientRect(),position,pointer:event.pointerId};
  card.closest('[data-motion]')?.setAttribute('data-moving','port');
 }
 function move(event:PointerEvent<HTMLButtonElement>){
  const current=drag.current;if(!current||current.pointer!==event.pointerId)return;
  event.preventDefault();event.stopPropagation();const rect=current.rect;
  current.position=nearest(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height);
  if(frame.current===null)frame.current=requestAnimationFrame(()=>{frame.current=null;if(drag.current)setTemporary({key:drag.current.key,position:drag.current.position});});
 }
 function finish(event:PointerEvent<HTMLButtonElement>){
  const current=drag.current;if(!current||current.pointer!==event.pointerId)return;
  event.preventDefault();event.stopPropagation();move(event);const position=drag.current!.position;
  cancel();onChange(node.id,current.branch,position);
 }
 const draft=temporary?{...node,ports:temporary.key==='input'?{...node.ports,input:temporary.position}:{...node.ports,outputs:{...node.ports?.outputs,[temporary.key.slice(7)]:temporary.position}}}:node;
 const ports=resolveFlowPorts(draft,branches);
 return <>{ports.some(port=>port.branch!==null&&port.position.side==='bottom')&&<div className={styles.branches} aria-hidden="true"/>}{ports.map(port=>{
  const position=port.position,label=port.branch?`${node.title} · ${port.branch}连接点`:`${node.title} · 接入连接点`,style={...placement(position),background:port.branch?'#8d98a5':'var(--primary)'};
  return <span key={port.key}>
   <Handle type={port.branch===null?'target':'source'} id={port.branch??undefined} position={sides[position.side]} isConnectable={canEdit&&!adjusting} className={styles.portHandle} style={style} title={label} data-flow-port={port.key}>
    {port.branch!==null&&!active&&<span className={styles.portLabel} data-side={position.side} data-flow-port-label={port.branch}>{port.branch}</span>}
   </Handle>
   {active&&<button type="button" aria-label={`移动${label}`} title={`${label}：拖动调整，方向键沿边框移动`} className={`${styles.portControl} nodrag nopan`} style={style}
    onPointerDown={e=>start(e,port.key,port.branch,position)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current)cancel();}} onClick={e=>e.stopPropagation()}
    onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='Escape'){cancel();return;}onChange(node.id,port.branch,nudge(position,e.key==='ArrowRight'||e.key==='ArrowDown'));}}>
    <span className={styles.portName} data-side={position.side}>{port.branch??'接入'}</span>
   </button>}
  </span>;
 })}</>;
}
