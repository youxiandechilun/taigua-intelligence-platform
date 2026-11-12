/*
 * 中文导读：线路与语音外呼：task-bulk-state.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type {CrmDb} from '../crm/crm.service.js';

// Any explicit single-task operation takes ownership away from the global
// pause batch, so a later bulk resume cannot undo a subsequent manual pause.
export async function detachTaskPauseBatch(db:CrmDb,workspaceId:string,id:string){
 await db.query(`UPDATE "SipTask" SET "snapshot"=jsonb_set("snapshot",'{adminPauseControl}',("snapshot"->'adminPauseControl')||$3::jsonb) WHERE "workspaceId"=$1 AND "id"=$2 AND "snapshot"->'adminPauseControl'->>'state'='PAUSED' RETURNING "id"`,[workspaceId,id,JSON.stringify({state:'MANUAL',resolvedAt:new Date().toISOString()})]);
}
