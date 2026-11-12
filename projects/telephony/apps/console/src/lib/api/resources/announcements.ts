/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { useQuery } from '@tanstack/react-query';
import { authClient } from '@/src/lib/auth-client';
import { apiClient, unwrap } from '../client';

export type AnnouncementStyle = { text: string; color: string; speed: 'slow'|'normal'|'fast'; fontSize: number };
export type AnnouncementInput = AnnouncementStyle & { startsAt: string|null; endsAt: string|null };
export type CompanyAnnouncement = AnnouncementInput & { id: string; startsAt: string; updatedAt: string; createdAt: string; status: 'ACTIVE'|'SCHEDULED'|'EXPIRED'|'STOPPED' };
export type AnnouncementFeed = { workspaceId: string; serverNow: string; nextChangeAt: string|null; announcements: Pick<CompanyAnnouncement,"id"|"text"|"color"|"speed"|"fontSize"|"startsAt"|"endsAt"|"updatedAt">[] };
export type AnnouncementList = { workspaceId: string; rows: CompanyAnnouncement[]; counts: {current: number; history: number}; page: number; pageSize: number };
const headers = (org:string) => ({'x-workspace-id':org});
const base = '/workspaces/announcements';
export const announcementApi = {
  active: (org:string) => unwrap<AnnouncementFeed>(apiClient.get(base+'/active',{headers:headers(org)})),
  list: (org:string,view:'current'|'history',page:number) => unwrap<AnnouncementList>(apiClient.get(base,{headers:headers(org),params:{view,page}})),
  publish: (org:string,input:AnnouncementInput,requestId:string) => unwrap<CompanyAnnouncement>(apiClient.post(base,{...input,requestId},{headers:headers(org)})),
  edit: (org:string,id:string,input:AnnouncementInput,updatedAt:string) => unwrap<CompanyAnnouncement>(apiClient.put(base+'/'+encodeURIComponent(id),{...input,updatedAt},{headers:headers(org)})),
  stop: (org:string,row:CompanyAnnouncement) => unwrap(apiClient.post(base+'/'+encodeURIComponent(row.id)+'/stop',{updatedAt:row.updatedAt},{headers:headers(org)})),
  remove: (org:string,row:CompanyAnnouncement) => unwrap(apiClient.delete(base+'/'+encodeURIComponent(row.id),{headers:headers(org),data:{updatedAt:row.updatedAt}})),
};
export function useAnnouncementFeed() {
  const {data:session}=authClient.useSession();
  const org=session?.session.activeOrganizationId;
  return useQuery({
    queryKey:['company-announcements-active',session?.user.id,org],
    queryFn:()=>announcementApi.active(org!),enabled:Boolean(org&&session?.user.id),retry:false,
    refetchInterval:query=>{
      const data=query.state.data;
      if(!data?.nextChangeAt)return 30000;
      const delay=Date.parse(data.nextChangeAt)-Date.parse(data.serverNow)-(Date.now()-query.state.dataUpdatedAt);
      return Math.max(500,Math.min(30000,delay+50));
    },
    refetchIntervalInBackground:false,refetchOnWindowFocus:true,
  });
}
