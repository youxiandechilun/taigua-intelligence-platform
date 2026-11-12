/*
 * 中文导读：通话记录：call-summary.store.ts。维护共享状态及读写辅助。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';
import type { CrmDb } from '../crm/crm.service.js';
import { customerIntentEvidence, groundCallSummary, isAnsweringMachine, summaryEvaluation, summaryFields, type TranscriptLine } from './call-analysis.js';

export const intentQualificationVersion = 'assistant-intent-guard-20261102';

// Every persisted summary shares the same final adjudication. The database
// verifies the field and transcript digests before accepting a positive label.
// Neither an earlier model result nor a stale provisional label is sufficient.
export async function storeCallSummary(db: CrmDb, workspaceId: string, callId: string, candidate: unknown) {
  return db.transaction(async tx => {
    const source = (await tx.query(`SELECT "metadata","status" FROM "CallLog"
      WHERE "organizationId"=$1 AND "callId"=$2 AND "deleted"=false FOR UPDATE`, [workspaceId, callId]))[0];
    if (!source || !['COMPLETED', 'PROCESSED'].includes(String(source.status))) throw new BadRequestError('请等待通话结束后再整理。');
    const transcript = (await tx.query(`SELECT COALESCE(jsonb_agg(jsonb_build_object('speaker',"speaker",'messageText',"messageText") ORDER BY "timestamp","callTransId"),'[]'::jsonb) AS rows,
      md5(COALESCE(jsonb_agg(jsonb_build_array("speaker","messageText") ORDER BY "timestamp","callTransId"),'[]'::jsonb)::text) AS digest
      FROM "CallTranscript" WHERE "callLogId"=$1`, [callId]))[0]!;
    const rows = transcript.rows as TranscriptLine[];
    const safe = groundCallSummary(candidate, rows, source.metadata);
    if (!safe) throw new BadRequestError('通话整理结果格式不完整。');
    const evidence = customerIntentEvidence(rows, source.metadata);
    const qualification = {
      version: intentQualificationVersion, workspaceId, callId, intent: safe.intent,
      assistant: isAnsweringMachine(source.metadata) || evidence.blockedReason === 'ANSWERING_ASSISTANT',
      evidence: safe.intent === 'INTERESTED' ? evidence.interest : '',
      blockedReason: evidence.blockedReason, transcriptDigest: transcript.digest,
    };
    const saved = await tx.query(`UPDATE "CallLog" SET "dataExtracted"=$3::jsonb,
      "metadata"=COALESCE("metadata",'{}'::jsonb)||jsonb_build_object('finalIntent',$7::text,
        'customerIntentQualification',$4::jsonb||jsonb_build_object('fieldsDigest',md5($3::jsonb::text))),
      "dataEvaluation"=CASE WHEN $8::boolean THEN $5::jsonb ELSE "dataEvaluation" END
      WHERE "organizationId"=$1 AND "callId"=$2 AND "deleted"=false AND "status"::text IN ('COMPLETED','PROCESSED')
      AND (SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(t."speaker",t."messageText") ORDER BY t."timestamp",t."callTransId"),'[]'::jsonb)::text)
        FROM "CallTranscript" t WHERE t."callLogId"=$2)=$6::text RETURNING "callId"`,
      [workspaceId, callId, JSON.stringify(summaryFields(safe)), JSON.stringify(qualification), JSON.stringify(summaryEvaluation(safe)), transcript.digest, safe.intent, !!safe.quality]);
    if (saved.length !== 1) throw new BadRequestError('通话文字刚有更新，请稍后重新整理。');
    return safe;
  });
}
