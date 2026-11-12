/*
 * 中文导读：设置中心 / members的路由页面；由 Next.js 按文件路由约定加载。
 */
import {redirect} from 'next/navigation';
import {requireSession,requireCompanyAccess} from '@/src/lib/server-session';
import {CompanyPeople} from '@/src/components/settings/CompanyPeople';
export default async function CompanyMembersPage({searchParams}:{searchParams:Promise<{panel?:string}>}){
 const [session,company,params]=await Promise.all([requireSession(),requireCompanyAccess(),searchParams]);
 if(!company.canManageMembers&&!company.canManageSeats&&!company.canManageDepartments&&!company.canManageRoles)redirect('/tools');
 const panel=params.panel==='departments'&&company.canManageDepartments?'departments':params.panel==='roles'&&company.canManageRoles?'roles':null;
 return <CompanyPeople key={session.userId+':'+session.activeOrganizationId+':'+(panel||'members')} initialPanel={panel}/>;
}
