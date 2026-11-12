/*
 * 中文导读：企业微信的前端接口封装，将页面调用连接到后端资源。
 */
import {apiClient,unwrap} from '../client';
export type WecomStatus={configured:boolean;connected:boolean;notificationConnected:boolean;callbackVerified:boolean;loginReady:boolean;canManage:boolean;canConfigure:boolean;myWecomUserId:string;corpId?:string;agentId?:string;callbackUrl?:string;loginDomain?:string;lastError:string;lastSyncAt:string|null;lastCheckedAt:string|null};
export type WecomMember={userId:string;name:string;wecomUserId:string};
export type WecomWay={id:string;ownerId:string;remark:string;qrCode:string;createdAt:string};
export type WecomContact={id:string;name:string;companyName:string;position:string;remark:string;tags:string[];relationStatus:string;ownerId:string;ownerName:string;companyId:string|null;contactId:string|null;linkedCompanyName:string|null;addedAt:string|null};
const opt=(org:string)=>({headers:{'x-workspace-id':org}});
export type WecomNotificationConfig={enabled:boolean;time:string;weekdays:number[];recipientIds:string[];contents:('calls'|'customers'|'tasks')[]};
export type WecomNotificationLog={id:string;recipientId:string;recipientName:string;date:string;status:string;error:string;createdAt:string;finishedAt:string|null};
export const wecomApi={
 startLogin:(o:string)=>unwrap<{url:string}>(apiClient.post('/wecom/login/start',{},opt(o))),
 finishLogin:(o:string,code:string,state:string)=>unwrap<{wecomUserId:string}>(apiClient.post('/wecom/login/finish',{code,state},opt(o))),
 notifications:(o:string)=>unwrap<{canManage:boolean;config:WecomNotificationConfig|null}>(apiClient.get('/wecom/notifications',opt(o))),
 saveNotifications:(o:string,input:WecomNotificationConfig)=>unwrap<{canManage:boolean;config:WecomNotificationConfig|null}>(apiClient.put('/wecom/notifications',input,opt(o))),
 previewNotification:(o:string,input:{userId?:string;contents?:WecomNotificationConfig['contents']})=>unwrap<{recipientName:string;scope:string;date:string;content:string}>(apiClient.post('/wecom/notifications/preview',input,opt(o))),
 notificationLogs:(o:string,page:number)=>unwrap<{rows:WecomNotificationLog[];total:number;page:number}>(apiClient.get('/wecom/notifications/logs',{...opt(o),params:{page}})),
 status:(o:string)=>unwrap<WecomStatus>(apiClient.get('/wecom/status',opt(o))),
 save:(o:string,input:{corpId:string;secret:string;agentId:string})=>unwrap<WecomStatus>(apiClient.put('/wecom/config',input,opt(o))),
 verify:(o:string)=>unwrap<WecomStatus&{members:string[]}>(apiClient.post('/wecom/verify',{},opt(o))),
 callbackSettings:(o:string)=>unwrap<{token:string;aesKey:string}>(apiClient.post('/wecom/callback-settings',{},opt(o))),
 members:(o:string)=>unwrap<WecomMember[]>(apiClient.get('/wecom/members',opt(o))),
 followUsers:(o:string)=>unwrap<string[]>(apiClient.get('/wecom/follow-users',opt(o))),
 bind:(o:string,userId:string,wecomUserId:string)=>unwrap<WecomMember[]>(apiClient.put('/wecom/members',{userId,wecomUserId},opt(o))),
 ways:(o:string)=>unwrap<WecomWay[]>(apiClient.get('/wecom/contact-ways',opt(o))),
 createWay:(o:string,ownerId:string,remark:string)=>unwrap<WecomWay>(apiClient.post('/wecom/contact-ways',{ownerId,remark},opt(o))),
 contacts:(o:string,q:string,page:number)=>unwrap<{rows:WecomContact[];total:number;page:number;pageSize:number}>(apiClient.get('/wecom/contacts',{...opt(o),params:{q,page}})),
 sync:(o:string,ownerId:string,cursor:number)=>unwrap<{synced:number;total:number;nextCursor:number|null}>(apiClient.post('/wecom/contacts/sync',{ownerId,cursor},opt(o))),
 link:(o:string,id:string,companyId:string,contactId:string|null)=>unwrap<{saved:boolean}>(apiClient.post(`/wecom/contacts/${id}/link`,{companyId,contactId},opt(o))),
};
