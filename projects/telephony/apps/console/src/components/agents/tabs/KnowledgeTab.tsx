/*
 * 中文导读：数字员工与话术的 KnowledgeTab 组件，封装该界面的展示与交互。
 */
"use client";
import { WorkspaceKnowledge } from "@/src/components/kb/WorkspaceKnowledge";
export function KnowledgeTab({agentId}:{agentId:string}){return <WorkspaceKnowledge agentId={agentId}/>;}
