-- 中文导读：数据库迁移：20261020010000_production_ui_contracts。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "CustomerIntentCustomer" (
 "id" text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "phone" text NOT NULL, "ownerId" text, "intent" text NOT NULL DEFAULT 'interested', "stage" text NOT NULL DEFAULT 'pending',
 "profile" jsonb NOT NULL DEFAULT '{"name":"","company":"","wechatId":"","wechatConsent":false,"followedUp":false,"hasAddedWechat":false}',
 "summary" text NOT NULL DEFAULT '', "evidence" text NOT NULL DEFAULT '', "latestAt" timestamptz NOT NULL,
 "version" integer NOT NULL DEFAULT 1, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("workspaceId","phone")
);
CREATE INDEX IF NOT EXISTS "CustomerIntentCustomer_owner" ON "CustomerIntentCustomer"("workspaceId","ownerId","updatedAt" DESC);
CREATE TABLE IF NOT EXISTS "CustomerIntentCall" (
 "workspaceId" text NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE, "callId" text NOT NULL REFERENCES "CallLog"("callId") ON DELETE CASCADE,
 "phone" text NOT NULL, "ownerId" text, "intent" text NOT NULL, "summary" text NOT NULL DEFAULT '', "evidence" text NOT NULL DEFAULT '', "at" timestamptz NOT NULL,
 PRIMARY KEY("workspaceId","callId")
);
CREATE INDEX IF NOT EXISTS "CustomerIntentCall_phone" ON "CustomerIntentCall"("workspaceId","phone","at" DESC);
CREATE TABLE IF NOT EXISTS "CustomerIntentHistory" (
 "id" bigserial PRIMARY KEY, "customerId" text NOT NULL REFERENCES "CustomerIntentCustomer"("id") ON DELETE CASCADE,
 "at" timestamptz NOT NULL DEFAULT now(), "actor" text NOT NULL, "title" text NOT NULL, "note" text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS "KnowledgeSourceOverride" (
 "organizationId" text NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE, "sourceRef" text NOT NULL,
 "payload" jsonb NOT NULL, "revision" integer NOT NULL DEFAULT 1, "originHash" text NOT NULL,
 "deletedAt" timestamptz, "updatedAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY("organizationId","sourceRef")
);
CREATE TABLE IF NOT EXISTS "CompanyMemberBatchReceipt" (
 "workspaceId" text NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE, "requestId" text NOT NULL,
 "actorId" text NOT NULL, "payloadHash" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY("workspaceId","requestId")
);
CREATE OR REPLACE FUNCTION taigua_refresh_customer_intent(ws text,p text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE first_row record; latest record; cid text; changed integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('intent:'||ws||':'||p)::bigint);
 SELECT * INTO first_row FROM "CustomerIntentCall" WHERE "workspaceId"=ws AND "phone"=p AND "intent"='interested' ORDER BY "at","callId" LIMIT 1;
 IF NOT FOUND THEN
  UPDATE "CustomerIntentCustomer" SET "intent"='unclear',"stage"='closed',"summary"='',"evidence"='',"version"="version"+1,"updatedAt"=now()
  WHERE "workspaceId"=ws AND "phone"=p AND ("intent"<>'unclear' OR "stage"<>'closed' OR "summary"<>'' OR "evidence"<>'');
  RETURN;
 END IF;
 cid:=md5(ws||':'||p);
 INSERT INTO "CustomerIntentCustomer"("id","workspaceId","phone","ownerId","latestAt") VALUES (cid,ws,p,first_row."ownerId",first_row."at") ON CONFLICT ("workspaceId","phone") DO NOTHING;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN INSERT INTO "CustomerIntentHistory"("customerId","actor","title") VALUES (cid,'系统','AI识别明确意向，自动进入客户库'); END IF;
 SELECT * INTO latest FROM "CustomerIntentCall" WHERE "workspaceId"=ws AND "phone"=p AND "intent"<>'unclear' ORDER BY "at" DESC,"callId" DESC LIMIT 1;
 UPDATE "CustomerIntentCustomer" SET "intent"=latest."intent","summary"=latest."summary","evidence"=latest."evidence","latestAt"=latest."at",
  "stage"=CASE WHEN latest."intent"<>'interested' THEN 'closed' WHEN "intent"<>'interested' AND "stage"='closed' THEN 'pending' ELSE "stage" END,
  "version"="version"+1,"updatedAt"=now()
 WHERE "workspaceId"=ws AND "phone"=p AND ("intent","summary","evidence","latestAt") IS DISTINCT FROM (latest."intent",latest."summary",latest."evidence",latest."at");
END $$;
CREATE OR REPLACE FUNCTION taigua_sync_customer_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text; old_phone text; token text; i text; sm text; ev text; field jsonb;
BEGIN
 SELECT "phone" INTO old_phone FROM "CustomerIntentCall" WHERE "workspaceId"=NEW."organizationId" AND "callId"=NEW."callId";
 p := regexp_replace(COALESCE(CASE WHEN lower(NEW."direction")='inbound' THEN NEW."callerId" ELSE COALESCE(NEW."metadata"->>'toNumber',NEW."callerId") END,''),'[[:space:]()\-]','','g');
 IF p ~ '^(\+86|0086)1[0-9]{10}$' THEN p:=regexp_replace(p,'^(\+86|0086)','','g'); END IF;
 IF NEW."deleted" OR NEW."startTime" IS NULL OR p !~ '^\+?[0-9]{7,15}$' THEN
  DELETE FROM "CustomerIntentCall" WHERE "workspaceId"=NEW."organizationId" AND "callId"=NEW."callId";
  IF old_phone IS NOT NULL THEN PERFORM taigua_refresh_customer_intent(NEW."organizationId",old_phone); END IF;
  RETURN NEW;
 END IF;
 token:='';sm:='';ev:='';
 IF jsonb_typeof(NEW."dataExtracted")='array' THEN
  FOR field IN SELECT value FROM jsonb_array_elements(NEW."dataExtracted") LOOP
   IF field->>'name'='客户意向' THEN token:=upper(trim(field->>'value')); END IF;
   IF field->>'name'='沟通摘要' THEN sm:=left(COALESCE(field->>'value',''),2000); END IF;
   IF field->>'name'='客户需求' THEN ev:=left(COALESCE(field->>'value',''),2000); END IF;
  END LOOP;
 END IF;
 i:=CASE WHEN token IN ('INTERESTED','有意向','明确有意向','感兴趣') THEN 'interested' WHEN token IN ('NO_NEED','UNINTERESTED','NOT_INTERESTED','无意向','不感兴趣','暂无需求') THEN 'uninterested' WHEN token IN ('OPT_OUT','拒绝联系','拒绝再次联系') THEN 'optout' ELSE 'unclear' END;
 IF NEW."status"::text NOT IN ('COMPLETED','PROCESSED') THEN i:='unclear'; END IF;
 IF NEW."metadata"->>'doNotCallRequested'='true' THEN i:='optout'; END IF;
 INSERT INTO "CustomerIntentCall"("workspaceId","callId","phone","ownerId","intent","summary","evidence","at") VALUES (NEW."organizationId",NEW."callId",p,NEW."userId",i,sm,ev,NEW."startTime")
 ON CONFLICT ("workspaceId","callId") DO UPDATE SET "phone"=EXCLUDED."phone","ownerId"=EXCLUDED."ownerId","intent"=EXCLUDED."intent","summary"=EXCLUDED."summary","evidence"=EXCLUDED."evidence","at"=EXCLUDED."at";
 IF old_phone IS NOT NULL AND old_phone<>p THEN PERFORM taigua_refresh_customer_intent(NEW."organizationId",old_phone); END IF;
 PERFORM taigua_refresh_customer_intent(NEW."organizationId",p);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "CallLog_customer_intent" ON "CallLog";
CREATE TRIGGER "CallLog_customer_intent" AFTER INSERT OR UPDATE OF "dataExtracted","status","metadata","deleted","userId","callerId","direction","startTime" ON "CallLog" FOR EACH ROW EXECUTE FUNCTION taigua_sync_customer_intent();
CREATE TABLE IF NOT EXISTS "SipDefaultLineScope" (
 "workspaceId" text PRIMARY KEY REFERENCES "Organization"("id") ON DELETE CASCADE,
 "provinces" text[] NOT NULL DEFAULT ARRAY['广东']::text[], "assignedUserIds" text[] NOT NULL DEFAULT '{}', "updatedAt" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "SipDefaultLineScope"("workspaceId") SELECT "workspaceId" FROM "SipConnection" ON CONFLICT DO NOTHING;
