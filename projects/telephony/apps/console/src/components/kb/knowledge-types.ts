/*
 * 中文导读：知识库的 knowledge-types 组件，封装该界面的展示与交互。
 */
export type KnowledgeCategory={id:string;name:string};
export type KnowledgeCandidate={id:string;title:string;content:string;category:string;categoryId?:string|null;tags:string[];quote:string;needsConfirmation:boolean;requiresExpiry?:boolean;confirmed?:boolean;validUntil?:string|null};
export type KnowledgeAnalysis={summary?:string;keywords?:string[];removed?:string[];warnings?:string[];candidates?:KnowledgeCandidate[];reviewedEntries?:KnowledgeCandidate[];progress?:number;total?:number;acceptedIds?:string[];inserted?:number;duplicates?:number};
export type KnowledgeItem={id:string;kind:'note'|'document'|'source';title:string;name?:string;content?:string;preview?:string;agentId:string|null;categoryId:string|null;tags:string[];enabled:boolean;status:string;revision?:number;updatedAt?:string;deletedAt?:string|null;sourceTitle?:string;sourceQuote?:string;sourceKind?:string;validUntil?:string|null;sourceLink?:string;contentHash?:string;organizable?:boolean;characters?:number;analysis?:KnowledgeAnalysis;analysisModel?:string;error?:string;editable?:boolean;originStamp?:string;originalTitle?:string;upstreamChanged?:boolean};
export type KnowledgeLibrary={canManage:boolean;canDelete:boolean;categories:KnowledgeCategory[];items:KnowledgeItem[]};
export const knowledgeStatus:Record<string,string>={EXPIRED:'已过期',SOURCE:'现有资料',ENABLED:'已启用',DISABLED:'已停用',AVAILABLE:'待整理',QUEUED:'排队中',PROCESSING:'整理中',REVIEW:'待审核',COMPLETED:'已审核',NEEDS_REVIEW:'需核对'};
export function knowledgeDate(value?:string){return value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'—';}
