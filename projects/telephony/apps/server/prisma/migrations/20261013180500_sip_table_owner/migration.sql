-- 中文导读：数据库迁移：20261013180500_sip_table_owner。记录这一版本的表结构或数据规则变更。
-- Keep the new resources under the same database role as the existing app.
-- This fixes admin-run migrations without granting public access or changing ACLs.
DO $body$
DECLARE app_owner text; resource text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Agent"'::regclass;
 IF app_owner IS NULL THEN RAISE EXCEPTION 'Existing application database role unavailable'; END IF;
 FOREACH resource IN ARRAY ARRAY['SipConnection','SipAgentProfile','SipTask','SipAttempt','SipEvent','SipSeat','WorkspaceModelSettings','AgentModelSelection'] LOOP
  EXECUTE format('ALTER TABLE %I OWNER TO %I',resource,app_owner);
 END LOOP;
END $body$;
