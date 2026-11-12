/*
 * 中文导读：设置中心的 CompanyPeople 组件，封装该界面的展示与交互。
 */
"use client";

import {useState} from 'react';
import dynamic from 'next/dynamic';
import {Building2,UsersRound,ShieldCheck,Settings2} from 'lucide-react';
import {useCompanyContext,useCompanyUnits,unitLabel,type OrganizationUnit} from '@/src/lib/api/resources/company';
import {CompanyMembers} from './CompanyMembers';
import {Button} from '@/src/components/ui/button';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/src/components/ui/sheet';

const loading=()=> <p role="status" className="p-5 text-sm text-muted-foreground">正在加载设置…</p>;
const OrganizationSettings=dynamic(()=>import('./OrganizationSettings').then(m=>m.OrganizationSettings),{loading});
const CompanyRoles=dynamic(()=>import('./CompanyRoles').then(m=>m.CompanyRoles),{loading});
type Panel='departments'|'roles'|null;

function branchIds(id:string,units:OrganizationUnit[]){
 const ids=new Set([id]);
 for(let changed=true;changed;){changed=false;for(const unit of units)if(unit.parentId&&ids.has(unit.parentId)&&!ids.has(unit.id)){ids.add(unit.id);changed=true;}}
 return [...ids];
}

export function CompanyPeople({initialPanel=null}:{initialPanel?:Panel}){
 const context=useCompanyContext(),units=useCompanyUnits(context.data);
 const [selected,setSelected]=useState(''),[includeChildren,setIncludeChildren]=useState(true),[panel,setPanel]=useState<Panel>(initialPanel);
 const access=context.data;
 const canSeeMembers=Boolean(access?.canManageMembers||access?.canManageSeats);
 const allUnits=units.data||[];
 const activeUnit=allUnits.find(unit=>unit.id===selected);
 const department=selected==='direct'&&access?.allData?'direct':activeUnit?.id||'';
 const descendants=activeUnit?branchIds(activeUnit.id,allUnits):[];
 const ordered=[...allUnits].sort((a,b)=>unitLabel(a,allUnits).localeCompare(unitLabel(b,allUnits),'zh-CN'));
 const panelAllowed=panel==='departments'?access?.canManageDepartments:panel==='roles'?access?.canManageRoles:false;
 const selectionClass=(active:boolean)=>'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '+(active?'bg-primary/10 font-medium text-primary':'text-muted-foreground hover:bg-muted/50 hover:text-foreground');
 if(context.isPending)return <p role="status" className="p-5 text-sm text-muted-foreground">正在加载组织与人员…</p>;
 if(context.error)return <p role="alert" className="text-sm text-destructive">{context.error.message}</p>;
 return <div className="space-y-4">
  {canSeeMembers?<div className="grid min-w-0 items-start gap-4 xl:grid-cols-[210px_minmax(0,1fr)]">
   <aside className="min-w-0 rounded-xl border bg-card" aria-label="组织架构">
    <div className="flex items-center justify-between gap-2 border-b px-4 py-3"><h2 className="text-sm font-semibold">组织架构</h2>{access?.canManageDepartments&&<Button variant="ghost" size="icon" className="size-8" aria-label="管理部门" title="管理部门" onClick={()=>setPanel('departments')}><Settings2 className="size-4"/></Button>}</div>
    <nav aria-label="按组织筛选员工" className="grid gap-1 p-2 sm:grid-cols-2 xl:grid-cols-1">
     <button type="button" aria-pressed={!department} className={selectionClass(!department)} onClick={()=>setSelected('')}><UsersRound className="size-4 shrink-0"/>{access?.allData?'全部员工':'授权范围内员工'}</button>
     {access?.allData&&<button type="button" aria-pressed={department==='direct'} className={selectionClass(department==='direct')} onClick={()=>setSelected('direct')}><Building2 className="size-4 shrink-0"/>公司直属</button>}
     {ordered.map(unit=>{const label=unitLabel(unit,allUnits),depth=Math.min(label.split(' / ').length-1,4);return <button key={unit.id} type="button" title={label} aria-pressed={department===unit.id} className={selectionClass(department===unit.id)} style={{paddingLeft:12+depth*14}} onClick={()=>setSelected(unit.id)}><Building2 className="size-4 shrink-0"/><span className="truncate">{unit.name}</span></button>;})}
    </nav>
    {units.isPending?<p role="status" className="px-4 pb-4 text-xs text-muted-foreground">正在加载部门…</p>:units.error?<p role="alert" className="px-4 pb-4 text-xs text-destructive">{units.error.message}</p>:!ordered.length&&<p className="px-4 pb-4 text-xs text-muted-foreground">暂无部门</p>}
    {activeUnit&&descendants.length>1&&<label className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground"><input type="checkbox" checked={includeChildren} onChange={e=>setIncludeChildren(e.target.checked)}/>包含下级部门</label>}
   </aside>
   <div className="min-w-0"><CompanyMembers departmentFilter={department} departmentIds={includeChildren?descendants:activeUnit?[activeUnit.id]:[]} departmentLabel={activeUnit?.name||(department==='direct'?'公司直属':undefined)} onManageRoles={access?.canManageRoles?()=>setPanel('roles'):undefined}/></div>
  </div>:access?.canManageDepartments?<OrganizationSettings/>:access?.canManageRoles?<CompanyRoles/>:<p className="text-sm text-muted-foreground">当前账号没有组织与人员管理权限。</p>}
  {!canSeeMembers&&access?.canManageDepartments&&access?.canManageRoles&&<Button variant="outline" onClick={()=>setPanel('roles')}><ShieldCheck className="size-4"/>账号角色</Button>}
  <Sheet open={Boolean(panel&&panelAllowed)} onOpenChange={open=>{if(!open)setPanel(null);}}><SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
   <SheetHeader className="border-b px-5 py-5 pr-14"><SheetTitle>{panel==='roles'?'账号角色':'部门管理'}</SheetTitle><SheetDescription className="sr-only">在当前公司内管理组织、员工和访问权限。</SheetDescription></SheetHeader>
   <div className="p-5">{panel==='departments'&&panelAllowed?<OrganizationSettings embedded/>:panel==='roles'&&panelAllowed?<CompanyRoles embedded/>:null}</div>
  </SheetContent></Sheet>
 </div>;
}
