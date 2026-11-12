/*
 * 中文导读：设置中心 / models的路由页面；由 Next.js 按文件路由约定加载。
 */
import {redirect} from 'next/navigation';
import {requireCompanyAccess} from '@/src/lib/server-session';
import {ModelSettings} from '@/src/components/telephony/ModelSettings';
export default async function Page(){const access=await requireCompanyAccess();if(!access.isSystemAdmin)redirect('/settings');return <ModelSettings/>;}
