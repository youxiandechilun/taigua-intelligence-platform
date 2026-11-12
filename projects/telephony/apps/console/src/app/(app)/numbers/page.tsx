/*
 * 中文导读：电话号码的路由页面；由 Next.js 按文件路由约定加载。
 */
import {redirect} from 'next/navigation';
import {requireCompanyAccess} from '@/src/lib/server-session';
export default async function NumbersPage(){
 const access=await requireCompanyAccess();
 redirect(access.isSystemAdmin||access.permissions.lines?.includes('assign')?'/settings/telephony':'/outbound');
}
