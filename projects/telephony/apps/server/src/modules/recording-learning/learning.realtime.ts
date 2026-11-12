/*
 * 中文导读：录音学习：learning.realtime.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type {Server} from 'node:http';
import {fromNodeHeaders} from 'better-auth/node';
import {auth} from '../../lib/auth.js';
import {trustedOrigins} from '../../config/origins.js';
import {hasSessionPermission} from '../../middleware/authorize.middleware.js';
import {companyContext} from '../workspace/company-access.js';
import {canTrain} from '../agent/agent.release.js';
import {realtimeAuthorized} from '../telephony/models.service.js';
import {workspaceLearning} from './learning.service.js';
import {canManageScripts} from '../agent/script-access.js';
import {RECORDING_LEARNING_ENABLED} from './learning-availability.js';
export function attachRecordingLearningRealtime(server:Server){
 server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url||'','https://localhost');
  if(url.pathname!=='/api/v1/recording-learning/api/realtime'){if(!url.pathname.startsWith('/socket.io/'))socket.destroy();return;}
  if(!RECORDING_LEARNING_ENABLED){socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');socket.destroy();return;}
  void(async()=>{
   if(!trustedOrigins.includes(String(req.headers.origin||'')))throw new Error('origin');
   const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
   const userId=session?.user.id,workspaceId=session?.session.activeOrganizationId;
   if(!userId||!workspaceId||url.searchParams.get('workspaceId')!==workspaceId)throw new Error('session');
   if(!await hasSessionPermission(req.headers,workspaceId,{agentConfiguration:['read','update']}))throw new Error('permission');
   if(!canTrain((await companyContext(workspaceId,userId)).permissions)||!await canManageScripts({workspaceId,userId}))throw new Error('permission');
   const app=await workspaceLearning(workspaceId),db=app.getStore();
   await realtimeAuthorized(workspaceId,db.config.realtimeModel);
   req.url='/api/realtime'+url.search;
   Object.assign(req,{learningPermissionCheck:async()=>{
    const current=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
    return current?.session.activeOrganizationId===workspaceId&&await hasSessionPermission(req.headers,workspaceId,{agentConfiguration:['read','update']})&&canTrain((await companyContext(workspaceId,userId)).permissions)&&await canManageScripts({workspaceId,userId});
   }});
   app.server.emit('upgrade',req,socket,head);
  })().catch(()=>{if(!socket.destroyed){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();}});
 });
}
