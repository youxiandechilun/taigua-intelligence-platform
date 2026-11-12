/*
 * 中文导读：共享基础能力的 use-call-permissions 钩子，复用组件状态和生命周期处理。
 */
"use client";
import {useCompanyContext,hasCompanyPermission} from '@/src/lib/api/resources/company';
export function useCanEndLiveCalls(organizationId:string){const context=useCompanyContext();return context.data?.organizationId===organizationId&&hasCompanyPermission(context.data,'callLogs','delete');}
