/*
 * 中文导读：话术流程画布及节点连线界面。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import {memo,useCallback,useEffect,useMemo,useRef,useState,type RefObject,type ReactNode} from 'react';
import {ReactFlow,Background,BackgroundVariant,Panel,MarkerType,applyNodeChanges,useReactFlow,useStore,type Node,type NodeProps,type NodeChange,type Connection,type Edge,type ReactFlowInstance,type Viewport} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {ArrowDownToLine,ArrowLeft,ArrowRightLeft,Check,CheckCircle2,ChevronDown,CircleAlert,CircleDot,Copy,FileText,Headset,Keyboard,LayoutGrid,List,Loader2,Maximize2,Mic,Minus,PanelLeftClose,PhoneOff,Play,Plus,Redo2,Save,Scan,Search,Settings2,Trash2,Undo2,X} from 'lucide-react';
import {useTheme} from 'next-themes';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Textarea} from '@/src/components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/src/components/ui/dialog';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/src/components/ui/alert-dialog';
import {DropdownMenu,DropdownMenuCheckboxItem,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator,DropdownMenuTrigger} from '@/src/components/ui/dropdown-menu';
import type {FlowEdge,FlowGraph,FlowNode,FlowPortPosition} from '@/src/lib/api/resources/playbook';
import {arrangeFlowPorts,defaultBranches,deleteFlowNode,draftFlowProblem,flowBranches,inspectFlow,nodeDescriptions,nodeTitles,putBranch,repairFlowInputPorts} from './flow-model';
import {localTask} from '@/src/lib/browser-compute/runtime';
import {useBrowserCompute} from '@/src/hooks/use-browser-compute';
import {rememberFlow,travelFlow,type FlowHistory} from './flow-history';
import {FlowPreview} from './FlowPreview';
import {FlowPortControls,FlowPorts,type PortChange} from './FlowPorts';
import {FlowRoutes,FlowRouteGeometry,flowEdgeTypes} from './FlowRoutes';
import styles from './flow-canvas.module.css';

const icons={speech:Mic,collect:CircleDot,text:FileText,ivr:Keyboard,jump:ArrowRightLeft,end:PhoneOff,handoff:Headset};
const colors:Record<string,string>={'肯定':'#7e8a99','否定':'#8f98a5','拒绝':'#a9858d','未识别':'#9ca6b2','中性':'#8d98a5','全部':'#8d98a5'};
const outcomes={neutral:'未判定',interested:'有意向',declined:'拒绝沟通',follow_up:'需要跟进'};
const clamp=(value:number)=>Math.max(-10000,Math.min(10000,value));

type CanvasNode=Node<{node:FlowNode;branches:string[];entry:boolean;canEdit:boolean},'script'>;
const ScriptNode=memo(function ScriptNode({data,selected}:NodeProps<CanvasNode>){
 const n=data.node,Icon=icons[n.kind];
 return <div data-flow-card={n.id} className={`${styles.node} ${selected?styles.selected:''}`}>
  <div className={styles.nodeHeading}><Icon className="size-4 text-primary"/><span>{nodeTitles[n.kind]}</span>{data.entry&&<span className={styles.entryBadge}>开场</span>}</div>
  <div className={styles.nodeBody}><strong>{n.title}</strong><p className={!n.text?'text-muted-foreground':undefined}>{n.text||(n.kind==='jump'?'跳转到下一节点':'未填写')}</p>{n.kind==='collect'&&n.field&&<span className="mt-2 block text-xs text-primary">采集：{n.field}</span>}{['end','handoff'].includes(n.kind)&&<span className="mt-2 block text-xs text-muted-foreground">结果：{outcomes[n.outcome]}</span>}</div>
  <FlowPorts node={n} branches={data.branches} canEdit={data.canEdit}/>
 </div>;
});
const nodeTypes={script:ScriptNode};
const ariaLabels={'controls.zoomIn.ariaLabel':'放大画布','controls.zoomOut.ariaLabel':'缩小画布','controls.fitView.ariaLabel':'查看全部节点','node.a11yDescription.default':'按回车选中节点，双击编辑。','edge.a11yDescription.default':'按回车选中连线，可编辑或删除。'};
function canvasNodes(graph:FlowGraph,selected:string,canEdit:boolean,previous:CanvasNode[]=[]):CanvasNode[]{
 const prior=new Map(previous.map(n=>[n.id,n]));
 return graph.nodes.map(n=>{const old=prior.get(n.id),bs=flowBranches(n,graph),entry=n.id===graph.entry;
  const data=old&&old.data.node===n&&old.data.entry===entry&&old.data.canEdit===canEdit&&old.data.branches.length===bs.length&&old.data.branches.every((b,i)=>b===bs[i])?old.data:{node:n,branches:bs,entry,canEdit};
  return {...old,id:n.id,type:'script',position:{x:n.x,y:n.y},selected:n.id===selected,data,ariaLabel:`${nodeTitles[n.kind]}：${n.title}`};
 });
}
function openingViewport(graph:FlowGraph):Viewport{
 if(graph.viewport)return {...graph.viewport,zoom:Math.max(0.2,Math.min(1.6,graph.viewport.zoom))};
 const entry=graph.nodes.find(n=>n.id===graph.entry)||graph.nodes[0];
 return {x:64-(entry?.x||0),y:64-(entry?.y||0),zoom:1};
}
const CanvasNavigation=memo(function CanvasNavigation({entry}:{entry:FlowNode|undefined}){
 const flow=useReactFlow(),zoom=useStore(state=>state.transform[2]);
 return <Panel position="bottom-center" className={styles.navigation}>
  <Button variant="ghost" size="icon" aria-label="缩小画布" disabled={zoom<=0.2} onClick={()=>void flow.zoomOut({duration:160})}><Minus className="size-4"/></Button>
  <button className={styles.zoomValue} aria-label="恢复百分之百大小" onClick={()=>void flow.zoomTo(1,{duration:160})}>{Math.round(zoom*100)}%</button>
  <Button variant="ghost" size="icon" aria-label="放大画布" disabled={zoom>=1.6} onClick={()=>void flow.zoomIn({duration:160})}><Plus className="size-4"/></Button>
  <span className={styles.separator}/><Button variant="ghost" size="icon" aria-label="查看全部节点" title="查看全部节点" onClick={()=>void flow.fitView({padding:0.15,minZoom:0.2,maxZoom:1,duration:180})}><Scan className="size-4"/></Button>
  <Button variant="ghost" size="sm" disabled={!entry} onClick={()=>entry&&void flow.setCenter(entry.x+180,entry.y+116,{zoom:1,duration:180})}>开场</Button>
 </Panel>;
});
type SurfaceProps={graph:FlowGraph;selected:string;selectedEdge:string;canEdit:boolean;busy:boolean;dark:boolean;motion:boolean;adjusting:boolean;onPort:PortChange;instanceRef:RefObject<ReactFlowInstance<CanvasNode,Edge>|null>;area:RefObject<HTMLDivElement|null>;onPositions:(nodes:Array<{id:string;position:{x:number;y:number}}>)=>void;onViewport:(viewport:Viewport)=>void;onSelect:(id:string)=>void;onEdit:(id:string)=>void;onSelectEdge:(id:string)=>void;onEditEdge:(id:string)=>void;onConnect:(c:Connection)=>void};
// Keep pointer updates local. Commit only final positions and viewport to the employee draft.
const FlowSurface=memo(function FlowSurface({graph,selected,selectedEdge,canEdit,busy,dark,motion,adjusting,onPort,instanceRef,area,onPositions,onViewport,onSelect,onEdit,onSelectEdge,onEditEdge,onConnect}:SurfaceProps){
 const [nodes,setNodes]=useState<CanvasNode[]>(()=>canvasNodes(graph,selected,canEdit&&!busy));
 const portHandler=useRef(onPort);portHandler.current=onPort;
 const updatePort=useCallback<PortChange>((...args)=>portHandler.current(...args),[]);
 const initialViewport=useMemo(()=>openingViewport(graph),[graph]);
 // ReactFlow keeps transient drag state locally; sync it from the saved graph after external edits.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setNodes(previous=>canvasNodes(graph,selected,canEdit&&!busy,previous));},[graph.nodes,graph.edges,graph.entry,selected,canEdit,busy]);
 const edges=useMemo<Edge[]>(()=>{
  const titles=new Map(graph.nodes.map(n=>[n.id,n.title])),handoffs=new Set(graph.nodes.filter(n=>n.kind==='handoff').map(n=>n.id));
  return graph.edges.map(e=>{const dashed=['拒绝','未识别','人工跟进'].includes(e.branch)||handoffs.has(e.target),selected=e.id===selectedEdge,edgeColor=selected?'#b83240':(dashed?'#a9858d':'#7e8a99');return {...e,sourceHandle:e.branch,label:e.branch,type:'routed',animated:false,data:{dashed,motion},selected,interactionWidth:22,ariaLabel:`${e.branch}：${titles.get(e.source)} → ${titles.get(e.target)}`,style:{stroke:edgeColor,strokeWidth:selected?2.25:1.35,opacity:selected?1:0.78},labelStyle:{fontSize:11,fontWeight:500,fill:selected?'#b83240':edgeColor},markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13,color:edgeColor}};});
 },[graph.edges,graph.nodes,selectedEdge,motion]);
 const change=useCallback((changes:NodeChange<CanvasNode>[])=>setNodes(previous=>applyNodeChanges(changes,previous)),[]);
 const moving=()=>area.current?.setAttribute('data-moving','true'),stopMoving=()=>area.current?.removeAttribute('data-moving');
 return <div ref={area} className={styles.surface} data-motion={motion?'on':'off'} aria-label="话术流程画布">
  <FlowRoutes><FlowPortControls adjusting={adjusting&&canEdit&&!busy} onChange={updatePort}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={flowEdgeTypes} colorMode={dark?'dark':'light'}
   onInit={value=>{instanceRef.current=value;}} onNodesChange={change} onConnect={onConnect}
   onNodeClick={(_,n)=>onSelect(n.id)} onNodeDoubleClick={(_,n)=>{if(!adjusting)onEdit(n.id);}}
   onEdgeClick={(_,e)=>onSelectEdge(e.id)} onEdgeDoubleClick={(_,e)=>onEditEdge(e.id)} onPaneClick={()=>onSelect('')}
   onNodeDragStart={moving} onNodeDragStop={(_event,_node,moved)=>{stopMoving();if(canEdit&&!busy)onPositions(moved);}}
   onMoveStart={moving} onMoveEnd={(_,viewport)=>{stopMoving();if(canEdit&&!busy)onViewport(viewport);}}
   nodesDraggable={canEdit&&!busy&&!adjusting} nodesConnectable={canEdit&&!busy&&!adjusting} edgesReconnectable={false}
   deleteKeyCode={null} panOnDrag panOnScroll={false} zoomOnScroll zoomOnPinch zoomOnDoubleClick={false} nodeDragThreshold={3} minZoom={0.2} maxZoom={1.6}
   defaultViewport={initialViewport} fitView={false} onlyRenderVisibleElements={false} ariaLabelConfig={ariaLabels}>
   <Background variant={BackgroundVariant.Cross} gap={24} size={5} lineWidth={0.8} color={dark?'#3b495e':'#c7d2e1'} bgColor={dark?'#181f2b':'#f5f7fb'}/>
   <FlowRouteGeometry edges={graph.edges}/>
   <Panel position="bottom-left" className={styles.lineLegend} aria-label="连线类型"><span><i/>正常推进</span><span title="拒绝、未识别、人工跟进"><i className={styles.legendDashed}/>分支与跟进</span></Panel>
   <CanvasNavigation entry={graph.nodes.find(n=>n.id===graph.entry)}/>
  </ReactFlow></FlowPortControls></FlowRoutes>
 </div>;
});

type Props={graph:FlowGraph;onChange:(g:FlowGraph)=>void;onSave:(g:FlowGraph)=>Promise<boolean>;onPublish:(g:FlowGraph)=>Promise<boolean>;globalContent:ReactNode;renderOverview:(locate:(id:string)=>void,openGlobals:()=>void)=>ReactNode;onRehearse:()=>void;initialView?:'canvas'|'overview';releaseLabel?:string;canPublish?:boolean;canEdit:boolean;busy:boolean;dirty:boolean;savedAt:string|null;saveError:string;employeeName?:string};
export function FlowCanvas({graph,onChange,onSave,onPublish,globalContent,renderOverview,onRehearse,initialView='canvas',releaseLabel,canEdit,canPublish=true,busy,dirty,savedAt,saveError,employeeName}:Props){
 const {resolvedTheme}=useTheme(),compute=useBrowserCompute();
 const graphRef=useRef(graph);
 const [hidden,setHidden]=useState(false),[reducedMotion,setReducedMotion]=useState(false),[arranging,setArranging]=useState(false);
 const layoutController=useRef<AbortController|null>(null);
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>{setHidden(document.hidden);setReducedMotion(media.matches);};update();document.addEventListener('visibilitychange',update);media.addEventListener('change',update);return()=>{document.removeEventListener('visibilitychange',update);media.removeEventListener('change',update);layoutController.current?.abort();};},[]);
 const instance=useRef<ReactFlowInstance<CanvasNode,Edge>|null>(null),area=useRef<HTMLDivElement>(null),actionRef=useRef(false),nameRef=useRef<HTMLInputElement>(null);
 graphRef.current=graph;
 const repairedGraph=useMemo(()=>repairFlowInputPorts(graph),[graph]);
 const displayGraph=repairedGraph;
 const [selected,setSelected]=useState(graph.entry),[selectedEdge,setSelectedEdge]=useState(''),[full,setFull]=useState(true);
 const [directory,setDirectory]=useState(true),[motion,setMotion]=useState(true),[adjusting,setAdjusting]=useState(false),[nodeOpen,setNodeOpen]=useState(false),[edgeOpen,setEdgeOpen]=useState(false),[issuesOpen,setIssuesOpen]=useState(false),[globals,setGlobals]=useState(false),[view,setView]=useState(initialView);
 const [preview,setPreview]=useState<FlowGraph|null>(null),[search,setSearch]=useState(''),[custom,setCustom]=useState(''),[customTarget,setCustomTarget]=useState(''),[editError,setEditError]=useState('');
 const [localError,setLocalError]=useState(''),[action,setAction]=useState<'save'|'publish'|null>(null),[history,setHistory]=useState<FlowHistory>({past:[],future:[]});
 const [deleting,setDeleting]=useState<{kind:'node'|'edge';id:string}|null>(null);
 useEffect(()=>{if(compute?.lowPower)setMotion(false);},[compute?.lowPower]);
 const grouped=useRef({key:'',time:0});
 const locked=busy||!!action||arranging,node=graph.nodes.find(n=>n.id===selected),edge=graph.edges.find(e=>e.id===selectedEdge),edgeSource=graph.nodes.find(n=>n.id===edge?.source);
 const issues=useMemo(()=>inspectFlow(graph),[graph]),errors=issues.filter(i=>i.severity==='error'),warnings=issues.filter(i=>i.severity==='warning');
 const selectionName=deleting?.kind==='node'?graph.nodes.find(n=>n.id===deleting.id)?.title:graph.edges.find(e=>e.id===deleting?.id)?.branch;
 function commit(next:FlowGraph,group=''){
  if(!canEdit||locked||JSON.stringify(next)===JSON.stringify(graphRef.current))return;
  const previous=graphRef.current,time=Date.now();
  if(!group||grouped.current.key!==group||time-grouped.current.time>700)setHistory(h=>rememberFlow(h,previous));
  else setHistory(h=>({...h,future:[]}));
  grouped.current={key:group,time};graphRef.current=next;onChange(next);setEditError('');setLocalError('');
 }
 function travel(direction:'undo'|'redo'){
  if(!canEdit||locked)return;const result=travelFlow(history,graphRef.current,direction);if(!result)return;
  grouped.current={key:'',time:0};setHistory(result.history);graphRef.current=result.graph;onChange(result.graph);setEditError('');setLocalError('');
 }
 function select(id:string){setSelected(id);setSelectedEdge('');}
 function edit(id:string){select(id);setCustom('');setCustomTarget('');setEditError('');setLocalError('');setNodeOpen(true);}
 function editEdge(id:string){setSelectedEdge(id);setSelected('');setEditError('');setLocalError('');setEdgeOpen(true);}
 function focus(id:string){select(id);const n=graphRef.current.nodes.find(n=>n.id===id);if(n)void instance.current?.setCenter(n.x+180,n.y+116,{zoom:1,duration:180});}
 function withViewport(){const viewport=instance.current?.getViewport();return viewport?{...graphRef.current,viewport}:graphRef.current;}
 async function persist(close?:()=>void){
  if(actionRef.current||locked||!canEdit)return;
  const problem=draftFlowProblem(graphRef.current);if(problem){setLocalError(problem);return;}
  actionRef.current=true;setAction('save');setLocalError('');
  try{if(await onSave(withViewport()))close?.();else setLocalError('保存未成功，请检查提示后重试。');}
  catch{setLocalError('保存未成功，请重试。');}
  finally{actionRef.current=false;setAction(null);}
 }
 async function publish(){
  if(actionRef.current||locked||!canEdit)return;
  if(errors.length){setIssuesOpen(true);return;}
  actionRef.current=true;setAction('publish');setLocalError('');
  try{if(!await onPublish(withViewport()))setLocalError('发布未成功，请检查提示后重试。');}
  catch{setLocalError('发布未成功，请重试。');}
  finally{actionRef.current=false;setAction(null);}
 }
 useEffect(()=>{if(!full)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return ()=>{document.body.style.overflow=previous;};},[full]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.target instanceof Element&&event.target.closest('[role="dialog"],[role="alertdialog"]')&&!nodeOpen&&!edgeOpen&&!issuesOpen&&!preview&&!deleting)return;
   const modal=nodeOpen||edgeOpen||issuesOpen||!!preview||!!deleting;
   if(event.key==='Escape'&&!modal){if(adjusting){setAdjusting(false);return;}if(globals){setGlobals(false);return;}if(full){setFull(false);return;}}
   if(!full&&!area.current?.closest('section')?.contains(event.target as globalThis.Node))return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&canEdit&&!issuesOpen&&!preview&&!deleting){event.preventDefault();void persist();return;}
   if(view!=='canvas'||modal||(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]')))return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();travel(event.shiftKey?'redo':'undo');}
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();travel('redo');}
   if((event.key==='Delete'||event.key==='Backspace')&&canEdit&&!locked){if(edge)setDeleting({kind:'edge',id:edge.id});else if(node&&graph.nodes.length>1)setDeleting({kind:'node',id:node.id});else return;event.preventDefault();}
  };
  window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);
 });
 async function arrange(){
  if(!canEdit||locked)return;
  const current=graphRef.current,controller=new AbortController();layoutController.current=controller;setArranging(true);
  try{
   const result=await localTask('layout',current,controller.signal);
   if(graphRef.current!==current)return;
   const positions=new Map(result.map(position=>[position.id,position]));
   const positioned={...current,nodes:current.nodes.map(node=>{const position=positions.get(node.id);return position?{...node,x:position.x,y:position.y}:node;})};
   const next=arrangeFlowPorts(positioned);
   commit(next);const start=next.nodes.find(node=>node.id===next.entry);
   if(start)requestAnimationFrame(()=>void instance.current?.setCenter(start.x+180,start.y+116,{zoom:1,duration:180}));
  }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setLocalError('布局未整理完成，请重试。');}
  finally{if(!controller.signal.aborted)setArranging(false);}
 }
 function movePort(id:string,branch:string|null,position:FlowPortPosition){
  setSelected(id);setSelectedEdge('');
  const current=graphRef.current;
  commit({...current,nodes:current.nodes.map(n=>n.id!==id?n:{...n,ports:branch===null?{...n.ports,input:position}:{...n.ports,outputs:{...n.ports?.outputs,[branch]:position}}})},'port-'+id+'-'+(branch??'input'));
 }
 function resetPorts(){
  if(!node?.ports)return;const current=graphRef.current;
  commit({...current,nodes:current.nodes.map(n=>{if(n.id!==node.id)return n;const {ports:_ports,...rest}=n;return rest;})});
 }
 function patch(p:Partial<FlowNode>){const current=graphRef.current;commit({...current,nodes:current.nodes.map(n=>n.id===selected?{...n,...p}:n)},'node-'+selected+'-'+Object.keys(p).join());}
 function connect(c:Connection){
  if(!canEdit||locked||!c.source||!c.target||!c.sourceHandle)return;
  const current=graphRef.current,source=current.nodes.find(n=>n.id===c.source);
  if(!source||['end','handoff'].includes(source.kind))return;
  const prior=current.edges.find(e=>e.source===c.source&&e.branch===c.sourceHandle);
  if(current.edges.length>=240&&!prior){setLocalError('连线已达到 240 条，请先删除不需要的连线。');return;}
  commit(putBranch(current,{id:prior?.id||crypto.randomUUID(),source:c.source,target:c.target,branch:c.sourceHandle,condition:prior?.condition||''}));
 }
 function add(kind:FlowNode['kind']){
  if(!canEdit||locked||graph.nodes.length>=80)return;
  const bounds=area.current?.getBoundingClientRect(),position=bounds&&instance.current?.screenToFlowPosition({x:bounds.x+bounds.width/2-180,y:bounds.y+bounds.height/2-100});
  const added:FlowNode={id:crypto.randomUUID(),kind,title:nodeTitles[kind],text:kind==='end'?'感谢接听，再见。':'',x:clamp(position?.x??((node?.x||100)+440)),y:clamp(position?.y??(node?.y||100)),field:'',outcome:kind==='handoff'?'follow_up':'neutral'};
  commit({...graphRef.current,nodes:[...graphRef.current.nodes,added]});edit(added.id);
 }
 function target(branch:string,value:string){
  if(!node)return;const current=graphRef.current,prior=current.edges.find(e=>e.source===node.id&&e.branch===branch);
  if(value){if(current.edges.length>=240&&!prior){setEditError('连线已达到 240 条。');return;}commit(putBranch(current,{id:prior?.id||crypto.randomUUID(),source:node.id,target:value,branch,condition:prior?.condition||''}));}
  else commit({...current,edges:current.edges.filter(e=>!(e.source===node.id&&e.branch===branch))});
 }
 function addBranch(){
  if(!node)return;const branch=custom.trim();
  if(!branch||!customTarget){setEditError('填写分支名称，并选择下一节点。');return;}
  if(flowBranches(node,graph).includes(branch)){setEditError('这个分支已存在，请直接修改它的下一节点。');return;}
  if(node.kind==='ivr'&&!/^[0-9*#]$/.test(branch)){setEditError('按键分支请填写单个 0–9、* 或 #。');return;}
  target(branch,customTarget);setCustom('');setCustomTarget('');
 }
 function remove(){
  if(!deleting)return;const current=graphRef.current;
  if(deleting.kind==='node'){const next=deleteFlowNode(current,deleting.id);commit(next);select(next.entry);setNodeOpen(false);}
  else {commit({...current,edges:current.edges.filter(e=>e.id!==deleting.id)});setSelectedEdge('');setEdgeOpen(false);}
  setDeleting(null);
 }
 function duplicate(){if(!node||graph.nodes.length>=80)return;const copy={...node,id:crypto.randomUUID(),title:node.title.slice(0,96)+' 副本',x:clamp(node.x+60),y:clamp(node.y+110)};commit({...graphRef.current,nodes:[...graphRef.current.nodes,copy]});edit(copy.id);}
 function patchEdge(p:Partial<FlowEdge>){
  if(!edge)return;const next={...edge,...p},current=graphRef.current;
  if(current.edges.some(e=>e.id!==edge.id&&e.source===next.source&&e.branch===next.branch)){setEditError('同一分支已经有目标，请先调整原来的连线。');return;}
  commit({...current,edges:current.edges.map(e=>e.id===edge.id?next:e)},'edge-'+edge.id+'-'+Object.keys(p).join());
 }
 const visibleNodes=graph.nodes.filter(n=>!search.trim()||(n.title+' '+n.text+' '+nodeTitles[n.kind]).toLowerCase().includes(search.trim().toLowerCase()));
 const renderError=()=>localError&&<p role="alert" className="text-xs leading-5 text-destructive">{localError.startsWith('保存未成功')||localError.startsWith('发布未成功')?saveError||localError:localError}</p>;
 const dialogClosing=(close:(open:boolean)=>void)=>(open:boolean)=>{if(!actionRef.current)close(open);};
 return <div data-flow-studio={full?'full':'inline'} className={`${styles.studio} ${full?styles.full:styles.inline}`}>
  <div className={styles.toolbar}>
   <div className="flex min-w-0 items-center gap-2">{full&&<Button variant="ghost" size="icon" aria-label="返回员工设置" title="返回员工设置" onClick={()=>setFull(false)}><ArrowLeft className="size-4"/></Button>}<div className="min-w-0"><strong className="block truncate text-sm">{employeeName?`${employeeName} · `:''}话术设计</strong><span role="status" aria-live="polite" title={savedAt?`上次保存：${new Date(savedAt).toLocaleString('zh-CN')}`:undefined} className={`mt-1 block text-xs ${dirty?'text-amber-700 dark:text-amber-300':'text-muted-foreground'}`}>{arranging?'布局整理中…':locked?'保存中…':dirty?'有未保存修改':releaseLabel||(savedAt?'草稿已保存':'尚未保存')}</span></div></div>
   <div className={styles.viewSwitch} role="group" aria-label="话术设计视图">{([['canvas','画布编辑'],['overview','文字总览']] as const).map(([id,label])=><Button key={id} size="sm" variant={view===id?'secondary':'ghost'} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</Button>)}</div>
   <div className="flex shrink-0 flex-wrap items-center gap-1.5">{!full&&<Button variant="ghost" size="icon" aria-label="大画布" title="大画布" onClick={()=>setFull(true)}><Maximize2 className="size-4"/></Button>}<Button size="sm" variant={globals?'secondary':'ghost'} aria-expanded={globals} aria-controls="global-script-panel" onClick={()=>setGlobals(v=>!v)}><Settings2 className="size-3.5"/>全局话术</Button><Button size="sm" variant="ghost" onClick={()=>setIssuesOpen(true)}><CheckCircle2 className="size-3.5"/>流程检查{errors.length>0&&<span className="text-destructive">{errors.length}</span>}</Button><Button size="sm" variant="outline" disabled={locked} onClick={()=>setPreview(structuredClone(graphRef.current))}><Play className="size-3.5"/>流程预览</Button><Button size="sm" variant="ghost" disabled={locked} onClick={onRehearse}>文字演练</Button>{canEdit&&<><Button size="sm" variant="outline" disabled={locked||!dirty&&!!savedAt&&!saveError&&!localError} onClick={()=>void persist()}>{action==='save'?<Loader2 className="size-3.5 animate-spin"/>:<Save className="size-3.5"/>}保存草稿</Button></>}{(canEdit||canPublish)&&<Button size="sm" disabled={locked} onClick={()=>void publish()}><Check className="size-3.5"/>{canPublish?"审核发布":"保存待审核"}</Button>}</div>
  </div>
  {view==='canvas'&&<div className={styles.palette}>
   <Button variant="ghost" size="icon-sm" aria-label={directory?'收起节点目录':'展开节点目录'} title={directory?'收起节点目录':'展开节点目录'} onClick={()=>setDirectory(v=>!v)}>{directory?<PanelLeftClose className="size-4"/>:<List className="size-4"/>}</Button>
   {canEdit&&<><Button size="icon-sm" variant="ghost" aria-label="撤销" title="撤销（Ctrl/⌘ Z）" disabled={locked||!history.past.length} onClick={()=>travel('undo')}><Undo2 className="size-4"/></Button><Button size="icon-sm" variant="ghost" aria-label="重做" title="重做（Ctrl/⌘ Shift Z）" disabled={locked||!history.future.length} onClick={()=>travel('redo')}><Redo2 className="size-4"/></Button><span className={styles.separator}/></>}
   {canEdit&&<DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-8 text-xs" disabled={locked||graph.nodes.length>=80}><Plus className="size-3.5"/>添加节点<ChevronDown className="size-3.5"/></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-48" onCloseAutoFocus={event=>{if(nameRef.current)event.preventDefault();}}>
     <DropdownMenuLabel className="text-xs text-muted-foreground">常用节点</DropdownMenuLabel>
     {(['speech','collect','end','handoff'] as const).map(kind=>{const Icon=icons[kind];return <DropdownMenuItem key={kind} aria-label={`添加${nodeTitles[kind]}`} onSelect={()=>add(kind)}><Icon className="size-3.5"/>{nodeTitles[kind]}</DropdownMenuItem>;})}
     <DropdownMenuSeparator/><DropdownMenuLabel className="text-xs text-muted-foreground">高级节点</DropdownMenuLabel>
     {(['text','ivr','jump'] as const).map(kind=>{const Icon=icons[kind];return <DropdownMenuItem key={kind} aria-label={`添加${nodeTitles[kind]}`} title={nodeDescriptions[kind]} onSelect={()=>add(kind)}><Icon className="size-3.5"/>{nodeTitles[kind]}</DropdownMenuItem>;})}
    </DropdownMenuContent>
   </DropdownMenu>}
   <div className="ml-auto flex shrink-0 items-center gap-1">
    {adjusting&&<Button size="sm" variant="secondary" disabled={locked} onClick={()=>setAdjusting(false)}><Check className="size-3.5"/>完成连接点调整</Button>}
    <Button size="sm" variant="ghost" disabled={!canEdit||locked} onClick={()=>void arrange()}>{arranging?<Loader2 className="size-3.5 animate-spin"/>:<LayoutGrid className="size-3.5"/>}整理布局</Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><Settings2 className="size-3.5"/>画布选项<ChevronDown className="size-3.5"/></Button></DropdownMenuTrigger>
     <DropdownMenuContent align="end" className="min-w-48">
      <DropdownMenuItem disabled={locked||!node&&!edge} onSelect={()=>edge?editEdge(edge.id):node&&edit(node.id)}><Settings2 className="size-3.5"/>{edge?'编辑选中连线':'编辑选中节点'}</DropdownMenuItem>
      {canEdit&&<><DropdownMenuCheckboxItem checked={adjusting} disabled={locked} onCheckedChange={value=>setAdjusting(value)}>调整连接点</DropdownMenuCheckboxItem><DropdownMenuItem disabled={locked||!node?.ports} onSelect={resetPorts}>重置选中节点连接点</DropdownMenuItem></>}
      <DropdownMenuSeparator/><DropdownMenuCheckboxItem checked={motion} onCheckedChange={value=>setMotion(value)}>连线动画</DropdownMenuCheckboxItem>
     </DropdownMenuContent>
    </DropdownMenu>
   </div>
  </div>}
  {localError&&!nodeOpen&&!edgeOpen&&<div className="flex items-center justify-between gap-3 border-b bg-destructive/5 px-4 py-2">{renderError()}<button aria-label="关闭提示" onClick={()=>setLocalError('')}><X className="size-3.5"/></button></div>}
  <div className={styles.workspace}>
   {view==='canvas'&&directory&&<aside className={styles.directory} aria-label="节点目录">
    <div className="shrink-0">
     <div className="mb-3 flex items-center justify-between px-1 text-xs text-muted-foreground"><span>流程节点</span><span>{graph.nodes.length} / 80</span></div>
     <div className="relative mb-3"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"/><Input aria-label="搜索流程节点" value={search} onChange={e=>setSearch(e.target.value)} className="h-8 pl-8 text-xs" placeholder="搜索节点"/></div>
    </div>
    <div className={styles.directoryList}>
     {visibleNodes.map(n=>{const Icon=icons[n.kind],invalid=errors.some(i=>i.nodeId===n.id);return <div key={n.id} className={`${styles.directoryRow} ${selected===n.id?styles.directorySelected:''}`}>
      <button className={styles.directoryItem} onClick={()=>focus(n.id)} onDoubleClick={()=>edit(n.id)}><span className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5"/>{n.id===graph.entry?'开场节点':nodeTitles[n.kind]}{invalid&&<CircleAlert aria-label="待完善" className="ml-auto size-3 text-destructive"/>}</span><strong title={n.title}>{n.title}</strong></button>
      {canEdit&&<Button size="icon-sm" variant="ghost" className={styles.directoryDelete} aria-label={`删除节点：${n.title}`} title={graph.nodes.length<=1?'至少保留一个节点':`删除“${n.title}”`} disabled={locked||graph.nodes.length<=1} onClick={()=>setDeleting({kind:'node',id:n.id})}><Trash2 className="size-3.5"/></Button>}
     </div>;})}
     {!visibleNodes.length&&<p className="py-5 text-center text-xs text-muted-foreground">没有匹配的节点</p>}
    </div>
   </aside>}
   <div className={view==='canvas'?'flex min-w-0 flex-1':'hidden'}><FlowSurface graph={displayGraph} selected={selected} selectedEdge={selectedEdge} canEdit={canEdit} busy={locked} dark={resolvedTheme==='dark'} motion={motion&&!hidden&&!reducedMotion&&view==='canvas'} adjusting={adjusting} onPort={movePort} instanceRef={instance} area={area}
    onPositions={moved=>{const current=graphRef.current,positions=new Map(moved.map(n=>[n.id,n.position]));commit({...current,nodes:current.nodes.map(n=>{const p=positions.get(n.id);return p?{...n,x:clamp(p.x),y:clamp(p.y)}:n;})});}}
    onViewport={viewport=>{const current=graphRef.current;if(current.viewport?.x===viewport.x&&current.viewport?.y===viewport.y&&current.viewport?.zoom===viewport.zoom)return;const next={...current,viewport};graphRef.current=next;onChange(next);}}
    onSelect={select} onEdit={edit} onSelectEdge={id=>{setSelectedEdge(id);setSelected('');}} onEditEdge={editEdge} onConnect={connect}/></div>
   {view==='overview'&&renderOverview(id=>{setView('canvas');requestAnimationFrame(()=>{focus(id);edit(id);});},()=>setGlobals(true))}
   {globals&&<aside id="global-script-panel" aria-label="全局话术" className={styles.globalPanel}><header className="flex shrink-0 items-center justify-between border-b px-5 py-3"><h2 className="text-sm font-semibold">全局话术</h2><Button size="icon-sm" variant="ghost" aria-label="关闭全局话术" onClick={()=>setGlobals(false)}><X className="size-4"/></Button></header><fieldset disabled={!canEdit||locked} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">{globalContent}</fieldset></aside>}
   {view==='canvas'&&edge&&<div className={styles.edgeActions}><span className="truncate text-xs">{edgeSource?.title} · {edge.branch}</span><Button size="sm" variant="outline" onClick={()=>editEdge(edge.id)}>编辑连线</Button>{canEdit&&<Button size="icon-sm" variant="ghost" aria-label="删除选中连线" disabled={locked} onClick={()=>setDeleting({kind:'edge',id:edge.id})}><Trash2 className="size-3.5 text-destructive"/></Button>}<Button size="icon-sm" variant="ghost" aria-label="取消选择连线" onClick={()=>setSelectedEdge('')}><X className="size-3.5"/></Button></div>}
  </div>

  <Dialog open={nodeOpen} onOpenChange={dialogClosing(setNodeOpen)}><DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={!locked} onOpenAutoFocus={e=>{e.preventDefault();nameRef.current?.focus();}} onEscapeKeyDown={e=>{if(locked)e.preventDefault();}} onPointerDownOutside={e=>{if(locked)e.preventDefault();}}>
   <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14"><DialogTitle>{node?nodeTitles[node.kind]:'节点设置'}</DialogTitle><DialogDescription className="sr-only">{node?nodeDescriptions[node.kind]:'请选择一个节点'}</DialogDescription></DialogHeader>
   <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{renderInspector()}</div>
   <div className="shrink-0 space-y-2 border-t px-6 py-4">{renderError()}<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{dirty?'有未保存修改':'保存为草稿，发布后用于新通话'}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={locked} onClick={()=>setNodeOpen(false)}>返回画布</Button>{canEdit&&<Button size="sm" disabled={locked||!node} onClick={()=>void persist(()=>setNodeOpen(false))}>{action==='save'?<Loader2 className="size-3.5 animate-spin"/>:<Save className="size-3.5"/>}{action==='save'?'保存中…':'保存草稿'}</Button>}</div></div></div>
  </DialogContent></Dialog>

  <Dialog open={edgeOpen} onOpenChange={dialogClosing(setEdgeOpen)}><DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton={!locked} onEscapeKeyDown={e=>{if(locked)e.preventDefault();}} onPointerDownOutside={e=>{if(locked)e.preventDefault();}}><DialogHeader className="shrink-0 border-b px-6 py-5 pr-14"><DialogTitle>连线设置</DialogTitle><DialogDescription className="sr-only">修改下一节点或分支条件。</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto p-6">{edge&&<fieldset disabled={!canEdit||locked} className="space-y-4"><p className="text-sm text-muted-foreground">来自：{edgeSource?.title}</p><label className="grid gap-2 text-sm">分支名称<Input maxLength={40} value={edge.branch} disabled={!!edgeSource&&defaultBranches(edgeSource.kind).includes(edge.branch)} onChange={e=>patchEdge({branch:e.target.value})}/></label><label className="grid gap-2 text-sm">下一节点<NativeSelect className="h-9 rounded border bg-background px-3" value={edge.target} onChange={e=>patchEdge({target:e.target.value})}>{graph.nodes.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</NativeSelect></label><label className="grid gap-2 text-sm">分支条件<Textarea rows={3} maxLength={300} value={edge.condition} onChange={e=>patchEdge({condition:e.target.value})} placeholder="选填：什么情况下进入这个分支"/></label>{editError&&<p role="alert" className="text-xs text-destructive">{editError}</p>}<Button size="sm" variant="outline" className="text-destructive" onClick={()=>setDeleting({kind:'edge',id:edge.id})}><Trash2 className="size-3.5"/>删除连线</Button></fieldset>}</div><div className="shrink-0 space-y-2 border-t px-6 py-4">{renderError()}<div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={locked} onClick={()=>setEdgeOpen(false)}>返回画布</Button>{canEdit&&<Button size="sm" disabled={locked||!edge} onClick={()=>void persist(()=>setEdgeOpen(false))}><Save className="size-3.5"/>{action==='save'?'保存中…':'保存草稿'}</Button>}</div></div></DialogContent></Dialog>

  <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}><DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"><DialogHeader className="shrink-0 border-b px-6 py-5 pr-14"><DialogTitle>流程检查</DialogTitle><DialogDescription className="text-xs">{errors.length?`${errors.length} 项需要修改后发布`:'没有阻止发布的问题'}{warnings.length>0&&`，${warnings.length} 项建议`}</DialogDescription></DialogHeader><div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-6">{!issues.length&&<p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4"/>流程结构完整，可继续预览或发布。</p>}{issues.map((issue,i)=><div key={i} className={`flex items-start justify-between gap-3 rounded border p-3 ${issue.severity==='error'?'border-destructive/20':'border-amber-500/20'}`}><p className="text-xs leading-5"><span className={issue.severity==='error'?'text-destructive':'text-amber-700 dark:text-amber-300'}>{issue.severity==='error'?'需修改':'建议'}：</span>{issue.message}</p>{issue.nodeId&&<Button size="sm" variant="ghost" className="shrink-0" onClick={()=>{setIssuesOpen(false);focus(issue.nodeId!);edit(issue.nodeId!);}}>定位</Button>}</div>)}</div><div className="flex shrink-0 justify-end border-t px-6 py-4"><Button size="sm" onClick={()=>setIssuesOpen(false)}>返回画布</Button></div></DialogContent></Dialog>


  <AlertDialog open={!!deleting} onOpenChange={open=>{if(!open)setDeleting(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除{deleting?.kind==='node'?'节点':'连线'}“{selectionName}”？</AlertDialogTitle><AlertDialogDescription>{deleting?.kind==='node'?'同时移除与此节点连接的线。':'这个分支将不再连接下一节点。'}删除后可用“撤销”恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>保留</AlertDialogCancel><AlertDialogAction disabled={locked} onClick={remove}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  {preview&&<FlowPreview graph={preview} onClose={()=>setPreview(null)}/>}
 </div>;

 function renderInspector(){
  if(!node)return <p className="text-xs text-muted-foreground">节点已移除，请返回画布选择节点。</p>;
  return <fieldset disabled={!canEdit||locked} className="space-y-4">
   <label className="grid gap-2 text-xs"><span>节点名称 <span className="text-destructive">*</span></span><Input ref={nameRef} maxLength={100} value={node.title} onChange={e=>patch({title:e.target.value})}/></label>
   {node.kind!=='jump'&&<label className="grid gap-2 text-xs">{['end','handoff'].includes(node.kind)?'结束语':node.kind==='ivr'?'按键提示话术':'话术与要求'}<Textarea className="min-h-24 text-sm leading-6" maxLength={4000} value={node.text} onChange={e=>patch({text:e.target.value})}/></label>}
   {node.kind==='collect'&&<label className="grid gap-2 text-xs">采集字段<Input placeholder="例如：回访时间" maxLength={50} value={node.field} onChange={e=>patch({field:e.target.value})}/>{node.field&&!/^[\p{L}\p{N}_]{1,50}$/u.test(node.field)&&<span className="text-destructive">使用单个字段名，只能包含文字、数字和下划线。</span>}</label>}
   {['end','handoff'].includes(node.kind)&&<label className="grid gap-2 text-xs">通话结果<NativeSelect className="h-9 rounded border bg-background px-3" value={node.outcome} onChange={e=>patch({outcome:e.target.value as FlowNode['outcome']})}>{Object.entries(outcomes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</NativeSelect></label>}
   {!['end','handoff','jump'].includes(node.kind)&&<Button size="sm" variant="outline" onClick={()=>commit({...graphRef.current,entry:node.id})} disabled={node.id===graph.entry}><ArrowDownToLine className="size-3.5"/>{node.id===graph.entry?'当前开场节点':'设为开场节点'}</Button>}
   {flowBranches(node,graph).length>0&&<div className="space-y-3 border-t pt-4"><h3 className="text-sm font-semibold">分支与下一步</h3><div className="grid gap-3 sm:grid-cols-2">{flowBranches(node,graph).map(branch=>{const connection=graph.edges.find(e=>e.source===node.id&&e.branch===branch);return <div key={branch} className="space-y-2 rounded border p-3"><label className="grid gap-2 text-xs"><span style={{color:colors[branch]||'inherit'}}>{branch}</span><NativeSelect className="h-9 min-w-0 rounded border bg-background px-2" value={connection?.target||''} onChange={event=>target(branch,event.target.value)}><option value="">未连接</option>{graph.nodes.map(n=><option key={n.id} value={n.id}>{n.title}{n.id===node.id?'（当前节点）':''}</option>)}</NativeSelect></label>{connection&&<label className="grid gap-1 text-sm text-muted-foreground">分支条件<Input className="h-8 text-xs" maxLength={300} placeholder="选填" value={connection.condition} onChange={event=>{const current=graphRef.current;commit({...current,edges:current.edges.map(e=>e.id===connection.id?{...e,condition:event.target.value}:e)},'condition-'+connection.id);}}/></label>}</div>;})}</div></div>}
   {!['end','handoff','jump','text'].includes(node.kind)&&<div className="space-y-2 rounded border border-dashed p-3"><h3 className="text-xs font-medium">新增{node.kind==='ivr'?'按键':'自定义'}分支</h3><div className="grid gap-2 sm:grid-cols-2"><Input aria-label="新分支名称" className="h-9 text-xs" maxLength={node.kind==='ivr'?1:40} placeholder={node.kind==='ivr'?'单个 0–9、* 或 #':'例如：稍后联系'} value={custom} onChange={e=>setCustom(e.target.value)}/><NativeSelect aria-label="新分支下一节点" className="h-9 min-w-0 rounded border bg-background px-2 text-xs" value={customTarget} onChange={e=>setCustomTarget(e.target.value)}><option value="">选择下一节点</option>{graph.nodes.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</NativeSelect></div><Button size="sm" variant="outline" disabled={!custom.trim()||!customTarget||graph.edges.length>=240} onClick={addBranch}><Plus className="size-3.5"/>添加分支</Button></div>}
   {editError&&<p role="alert" className="text-xs text-destructive">{editError}</p>}
   <div className="flex items-center justify-between border-t pt-4"><Button size="sm" variant="outline" disabled={graph.nodes.length>=80} onClick={duplicate}><Copy className="size-3.5"/>复制节点</Button><Button variant="ghost" size="sm" className="text-destructive" aria-label="删除选中节点" disabled={graph.nodes.length<=1} onClick={()=>setDeleting({kind:'node',id:node.id})}><Trash2 className="size-3.5"/>删除节点</Button></div>
  </fieldset>;
 }
}
