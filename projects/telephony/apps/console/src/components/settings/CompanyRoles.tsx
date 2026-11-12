/*
 * 中文导读：设置中心的 CompanyRoles 组件，封装该界面的展示与交互。
 */
"use client";

import {useQuery} from '@tanstack/react-query';
import {companyApi,useCompanyContext,type FixedRoleKey} from '@/src/lib/api/resources/company';
import {Button} from '@/src/components/ui/button';

const details:Record<FixedRoleKey,{scope:string;usage:string;assignment:string}>={
 super_admin:{scope:'平台管理及获授权的工作区',usage:'线路、模型、全局设置、工作区与管理员账号。',assignment:'通过平台管理入口维护'},
 admin:{scope:'当前工作区的全部业务数据',usage:'员工、外呼任务、通话、客户、知识库、话术与录音素材。',assignment:'由超级管理员分配'},
 user:{scope:'本人及明确分配的数据',usage:'使用分配的数字员工、执行外呼、查看本人通话并跟进客户。',assignment:'由管理员或超级管理员分配'},
};

export function CompanyRoles({embedded=false}:{embedded?:boolean}){
 const context=useCompanyContext(),org=context.data?.organizationId;
 const allowed=context.data?.canManageRoles===true;
 const query=useQuery({queryKey:['company-roles',org],queryFn:()=>companyApi.roles(org!),enabled:Boolean(org&&allowed)});

 if(context.isPending)return <p role="status" className="p-5 text-sm text-muted-foreground">正在读取账号角色…</p>;
 if(context.error)return <p role="alert" className="p-5 text-sm text-destructive">{context.error.message}</p>;
 if(!allowed)return <p className="p-5 text-sm text-muted-foreground">账号角色由管理员维护。</p>;

 return <section aria-label="三种账号角色" className={embedded?'min-w-0':'overflow-hidden rounded-xl border bg-card'}>
  <div className="space-y-1 border-b px-5 py-4">
   <h2 className="text-sm font-semibold">账号角色</h2>
   <p className="text-sm leading-6 text-muted-foreground">选择身份即可使用对应功能。调整账号身份，请编辑员工资料。</p>
  </div>
  {query.isPending?<p role="status" className="p-5 text-sm text-muted-foreground">正在读取角色…</p>:query.error?<div role="alert" className="space-y-3 p-5"><p className="text-sm text-destructive">{query.error.message}</p><Button variant="outline" size="sm" onClick={()=>void query.refetch()}>重新加载</Button></div>:<>
   <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
     <caption className="sr-only">超级管理员、管理员、普通用户的功能和数据范围</caption>
     <thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr>{['账号角色','数据范围与功能','分配方式'].map(label=><th key={label} scope="col" className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
     <tbody>{query.data?.roles.map(role=>{
      const detail=role.roleKey?details[role.roleKey]:undefined;
      return <tr key={role.id} className="border-b align-top last:border-0">
       <th scope="row" className="whitespace-nowrap px-5 py-4 font-medium">{role.name}</th>
       <td className="min-w-64 px-5 py-4"><p>{detail?.scope||role.description}</p>{detail&&<p className="mt-1 text-xs leading-6 text-muted-foreground">{detail.usage}</p>}</td>
       <td className="min-w-44 px-5 py-4 text-xs leading-6 text-muted-foreground">{detail?.assignment||'请刷新后查看'}<p className="tabular-nums">{role.memberCount??0} 个账号</p></td>
      </tr>;
     })}</tbody>
    </table>
   </div>
   {!!query.data?.pendingRoleMappings&&<p role="status" className="border-t px-5 py-4 text-sm leading-6">还有 {query.data.pendingRoleMappings} 个账号使用旧角色，请在员工资料中逐一核对身份。</p>}
  </>}
 </section>;
}
