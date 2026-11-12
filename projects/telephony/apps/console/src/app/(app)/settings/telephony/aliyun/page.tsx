/*
 * 中文导读：设置中心 / 线路与语音外呼 / 阿里云连接的路由页面；由 Next.js 按文件路由约定加载。
 */
import {redirect} from 'next/navigation';
import {requireCompanyAccess} from '@/src/lib/server-session';
import {LineManagement} from '@/src/components/telephony/LineManagement';
export default async function Page({searchParams}:{searchParams:Promise<{configure?:string}>}){
 const access=await requireCompanyAccess();
 if(!access.isSystemAdmin&&!access.permissions.lines?.includes('assign'))redirect('/settings');
 const {configure}=await searchParams;
 return <LineManagement key={access.organizationId+':aliyun:'+(configure||'')} provider="ALIYUN" initialConfigure={access.isSystemAdmin?configure:undefined}/>;
}
