/*
 * 中文导读：线路与语音外呼：voice-management.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {crmDb} from '../crm/crm.db.js';
import type {CrmDb} from '../crm/crm.service.js';
import {BadRequestError} from '../../common/errors/badRequest.js';

export async function blockedBuiltinVoices(workspaceId:string,db:CrmDb=crmDb) {
 const rows=await db.query('SELECT "targetModel","voice" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "provider"=\'BUILTIN\' AND ("enabled"=false OR "deletedAt" IS NOT NULL)',[workspaceId]);
 return new Set(rows.map(row=>row.targetModel+'\0'+row.voice));
}

export async function assertBuiltinVoiceEnabled(workspaceId:string,model:string,voice:string,db:CrmDb=crmDb) {
 if((await blockedBuiltinVoices(workspaceId,db)).has(model+'\0'+voice))throw new BadRequestError('所选系统音色已停用或删除，请在声音库启用或重新选择。');
}
