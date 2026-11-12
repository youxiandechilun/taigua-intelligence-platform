/*
 * 中文导读：企业微信：wecom.notifications.runtime.ts。组织运行期状态与事件处理。
 */
import prisma from '../../config/prisma.js';
import type {CrmDb} from '../crm/crm.service.js';
import {connection} from './wecom.service.js';
import {wecomClient} from './wecom.client.js';
import {notificationService} from './wecom.notifications.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
const adapter=(client:any):CrmDb=>({query:(sql,values=[])=>client.$queryRawUnsafe(sql,...values),transaction:fn=>prisma.$transaction(tx=>fn(adapter(tx)))});
export const notifications=notificationService(adapter(prisma),async(org,user,text)=>{const{row,credentials}=await connection(org);return wecomClient(org,row.corpId,credentials).sendText(user,text);},async org=>{const{row,credentials}=await connection(org);if(!row.notificationVerifiedAt||!/^\d{1,10}$/.test(credentials.agentId||''))throw new BadRequestError('请先检查企微连接，并填写有效应用 ID，再开启通知。');});
let timer:ReturnType<typeof setInterval>|null=null,processing:Promise<void>|null=null;
export function startWecomNotificationWorker(){if(timer)return;timer=setInterval(()=>{if(processing)return;processing=notifications.tick().catch(()=>console.warn('[wecom] notification scheduler unavailable')).finally(()=>{processing=null;});},15000);timer.unref();}
export async function stopWecomNotificationWorker(){if(timer)clearInterval(timer);timer=null;if(processing)await processing;}
