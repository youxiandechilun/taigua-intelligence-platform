/*
 * 中文导读：自动化流程的路由页面；由 Next.js 按文件路由约定加载。
 */
import { AutomationCenter } from '@/src/components/automation/AutomationCenter';
import { requireSession, requireCompanyAccess } from '@/src/lib/server-session';
export default async function AutomationPage(){
  const [session, company] = await Promise.all([requireSession(), requireCompanyAccess()]);
  return <AutomationCenter initialContext={{org:session.activeOrganizationId,user:session.userId,canManage:company.canManage,canEditEngine:company.isSystemAdmin}} />;
}
