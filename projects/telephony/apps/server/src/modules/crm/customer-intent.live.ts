/*
 * 中文导读：客户管理：customer-intent.live.ts。相关类型、配置或辅助实现集中在本文件。
 */
// All customer-library reads share this projection. It never writes customer
// tables or changes a manually maintained customer. $1 is always workspaceId.
export const effectiveIntentCtes = `WITH live_attempt_calls AS (
  SELECT a."workspaceId",a."id" AS "callId",p.phone,l."userId" AS "ownerId",
    l."startTime" AS "at",a."lastEventAt" AS "observedAt",
    left(COALESCE(NULLIF(l."metadata"->>'matchedEvidence',''),l."metadata"->>'provisionalEvidence',''),600) AS evidence
  FROM "SipAttempt" a
  JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId"
  JOIN "CallLog" l ON l."organizationId"=a."workspaceId" AND l."callId"=a."id"
  CROSS JOIN LATERAL (
    SELECT regexp_replace(COALESCE(CASE WHEN lower(l."direction")='inbound' THEN l."callerId" ELSE COALESCE(l."metadata"->>'toNumber',l."callerId") END,''),'[[:space:]()\\-]','','g') AS raw_phone
  ) raw
  CROSS JOIN LATERAL (
    SELECT CASE WHEN raw.raw_phone ~ '^(\\+86|0086)1[0-9]{10}$' THEN regexp_replace(raw.raw_phone,'^(\\+86|0086)','','g') ELSE raw.raw_phone END AS phone
  ) p
  WHERE a."workspaceId"=$1 AND a."status"='CONNECTED' AND a."finishedAt" IS NULL
    AND a."leaseUntil">NOW() AND a."startedAt" IS NOT NULL AND a."startedAt"<=NOW()+INTERVAL '1 minute'
    AND a."lastEventAt" IS NOT NULL AND a."lastEventAt"<=NOW()+INTERVAL '1 minute'
    AND t."deletedAt" IS NULL AND l."deleted"=false AND l."status"='IN_PROGRESS' AND l."endTime" IS NULL
    AND l."startTime" IS NOT NULL AND l."startTime"<=NOW()+INTERVAL '1 minute'
    AND a."result"->'liveIntentEligible'='true'::jsonb AND l."metadata"->'liveIntentEligible'='true'::jsonb
    AND a."result"->>'provisionalIntent'='interested' AND l."metadata"->>'provisionalIntent'='interested'
    AND COALESCE(t."snapshot"->>'demoCall','false')<>'true' AND COALESCE(t."snapshot"->>'testCall','false')<>'true'
    AND COALESCE(l."metadata"->>'demoCall','false')<>'true' AND COALESCE(l."metadata"->>'testCall','false')<>'true'
    AND COALESCE(a."result"->>'answeringMachineDetected','false')<>'true' AND COALESCE(l."metadata"->>'answeringMachineDetected','false')<>'true'
    AND COALESCE(a."result"->'assistantDetection'->>'detected','false')<>'true' AND COALESCE(l."metadata"->'assistantDetection'->>'detected','false')<>'true'
    AND COALESCE(a."result"->>'reason','')<>'ANSWERING_MACHINE' AND COALESCE(l."metadata"->>'disposition','')<>'ANSWERING_MACHINE'
    AND COALESCE(a."result"->>'doNotCallRequested','false')<>'true' AND COALESCE(a."result"->>'optOutRequested','false')<>'true'
    AND COALESCE(l."metadata"->>'doNotCallRequested','false')<>'true'
    AND COALESCE(a."result"->>'intent','') NOT IN ('uninterested','optout')
    AND COALESCE(l."metadata"->>'intent','') NOT IN ('uninterested','optout')
    AND p.phone ~ '^\\+?[0-9]{7,15}$'
    AND NOT EXISTS (SELECT 1 FROM "CustomerIntentCall" refusal WHERE refusal."workspaceId"=a."workspaceId" AND refusal."phone"=p.phone AND (refusal."intent"='optout' OR (refusal."callId"=a."id" AND refusal."intent"='uninterested')))
), live_phone_latest AS (
  SELECT live.*,row_number() OVER (PARTITION BY live."workspaceId",live.phone ORDER BY live."at" DESC,live."callId" DESC) AS rn
  FROM live_attempt_calls live
), live_customers AS (
  SELECT COALESCE(c."id",md5(live."workspaceId"||':'||live.phone)) AS "id",live."workspaceId",live.phone,
    CASE WHEN c."id" IS NOT NULL THEN c."ownerId" ELSE live."ownerId" END AS "ownerId",
    'interested'::text AS intent,'pending'::text AS stage,
    COALESCE(c."profile",'{"name":"","company":"","wechatId":"","wechatConsent":false,"followedUp":false,"hasAddedWechat":false}'::jsonb) AS profile,
    '通话中识别到意向表达，结束后核验。'::text AS summary,live.evidence,live."at" AS "latestAt",
    COALESCE(c."version",0) AS version,COALESCE(c."createdAt",live."at") AS "createdAt",
    GREATEST(c."updatedAt",live."observedAt") AS "updatedAt",true AS temporary,'provisional'::text AS "recognitionStatus"
  FROM live_phone_latest live
  LEFT JOIN "CustomerIntentCustomer" c ON c."workspaceId"=live."workspaceId" AND c."phone"=live.phone
  WHERE live.rn=1 AND (c."id" IS NULL OR (
    c."intent"='unclear' AND c."stage"='closed' AND c."summary"='' AND c."evidence"=''
    AND COALESCE(c."profile"->>'name','')='' AND COALESCE(c."profile"->>'company','')='' AND COALESCE(c."profile"->>'wechatId','')=''
    AND COALESCE(c."profile"->>'wechatConsent','false')<>'true' AND COALESCE(c."profile"->>'followedUp','false')<>'true' AND COALESCE(c."profile"->>'hasAddedWechat','false')<>'true'
    AND (c."profile"-'name'-'company'-'wechatId'-'wechatConsent'-'followedUp'-'hasAddedWechat')='{}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM "CustomerIntentCall" prior WHERE prior."workspaceId"=c."workspaceId" AND prior."phone"=c."phone" AND prior."intent"<>'unclear')
    AND NOT EXISTS (SELECT 1 FROM "CustomerIntentHistory" history WHERE history."customerId"=c."id" AND history."actor"<>'系统')
  ))
), effective_customers AS (
  SELECT c."id",c."workspaceId",c."phone",c."ownerId",c."intent",c."stage",c."profile",c."summary",c."evidence",c."latestAt",c."version",c."createdAt",c."updatedAt",false AS temporary,'confirmed'::text AS "recognitionStatus"
  FROM "CustomerIntentCustomer" c
  WHERE c."workspaceId"=$1 AND NOT EXISTS (SELECT 1 FROM live_customers live WHERE live."workspaceId"=c."workspaceId" AND live.phone=c."phone")
  UNION ALL SELECT * FROM live_customers
), effective_calls AS (
  SELECT k."workspaceId",k."callId",k."phone",k."ownerId",k."intent",k."summary",k."evidence",k."at",'confirmed'::text AS "recognitionStatus"
  FROM "CustomerIntentCall" k JOIN "CallLog" l ON l."organizationId"=k."workspaceId" AND l."callId"=k."callId"
  WHERE k."workspaceId"=$1 AND l."deleted"=false
    AND NOT EXISTS (SELECT 1 FROM live_attempt_calls live WHERE live."workspaceId"=k."workspaceId" AND live."callId"=k."callId" AND k."intent"='unclear')
  UNION ALL
  SELECT live."workspaceId",live."callId",live.phone,live."ownerId",'interested'::text,'通话中识别到意向表达，结束后核验。'::text,live.evidence,live."at",'provisional'::text
  FROM live_attempt_calls live LEFT JOIN "CustomerIntentCall" k ON k."workspaceId"=live."workspaceId" AND k."callId"=live."callId"
  WHERE k."callId" IS NULL OR k."intent"='unclear'
)`;
