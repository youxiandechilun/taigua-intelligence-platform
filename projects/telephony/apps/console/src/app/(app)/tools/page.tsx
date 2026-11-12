/*
 * 中文导读：工具管理的路由页面；由 Next.js 按文件路由约定加载。
 */
import {redirect} from "next/navigation";
import { BusinessCenter } from "@/src/components/business/BusinessCenter";
export default async function ToolsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;
 if(params.tab==='follow')redirect('/crm/companies'+(params.filter==='interested'?'?status=INTERESTED':params.filter==='due'?'?due=true':''));
 if(params.tab==='wecom')redirect('/wecom');
 return <BusinessCenter />;
}
