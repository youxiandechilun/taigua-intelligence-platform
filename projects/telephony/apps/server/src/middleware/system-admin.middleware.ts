/*
 * 中文导读：HTTP 请求中间件：system-admin.middleware。在业务处理前后执行本文件定义的公共规则。
 */
import type { RequestHandler } from 'express';
import { ForbiddenError } from '../common/errors/forbidden.js';
import { requireSystemAdminAccess } from '../lib/access-control.js';
export const requireSystemAdmin:RequestHandler=async(req,_res,next)=>{
 try {
  if(req.auth?.authMethod!=='session')throw new ForbiddenError('仅登录用户可以使用此功能。');
  await requireSystemAdminAccess(req.auth.userId);
  next();
 }catch(e){next(e);}
};
