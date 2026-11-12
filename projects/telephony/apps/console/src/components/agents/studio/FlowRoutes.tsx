/*
 * 中文导读：数字员工与话术的 FlowRoutes 组件，封装该界面的展示与交互。
 */
"use client";

import {createContext,memo,useCallback,useContext,useEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {BaseEdge,EdgeText,getBezierPath,useStore,type EdgeProps} from '@xyflow/react';
import type {FlowEdge} from '@/src/lib/api/resources/playbook';
import {localTask} from '@/src/lib/browser-compute/runtime';
import {roundedRoute,type EdgeRoute,type Point,type PortSide,type RouteInput} from '@/src/lib/browser-compute/route-edges';
import styles from './flow-canvas.module.css';

type Routes=Record<string,EdgeRoute>;
const RouteContext=createContext<{routes:Routes;submit:(input:RouteInput|null)=>void}>({routes:{},submit:()=>{}});
export function FlowRoutes({children}:{children:ReactNode}){
 const [routes,setRoutes]=useState<Routes>({}),timer=useRef<ReturnType<typeof setTimeout>|null>(null),controller=useRef<AbortController|null>(null);
 const submit=useCallback((input:RouteInput|null)=>{
  if(timer.current!==null)clearTimeout(timer.current);controller.current?.abort();
  if(!input)return;
  timer.current=setTimeout(()=>{
   const task=new AbortController();controller.current=task;
   void localTask('routes',input,task.signal).then(result=>{if(!task.signal.aborted)setRoutes(result);}).catch(()=>{/* Keep interactive fallback paths if this browser cannot calculate a route. */});
  },80);
 },[]);
 useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);controller.current?.abort();},[]);
 const value=useMemo(()=>({routes,submit}),[routes,submit]);
 return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}

type Geometry={id:string;x:number;y:number;width:number;height:number;dragging:boolean;handles:{source:Array<{id?:string|null;x:number;y:number;width:number;height:number;position:PortSide}>;target:Array<{id?:string|null;x:number;y:number;width:number;height:number;position:PortSide}>}};
function endpoint(node:Geometry,handle:Geometry['handles']['source'][number]):Point{
 return {x:node.x+handle.x+(handle.position==='right'?handle.width:handle.position==='left'?0:handle.width/2),y:node.y+handle.y+(handle.position==='bottom'?handle.height:handle.position==='top'?0:handle.height/2)};
}
// The subscription excludes the viewport: panning/zooming never launches route jobs.
export const FlowRouteGeometry=memo(function FlowRouteGeometry({edges}:{edges:FlowEdge[]}){
 const {submit}=useContext(RouteContext);
 const geometry=useStore(state=>JSON.stringify([...state.nodeLookup.values()].map(n=>({id:n.id,x:n.internals.positionAbsolute.x,y:n.internals.positionAbsolute.y,width:n.measured.width??360,height:n.measured.height??220,dragging:!!n.dragging,handles:n.internals.handleBounds??{source:[],target:[]}}))));
 useEffect(()=>{
  const nodes=JSON.parse(geometry) as Geometry[];
  if(nodes.some(n=>n.dragging)){submit(null);return;}
  const byId=new Map(nodes.map(n=>[n.id,n])),routes:RouteInput['edges']=[];
  for(const edge of edges){
   const source=byId.get(edge.source),target=byId.get(edge.target),from=source?.handles.source?.find(h=>h.id===edge.branch),to=target?.handles.target?.[0];
   if(!source||!target||!from||!to)continue;
   routes.push({id:edge.id,source:edge.source,target:edge.target,label:edge.branch,from:endpoint(source,from),to:endpoint(target,to),fromSide:from.position,toSide:to.position});
  }
  submit({nodes:nodes.map(({id,x,y,width,height})=>({id,x,y,width,height})),edges:routes});
 },[geometry,edges,submit]);
 return null;
});
const same=(a:Point|undefined,x:number,y:number)=>!!a&&Math.abs(a.x-x)<1&&Math.abs(a.y-y)<1;
export const RoutedFlowEdge=memo(function RoutedFlowEdge(props:EdgeProps){
 const {routes}=useContext(RouteContext),route=routes[props.id];
 const ready=!!route&&same(route.points[0],props.sourceX,props.sourceY)&&same(route.points[route.points.length-1],props.targetX,props.targetY);
 const fallback=ready?null:getBezierPath({...props,curvature:0.3});
 const path=ready?(route.path??roundedRoute(route.points)):fallback![0],label=ready?route.label:null;
 const dashed=props.data?.dashed===true,motion=props.data?.motion===true;
 const color=String(props.style?.stroke??'#7e8a99');
 return <g data-flow-route={ready?(route.clear?'clear':'overlap'):'pending'} data-line-kind={dashed?'branch':'normal'} className={dashed?styles.dashedEdge:styles.solidEdge}>
  <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} markerStart={props.markerStart} interactionWidth={props.interactionWidth} style={{...props.style,strokeDasharray:dashed?'8 6':'none'}}/>
  {label&&<EdgeText x={label.x} y={label.y} label={props.label} labelStyle={props.labelStyle} labelShowBg labelBgStyle={{fill:'var(--card)'}} labelBgPadding={[7,4]} labelBgBorderRadius={4}/>}
  {motion&&<circle r={props.selected?2.5:1.9} fill={color} className={styles.travelDot} style={{offsetPath:`path("${path}")`,'--travel-duration':`${Math.min(10,Math.max(3.5,path.length/135))}s`} as CSSProperties} pointerEvents="none"/>}
 </g>;
});
export const flowEdgeTypes={routed:RoutedFlowEdge};
