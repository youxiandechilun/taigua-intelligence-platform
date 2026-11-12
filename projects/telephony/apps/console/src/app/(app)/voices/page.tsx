/*
 * 中文导读：voices的路由页面；由 Next.js 按文件路由约定加载。
 */
import {redirect} from 'next/navigation';
import {requireCompanyAccess,requireSession} from '@/src/lib/server-session';
import {VoiceLibrary} from '@/src/components/telephony/VoiceLibrary';
export default async function Page(){
 const access=await requireCompanyAccess();
 if(!access.isSystemAdmin&&!access.permissions.agentConfiguration?.includes('update'))redirect('/agents');
 const session=await requireSession();
 return <VoiceLibrary key={session.activeOrganizationId+session.userId}/>;
}
