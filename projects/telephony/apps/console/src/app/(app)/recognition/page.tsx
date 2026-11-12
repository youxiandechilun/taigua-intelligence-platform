/*
 * 中文导读：recognition的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from 'next/navigation';
import { requireCompanyAccess } from '@/src/lib/server-session';
import { PageHeader } from '@/src/components/common/PageHeader';
import { IntentRulesSettings } from '@/src/components/settings/IntentRulesSettings';

export default async function RecognitionPage() {
  const access = await requireCompanyAccess();
  if (!access.isSystemAdmin && !access.permissions.lines?.includes('read')) redirect('/dashboard');
  return <main className="min-w-0 space-y-5">
    <PageHeader title="识别与拦截" />
    <p className="text-sm text-muted-foreground">规则在当前工作区共用，保存后对后续新呼叫生效。</p>
    <IntentRulesSettings />
  </main>;
}
