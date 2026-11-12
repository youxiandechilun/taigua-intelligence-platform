/*
 * 中文导读：设置中心的 CompanyMembers 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import {useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {memberAccountError,normalizeMemberAccount} from '@/src/lib/member-batch';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Plus,Search,Pencil,KeyRound,UserRound,Power,Trash2,RotateCcw,Headset,ShieldCheck, Save, MoreHorizontal, RefreshCw, ArrowLeft, Settings2 } from 'lucide-react';
import {companyApi,useCompanyContext,useCompanyUnits,hasCompanyPermission,unitLabel,type CompanyMember,type MemberAssignment} from '@/src/lib/api/resources/company';
import {telephonyApi} from '@/src/lib/api/resources/telephony';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import type {Credentials} from '@/src/lib/api/resources/accounts';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Popover,PopoverTrigger,PopoverContent} from '@/src/components/ui/popover';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';
const MemberBatch=dynamic(()=>import('./CompanyMemberBatch').then(module=>module.CompanyMemberBatch),{ssr:false});
const RoleManager=dynamic(()=>import('./CompanyRoles').then(module=>module.CompanyRoles),{loading:()=> <p className="p-5 text-sm text-muted-foreground">正在加载角色…</p>});
const selectClass='h-10 w-full rounded-md border bg-background px-3 text-sm';
type Edit=MemberAssignment&{id?:string;userId?:string;username:string;originalUsername?:string;name:string;enabled:boolean;receptionOnly:boolean;canManageReception:boolean;reception:{phone:string;available:boolean}};
export function CompanyMembers({departmentFilter='',departmentIds=[],departmentLabel,onManageRoles}:{departmentFilter?:string;departmentIds?:string[];departmentLabel?:string;onManageRoles?:()=>void}){
 const identity=useAliyunIdentity(),context=useCompanyContext(),org=context.data?.organizationId,qc=useQueryClient();
 const allowed=Boolean(org&&(context.data?.canManageMembers||context.data?.canManageSeats));
 const [deletedView,setDeletedView]=useState(false);
 const [managingRoles,setManagingRoles]=useState(false);
 const [actionsId,setActionsId]=useState<string|null>(null);
 const members=useQuery({queryKey:['company-members',identity.user,org,deletedView],queryFn:()=>companyApi.members(org!,deletedView),enabled:allowed});
 const callback=useQuery({queryKey:['telephony',identity.user,org,'callback'],queryFn:()=>telephonyApi.callback(org!),enabled:allowed&&hasCompanyPermission(context.data,'lines','read'),retry:false});
 const units=useCompanyUnits(context.data);
 const roles=useQuery({queryKey:['company-assignable-roles',identity.user,org,context.data?.roleKey],queryFn:()=>companyApi.assignableRoles(org!),enabled:allowed&&context.data?.canManageMembers});
 const [search,setSearch]=useState(''),[roleFilter,setRoleFilter]=useState(''),[edit,setEdit]=useState<Edit|null>(null),[busy,setBusy]=useState(false),[credentials,setCredentials]=useState<Credentials|null>(null),[showPassword,setShowPassword]=useState(false);
 const [pending,setPending]=useState<{member:CompanyMember;kind:'reset'|'status'|'delete'|'restore'}|null>(null),[newPassword,setNewPassword]=useState(''),[handover,setHandover]=useState('');
 const [selection,setSelection]=useState<{scope:string;ids:string[]}>({scope:'',ids:[]});
 const [bulk,setBulk]=useState<{scope:string;ids:string[]}|null>(null),[bulkHandover,setBulkHandover]=useState('');
 const [bulkProgress,setBulkProgress]=useState({done:0,total:0});
 const [bulkResult,setBulkResult]=useState<{scope:string;success:number;failures:{id:string;name:string;message:string}[]}|null>(null);
 const bulkLock=useRef(false);
 const selectionScope=JSON.stringify([org,identity.user,deletedView,departmentFilter,departmentIds,roleFilter,search]);
 const canBulkDisable=!deletedView&&hasCompanyPermission(context.data,'companyMembers','delete');
 const canSelect=(member:CompanyMember)=>canBulkDisable&&member.canEdit&&member.enabled&&!member.deletedAt&&member.role!=='owner'&&member.userId!==identity.user;
 const visibleRoles=[...new Set((members.data||[]).map(m=>m.roleName))];
 const list=(members.data||[]).filter(m=>(!departmentFilter||(departmentFilter==='direct'?!m.departmentId:departmentIds.includes(m.departmentId||'')))&&(!roleFilter||m.roleName===roleFilter)&&`${m.name} ${m.username} ${m.roleName} ${m.department?.name||''} ${m.reception?.phone||''}`.toLowerCase().includes(search.toLowerCase()));
 const selectable=list.filter(canSelect);
 const selected=selection.scope===selectionScope?selectable.filter(member=>selection.ids.includes(member.id)):[];
 const selectedIds=new Set(selected.map(member=>member.id));
 const bulkTargets=bulk?.scope===selectionScope?(members.data||[]).filter(member=>bulk.ids.includes(member.id)&&canSelect(member)):[];
 function selectMembers(ids:string[]){setSelection({scope:selectionScope,ids});setBulkResult(null);}
 async function disableSelected(){
  if(bulkLock.current||!org||!bulk||bulk.scope!==selectionScope||!bulkTargets.length)return;
  const targets=[...bulkTargets],requestedOrg=org,scope=selectionScope;
  const receiver=bulkHandover;
  if(receiver&&targets.some(member=>member.userId===receiver)){toast.error('接替员工不能在本次禁用名单中');return;}
  bulkLock.current=true;setBusy(true);setBulkResult(null);setBulkProgress({done:0,total:targets.length});
  let success=0;
  const failures:{id:string;name:string;message:string}[]=[];
  try{
   // The existing endpoint rechecks permissions and work handover in a workspace transaction.
   for(const [index,member] of targets.entries()){
    try{await companyApi.update(requestedOrg,member.id,{enabled:false,...(receiver?{handoverTo:receiver}:{})});success++;}
    catch(error){failures.push({id:member.id,name:member.name,message:error instanceof Error?error.message:'禁用未完成，请刷新后核对账号状态'});}
    setBulkProgress({done:index+1,total:targets.length});
   }
   setBulkResult({scope,success,failures});
   setSelection({scope,ids:failures.map(member=>member.id)});
   setBulk(null);
   if(success)toast.success(`已禁用 ${success} 个账号${failures.length?`，${failures.length} 个未完成`:''}`);
   else toast.error('本次禁用未完成，请查看各账号原因');
   try{await Promise.all(['crm','business','wecom','automation','telephony','company-members','company-context','company-units','company-roles'].map(key=>qc.invalidateQueries({queryKey:[key]})));}
   catch{toast.error('操作结果已保留，列表刷新失败，请手动刷新核对');}
  }finally{bulkLock.current=false;setBusy(false);}
 }
 async function run(fn:()=>Promise<unknown>){
  setBusy(true);
  try{await fn();await Promise.all(['crm','business','wecom','automation','telephony','company-members','company-context','company-units','company-roles'].map(key=>qc.invalidateQueries({queryKey:[key]})));}
  catch(e){toast.error(e instanceof Error?e.message:'操作未完成');}
  finally{setBusy(false);}
 }
 const localPreview=process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true';
 const accountChanged=Boolean(edit?.id&&edit.originalUsername!==undefined&&normalizeMemberAccount(edit.username)!==normalizeMemberAccount(edit.originalUsername));
 const accountError=edit&&!edit.receptionOnly&&(!edit.id||accountChanged)?memberAccountError(edit.username)||((members.data||[]).some(member=>member.id!==edit.id&&normalizeMemberAccount(member.username)===normalizeMemberAccount(edit.username))?'此登录账号已被使用，请更换':''):'';
 const newRole=roles.data?.find(r=>r.rank===100)||roles.data?.at(-1);
 const canAddReception=['create','update'].some(action=>hasCompanyPermission(context.data,'seats',action));
 function openEmployee(m:CompanyMember,receptionOnly=false){
  setEdit({id:m.id,userId:m.userId,name:m.name,username:m.username,originalUsername:m.username,expectedAccessRevision:m.accessRevision,departmentId:m.departmentId,companyRoleId:m.companyRoleId,scopeDepartmentIds:[],enabled:m.enabled,receptionOnly,canManageReception:m.canManageReception,reception:{phone:m.reception?.phone||'',available:m.reception?.available||false}});
 }
 function moreActions(m:CompanyMember){
  const sync=m.canManageReception&&callback.data?.connected&&m.reception?.phone&&!callback.data.employees.find(e=>e.userId===m.userId)?.ready;
  const reset=m.canEdit&&hasCompanyPermission(context.data,'companyMembers','resetPassword');
  const status=m.canEdit&&hasCompanyPermission(context.data,'companyMembers',m.enabled?'delete':'update');
  const remove=m.canEdit&&m.role!=='owner'&&hasCompanyPermission(context.data,'companyMembers','delete');
  if(!sync&&!reset&&!status&&!remove)return null;
  return <Popover open={actionsId===m.id} onOpenChange={open=>setActionsId(open?m.id:null)}><PopoverTrigger asChild><Button type="button" size="icon-sm" variant="outline" aria-label={'更多操作：'+m.name} disabled={busy}><MoreHorizontal aria-hidden="true" className="size-4"/></Button></PopoverTrigger><PopoverContent align="end" className="w-44 rounded-lg p-1"><div role="group" aria-label={m.name+'的更多操作'} className="grid gap-0.5">
   {sync&&<Button type="button" size="sm" variant="ghost" className="w-full justify-start font-normal" disabled={busy} onClick={()=>{setActionsId(null);void run(async()=>{const result=await telephonyApi.syncCallbackEmployee(org!,m.userId);if(result.synced)toast.success(result.message);else toast.error(result.message);});}}><RefreshCw aria-hidden="true" className="size-3.5"/>同步回拨</Button>}
   {reset&&<Button type="button" size="sm" variant="ghost" className="w-full justify-start font-normal" disabled={busy} onClick={()=>{setActionsId(null);setNewPassword('');setPending({member:m,kind:'reset'});}}><KeyRound aria-hidden="true" className="size-3.5"/>重置密码</Button>}
   {status&&<Button type="button" size="sm" variant="ghost" className="w-full justify-start font-normal" disabled={busy} onClick={()=>{setActionsId(null);setHandover('');setPending({member:m,kind:'status'});}}><Power aria-hidden="true" className="size-3.5"/>{m.enabled?'停用员工':'启用员工'}</Button>}
   {remove&&<><div className="my-1 border-t"/><Button type="button" size="sm" variant="ghost" className="w-full justify-start font-normal text-destructive hover:bg-destructive/5 hover:text-destructive" disabled={busy} onClick={()=>{setActionsId(null);setHandover('');setPending({member:m,kind:'delete'});}}><Trash2 aria-hidden="true" className="size-3.5"/>删除员工</Button></>}
  </div></PopoverContent></Popover>;
 }
 async function saveEmployee(){
  if(!edit)return;
  if(edit.receptionOnly){
   await telephonyApi.saveSeat(org!,edit.userId!,edit.reception);
   toast.success('员工接听设置已更新');
  }else{
   if(accountError)throw new Error(accountError);
   const assignment:MemberAssignment={name:edit.name,...(edit.id?{expectedAccessRevision:edit.expectedAccessRevision}:{}),...(accountChanged?{username:normalizeMemberAccount(edit.username),expectedUsername:edit.originalUsername!}:{}),departmentId:edit.departmentId,companyRoleId:edit.companyRoleId,scopeDepartmentIds:[],...(edit.canManageReception?{reception:edit.reception}:{})};
   if(edit.id){await companyApi.assignment(org!,edit.id,assignment);toast.success(localPreview?'员工资料已保存到本地草稿':'员工资料与角色已更新，员工重新登录后使用当前角色');}
   else{const error=memberAccountError(edit.username);if(error)throw new Error(error);setCredentials(await companyApi.create(org!,{...assignment,username:edit.username,name:edit.name}));setShowPassword(false);toast.success('员工账号已创建');}
  }
  setEdit(null);
 }
 if(context.isPending)return <p className="p-5 text-sm text-muted-foreground">正在读取公司权限…</p>;
 if(context.error)return <p role="alert" className="text-sm text-destructive">{context.error.message}</p>;
 if(!allowed)return <p className="text-sm text-muted-foreground">当前账号没有员工管理权限。</p>;
 return <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
  <div className="space-y-4 border-b px-5 py-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
   <h2 className="text-sm font-semibold">{deletedView?'已删除员工':departmentLabel?departmentLabel+'员工':'员工账号'} <span className="ml-2 font-normal text-muted-foreground">{list.length}</span></h2>
   <div className="flex flex-wrap items-center gap-2">
    {onManageRoles&&<Button size="sm" variant="outline" onClick={onManageRoles}><ShieldCheck className="size-4"/>角色权限</Button>}
    {context.data?.canManageMembers&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>setDeletedView(v=>!v)}>{deletedView?<ArrowLeft aria-hidden="true" className="size-3.5"/>:<Trash2 aria-hidden="true" className="size-3.5"/>}{deletedView?'返回员工列表':'已删除员工'}</Button>}
   </div></div>
   <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2">
    <div className="relative"><Search aria-hidden="true" className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input aria-label="搜索员工" className="h-9 w-52 pl-9" disabled={busy} value={search} onChange={e=>setSearch(e.target.value)} placeholder="姓名、账号、部门或电话"/></div>
    <NativeSelect aria-label="筛选员工角色" className="h-9 max-w-40 rounded-md border bg-background px-2 text-xs" disabled={busy} value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="">全部角色</option>{visibleRoles.map(role=><option key={role} value={role}>{role}</option>)}</NativeSelect></div><div className="ml-auto flex items-center gap-2">
    {!deletedView&&hasCompanyPermission(context.data,'companyMembers','create')&&context.data&&org&&<MemberBatch key={`${org}:${identity.user}`} org={org} actor={identity.user} context={context.data} units={units.data||[]} roles={roles.data||[]} members={members.data||[]} initialDepartment={departmentFilter&&departmentFilter!=='direct'?departmentFilter:context.data.allData?null:units.data?.[0]?.id??null} disabled={busy||roles.isPending||units.isPending||!!roles.error||!!units.error||!!members.error}/>}
    {!deletedView&&hasCompanyPermission(context.data,'companyMembers','create')&&<Button size="sm" disabled={busy||roles.isPending||!!roles.error} onClick={()=>setEdit({username:'',name:'',departmentId:departmentFilter&&departmentFilter!=='direct'?departmentFilter:context.data?.allData?null:units.data?.[0]?.id??null,companyRoleId:newRole?.id??null,scopeDepartmentIds:[],enabled:true,receptionOnly:false,canManageReception:canAddReception,reception:{phone:'',available:false}})}><Plus className="size-4"/>新增员工</Button>}
   </div></div>
  </div>
  {canBulkDisable&&<div className="flex flex-wrap items-center gap-3 border-b bg-muted/10 px-5 py-3">
   <span className="text-sm" aria-live="polite">已选 <strong className="tabular-nums">{selected.length}</strong> 个账号</span>
   <Button size="sm" variant="outline" disabled={busy||!selectable.length} onClick={()=>selectMembers(selected.length===selectable.length?[]:selectable.map(member=>member.id))}>{selected.length===selectable.length&&selected.length?'取消全选':'全选当前筛选结果'}</Button>
   <Button size="sm" variant="destructive" disabled={busy||!!members.error||!selected.length} onClick={()=>{setBulk({scope:selectionScope,ids:selected.map(member=>member.id)});setBulkHandover('');setBulkResult(null);}}><Power aria-hidden="true" className="size-3.5"/>批量禁用{selected.length?`（${selected.length}）`:''}</Button>
   {selected.length>0&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>selectMembers([])}>清空选择</Button>}
   <span className="text-xs text-muted-foreground">仅可勾选有权管理的正常账号</span>
  </div>}
  {bulkResult?.scope===selectionScope&&<div role="status" className="space-y-2 border-b px-5 py-3 text-sm"><div className="flex items-center justify-between gap-3"><p>已禁用 {bulkResult.success} 个，未完成 {bulkResult.failures.length} 个。</p><Button size="sm" variant="ghost" disabled={busy} onClick={()=>setBulkResult(null)}>收起结果</Button></div>{bulkResult.failures.length>0&&<><p className="text-xs text-muted-foreground">未完成的账号保留勾选，处理下方原因后可再次提交。</p><ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-destructive">{bulkResult.failures.map(failure=><li key={failure.id}><strong>{failure.name}</strong>：{failure.message}</li>)}</ul></>}</div>}
  {(members.error||roles.error||units.error)&&<p role="alert" className="p-5 text-sm text-destructive">{(members.error||roles.error||units.error)?.message}</p>}
  <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
   <thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr>{canBulkDisable&&<th className="w-12 px-4 py-3"><input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label="全选当前筛选结果中的可禁用账号" checked={selectable.length>0&&selected.length===selectable.length} ref={element=>{if(element)element.indeterminate=selected.length>0&&selected.length<selectable.length;}} disabled={busy||!selectable.length||!!members.error} onChange={event=>selectMembers(event.target.checked?selectable.map(member=>member.id):[])}/></th>}{['员工 / 登录账号','所属部门','角色','接听号码','工作状态','账号状态','操作'].map(h=><th key={h} className={h==='操作'?"sticky right-0 z-10 border-l bg-card px-4 py-3 text-right font-medium":"whitespace-nowrap px-4 py-3 font-medium"}>{h}</th>)}</tr></thead>
   <tbody>{list.map(m=><tr key={m.id} className={"border-b last:border-0 "+(selectedIds.has(m.id)?"bg-primary/5":"")}>
    {canBulkDisable&&<td className="px-4"><input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={"选择禁用账号："+m.name} title={canSelect(m)?"选择此账号":m.userId===identity.user?"不能禁用当前登录账号":m.role==='owner'?"公司负责人不参与批量禁用":!m.enabled?"账号已停用":"无权禁用此账号"} checked={selectedIds.has(m.id)} disabled={busy||!canSelect(m)||!!members.error} onChange={event=>selectMembers(event.target.checked?[...selectedIds,m.id]:[...selectedIds].filter(id=>id!==m.id))}/></td>}
    <td className="px-4 py-4"><div className="flex items-center gap-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="size-4"/></span><div className="min-w-28"><p className="max-w-40 truncate font-medium" title={m.name}>{m.name}</p><p className="mt-1 max-w-40 truncate text-xs text-muted-foreground" title={m.username}>{m.username}</p></div></div></td>
    <td className="px-4"><span className="block min-w-28 max-w-40 truncate" title={units.data?.find(u=>u.id===m.departmentId)?unitLabel(units.data.find(u=>u.id===m.departmentId)!,units.data):undefined}>{m.department?.name||'公司直属'}</span></td>
    <td className="whitespace-nowrap px-4">{m.roleName}</td>
    <td className="whitespace-nowrap px-4 tabular-nums">{m.reception?.phone||<span className="text-xs text-muted-foreground">未设置</span>}{callback.data?.configured&&m.reception?.phone&&<p className="mt-1 text-xs text-muted-foreground">{callback.data.employees.find(e=>e.userId===m.userId)?.ready?'回拨已同步':'回拨待同步'}</p>}</td>
    <td className="whitespace-nowrap px-4"><span className="inline-flex items-center gap-1.5 text-xs"><span className={'size-1.5 rounded-full '+(m.enabled&&m.reception?.available?'bg-emerald-500':'bg-muted-foreground/40')}/>{m.enabled&&m.reception?.available?'在岗':m.reception?.phone?'离岗':'未配置'}</span></td>
    <td className="whitespace-nowrap px-4 text-xs text-muted-foreground">{m.deletedAt?'已删除':m.enabled?'正常':'已停用'}</td>
    <td className="sticky right-0 z-10 min-w-36 whitespace-nowrap border-l bg-card px-4"><div className="flex items-center justify-end gap-1.5">{m.canEdit&&m.deletedAt?hasCompanyPermission(context.data,'companyMembers','update')&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>setPending({member:m,kind:'restore'})}><RotateCcw className="size-3.5"/>恢复</Button>:!m.deletedAt?<>
     {m.canEdit&&hasCompanyPermission(context.data,'companyMembers','update')?<Button size="sm" variant="outline" className="border-primary/20 text-primary hover:bg-primary/5 hover:text-primary" disabled={busy||roles.isPending} onClick={()=>openEmployee(m)}><Pencil className="size-3.5"/>编辑</Button>:m.canManageReception&&<Button size="sm" variant="outline" className="border-primary/20 text-primary hover:bg-primary/5 hover:text-primary" disabled={busy} onClick={()=>openEmployee(m,true)}><Headset className="size-3.5"/>接听设置</Button>}
     {moreActions(m)}
    </>:<span className="text-xs text-muted-foreground">—</span>}</div></td>
   </tr>)}</tbody>
  </table>{members.isPending&&<p className="p-5 text-sm text-muted-foreground">正在加载员工…</p>}{!members.isPending&&!list.length&&!members.error&&<p className="p-10 text-center text-sm text-muted-foreground">没有匹配的员工。</p>}</div>
  <Dialog open={!!bulk&&bulk.scope===selectionScope} onOpenChange={open=>{if(!open&&!busy)setBulk(null);}}><DialogContent className="sm:max-w-lg" onInteractOutside={event=>{if(busy)event.preventDefault();}} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>批量禁用 {bulkTargets.length} 个员工账号</DialogTitle><DialogDescription>禁用后，这些员工将无法访问当前公司，客户和历史记录保留。有未结束外呼任务的账号需要先结束任务；有客户或待办工作的账号需选择接替员工。</DialogDescription></DialogHeader>
   <div className="max-h-36 overflow-y-auto rounded-md border p-3 text-sm">{bulkTargets.map(member=><p key={member.id} className="py-0.5">{member.name}<span className="ml-2 text-xs text-muted-foreground">{member.username}</span></p>)}</div>
   <label className="grid gap-2 text-sm">统一接替员工<NativeSelect aria-label="批量禁用接替员工" className={selectClass} disabled={busy} value={bulkHandover} onChange={event=>setBulkHandover(event.target.value)}><option value="">无待交接工作时可不选</option>{context.data?.assignees.filter(assignee=>!bulkTargets.some(member=>member.userId===assignee.id)).map(assignee=><option key={assignee.id} value={assignee.id}>{assignee.name}{assignee.department?' · '+assignee.department.name:''}</option>)}</NativeSelect></label>
   {busy&&<p role="status" aria-live="polite" className="text-sm text-muted-foreground">正在处理 {bulkProgress.done} / {bulkProgress.total}，请稍候…</p>}
   <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setBulk(null)}>取消</Button><Button variant="destructive" disabled={busy||!!members.error||!bulkTargets.length} onClick={()=>void disableSelected()}>{busy?'正在禁用…':`确认禁用 ${bulkTargets.length} 个账号`}</Button></div>
  </DialogContent></Dialog>
  <Dialog open={!!edit} onOpenChange={v=>{if(!v&&!busy)setEdit(null);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
   <DialogHeader><DialogTitle>{edit?.receptionOnly?'员工接听设置':edit?.id?'编辑员工':'新增员工'}</DialogTitle><DialogDescription>{edit?.receptionOnly?'先接听此号码，再连接客户。':edit?.id?'员工资料、部门和接听号码统一保存。':'填写员工资料，可同时配置通话接听。'}</DialogDescription></DialogHeader>
   {edit&&<form className="space-y-5" onSubmit={e=>{e.preventDefault();void run(saveEmployee);}}>
    <fieldset disabled={busy||edit.receptionOnly} className="grid gap-4 sm:grid-cols-2">
     <label className="grid gap-2 text-sm">员工姓名<Input required maxLength={80} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label>
     <label className="grid gap-2 text-sm">登录账号<Input required aria-label="员工登录账号" aria-invalid={!!accountError} aria-describedby="member-login-hint" autoComplete="off" maxLength={40} placeholder="支持中文、字母或数字" value={edit.username} onChange={e=>setEdit({...edit,username:e.target.value})}/><span id="member-login-hint" className={accountError?"text-xs text-destructive":"text-xs leading-5 text-muted-foreground"}>{accountError|| (accountChanged?(localPreview?"本地草稿；正式更新后使用新账号登录，密码不变。":"保存后使用新账号登录，密码保持不变。"):"支持修改，账号需保持唯一。")}</span></label>
     <label className="grid gap-2 text-sm">所属部门<NativeSelect aria-label="员工所属部门" className={selectClass} value={edit.departmentId||''} onChange={e=>setEdit({...edit,departmentId:e.target.value||null})}>{(context.data?.allData||edit.receptionOnly)&&<option value="">公司直属</option>}{units.data?.map(u=><option key={u.id} value={u.id}>{unitLabel(u,units.data||[])}</option>)}</NativeSelect></label>
     <div className="grid content-start gap-2 text-sm"><div className="flex h-5 items-center justify-between gap-2"><label htmlFor="member-company-role">账号角色</label>{context.data?.canManageRoles&&<Button type="button" variant="ghost" size="xs" className="h-6 px-1 text-xs text-primary" onClick={()=>setManagingRoles(true)}><Settings2 aria-hidden="true" className="size-3"/>角色说明</Button>}</div><NativeSelect id="member-company-role" required className={selectClass} value={edit.companyRoleId||''} onChange={e=>setEdit({...edit,companyRoleId:e.target.value||null,scopeDepartmentIds:[]})}><option value="" disabled>请选择角色</option>{roles.data?.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</NativeSelect><span className="text-xs leading-5 text-muted-foreground">管理员由超级管理员分配，普通用户使用本人及分配的数据。</span></div>
    </fieldset>
    {edit.canManageReception&&<fieldset disabled={busy} className="space-y-3 border-t pt-4">
     <legend className="sr-only">通话接听</legend><div className="flex items-center gap-2 text-sm font-medium"><Headset className="size-4 text-primary"/>通话接听</div>
     <label className="grid gap-2 text-sm">接听电话号码<Input type="tel" inputMode="tel" pattern="(1[3-9][0-9]{9}|0[0-9]{9,11})?" maxLength={13} placeholder="手机号或带区号座机" value={edit.reception.phone} onChange={e=>{const phone=e.target.value.replace(/[^0-9]/g,'');setEdit({...edit,reception:{phone,available:phone?edit.reception.available:false}});}}/></label>
     <label className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5"><span className="text-sm">在岗接听</span><input type="checkbox" role="switch" aria-label="员工在岗接听" className="size-4 accent-[var(--primary)]" disabled={!edit.reception.phone||!edit.enabled} checked={edit.reception.available} onChange={e=>setEdit({...edit,reception:{...edit.reception,available:e.target.checked}})}/></label>
     {!edit.enabled&&<p className="text-xs text-muted-foreground">启用员工账号后可以设为在岗。</p>}
    </fieldset>}
    <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={()=>setEdit(null)}>取消</Button><Button disabled={busy||!!accountError||(!edit.id&&!edit.companyRoleId)}><Save aria-hidden="true" className="size-4" />{busy?'保存中…':edit.id?(localPreview?'保存本地草稿':'保存设置'):'创建账号'}</Button></div>
   </form>}
  </DialogContent></Dialog>
 <Dialog open={!!credentials} onOpenChange={v=>{if(!v){setCredentials(null);setShowPassword(false);}}}><DialogContent><DialogHeader><DialogTitle>员工登录信息</DialogTitle><DialogDescription>密码仅此次展示，请交给对应员工。</DialogDescription></DialogHeader>{credentials&&<div className="space-y-3"><Input aria-label="生成的员工账号" readOnly value={credentials.username}/><Input aria-label="生成的员工密码" readOnly type={showPassword?'text':'password'} value={credentials.password}/><div className="flex gap-2"><Button variant="outline" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'隐藏密码':'显示密码'}</Button><Button onClick={async()=>{try{await navigator.clipboard.writeText(`登录地址：${location.origin}\n账号：${credentials.username}\n密码：${credentials.password}`);toast.success('已复制登录信息');}catch{toast.error('复制失败，请手动保存');}}}>复制登录信息</Button></div></div>}</DialogContent></Dialog>
 <Dialog open={!!pending} onOpenChange={v=>{if(!v&&!busy)setPending(null);}}><DialogContent><DialogHeader>
 <DialogTitle>{pending?.kind==='reset'?'重置员工密码':pending?.kind==='delete'?'删除员工账号':pending?.kind==='restore'?'恢复员工账号':pending?.member.enabled?'停用与工作交接':'启用员工'}</DialogTitle>
 <DialogDescription>{pending?.member.name}：{pending?.kind==='reset'?'原密码及登录会话将失效。':pending?.kind==='delete'?'删除后无法访问本公司。客户和历史记录保留，可在已删除员工中恢复。':pending?.kind==='restore'?'恢复后保持停用，核对角色和所属组织后再启用。':pending?.member.enabled?'停用后停止访问本公司。客户与待办工作需要交接，历史记录保留。':'恢复访问本公司，原权限继续生效。'}</DialogDescription></DialogHeader>
 {pending?.kind==='reset'?<label className="grid gap-2 text-sm">新密码（选填）<Input type="password" autoComplete="new-password" value={newPassword} minLength={8} maxLength={72} placeholder="留空自动生成" onChange={e=>setNewPassword(e.target.value)}/></label>:(pending?.kind==='delete'||pending?.kind==='status'&&pending.member.enabled)?<label className="grid gap-2 text-sm">接替员工<NativeSelect className={selectClass} value={handover} onChange={e=>setHandover(e.target.value)}><option value="">没有待交接工作</option>{context.data?.assignees.filter(a=>a.id!==pending.member.userId).map(a=><option key={a.id} value={a.id}>{a.name}{a.department?' · '+a.department.name:''}</option>)}</NativeSelect></label>:null}
 <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setPending(null)}>取消</Button><Button variant={pending?.kind==='delete'?'destructive':'default'} disabled={busy||(pending?.kind==='reset'&&newPassword.length>0&&newPassword.length<8)} onClick={()=>void run(async()=>{if(!pending)return;const {member,kind}=pending;
 if(kind==='reset'){setCredentials(await companyApi.reset(org!,member.id,newPassword||undefined));setShowPassword(false);}
 else if(kind==='delete'){await companyApi.remove(org!,member.id,handover||undefined);toast.success('员工已删除，可在已删除员工中恢复');}
 else if(kind==='restore'){await companyApi.restore(org!,member.id);toast.success('员工已恢复，请核对权限后启用');}
 else{await companyApi.update(org!,member.id,{enabled:!member.enabled,...(handover?{handoverTo:handover}:{})});toast.success('员工状态已更新');}setPending(null);})}>{busy?'处理中…':pending?.kind==='delete'?'确认删除':pending?.kind==='restore'?'确认恢复':'确认'}</Button></div></DialogContent></Dialog>
 <Dialog open={managingRoles&&Boolean(context.data?.canManageRoles)} onOpenChange={setManagingRoles}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>账号角色说明</DialogTitle><DialogDescription>系统使用超级管理员、管理员和普通用户三种身份。</DialogDescription></DialogHeader>{managingRoles&&<RoleManager embedded/>}</DialogContent></Dialog>
 </section>;
}
