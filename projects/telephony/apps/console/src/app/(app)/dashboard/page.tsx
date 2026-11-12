/*
 * 中文导读：数据看板的路由页面；由 Next.js 按文件路由约定加载。
 */
import {redirect} from 'next/navigation';
import {requireCompanyAccess} from '@/src/lib/server-session';
import DashboardContent from './DashboardContent';
export default async function DashboardPage(){const context=await requireCompanyAccess();if(!context.permissions.callLogs?.includes('read'))redirect('/tools');return <DashboardContent/>;}
