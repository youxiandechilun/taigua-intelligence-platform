/*
 * 中文导读：客户管理 / companies / [id]的路由页面；由 Next.js 按文件路由约定加载。
 */
import {CrmDetail} from "@/src/components/crm/CrmDetail";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <CrmDetail id={id}/>;}
