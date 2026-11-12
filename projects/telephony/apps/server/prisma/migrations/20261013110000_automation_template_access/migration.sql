-- 中文导读：数据库迁移：20261013110000_automation_template_access。记录这一版本的表结构或数据规则变更。
-- Keep the new workspace template state table under the application's existing database owner.
DO $$
DECLARE
  application_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid = 'public."AutomationLearningDraft"'::regclass;
  IF application_owner IS NULL THEN
    RAISE EXCEPTION 'Existing automation owner is missing';
  END IF;
  EXECUTE format('ALTER TABLE public."AutomationTemplateState" OWNER TO %I', application_owner);
END $$;
