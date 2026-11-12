/*
 * 中文导读：录音学习的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from 'next/navigation';
import { requireCompanyAccess } from '@/src/lib/server-session';
import { RecordingLibrary } from '@/src/components/telephony/RecordingLibrary';

export default async function RecordingLearningPage() {
 const access = await requireCompanyAccess();
 if (!access.isSystemAdmin && !access.permissions.agentConfiguration?.includes('update')) redirect('/agents');
 return <RecordingLibrary />;
}
