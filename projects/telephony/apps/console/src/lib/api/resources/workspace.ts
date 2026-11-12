/*
 * 中文导读：工作区与权限的前端接口封装，将页面调用连接到后端资源。
 */
import { useQuery } from '@tanstack/react-query';
import { authClient } from '@/src/lib/auth-client';
import { apiClient,unwrap } from '../client';
export type DashboardAnnouncementSpeed='slow'|'normal'|'fast';
export interface DashboardAnnouncement { text:string;color:string;enabled:boolean;speed:DashboardAnnouncementSpeed }
export interface WorkspaceProfile { organizationId:string;workspaceName:string;companyName:string;brandName:string;address:string;businessDescription:string;phone:string;email:string;website:string;logo:string|null;dashboardAnnouncement:DashboardAnnouncement;canEdit:boolean }
export type WorkspaceProfileInput=Omit<WorkspaceProfile,'organizationId'|'canEdit'>;
export const workspaceApi={get:()=>unwrap<WorkspaceProfile>(apiClient.get('/workspaces/profile')),save:(id:string,data:WorkspaceProfileInput)=>unwrap<WorkspaceProfile>(apiClient.put(`/workspaces/${encodeURIComponent(id)}/profile`,data))};
export function useWorkspaceProfile(){const {data:session}=authClient.useSession();const orgId=session?.session.activeOrganizationId;return useQuery({queryKey:['workspace-profile',session?.user.id,orgId],queryFn:workspaceApi.get,enabled:Boolean(session?.user.id&&orgId)});}
