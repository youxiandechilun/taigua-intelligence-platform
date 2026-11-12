/*
 * 中文导读：知识库的路由页面；由 Next.js 按文件路由约定加载。
 */
import { WorkspaceKnowledge } from "@/src/components/kb/WorkspaceKnowledge";
export default async function KbPage({searchParams}:{searchParams:Promise<{documentId?:string;trash?:string}>}){
 const params=await searchParams;
 return <WorkspaceKnowledge initialDocumentId={typeof params.documentId==='string'?params.documentId:undefined} initialTrash={params.trash==='true'}/>;
}
