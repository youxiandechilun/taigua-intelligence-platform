/*
 * 中文导读：线路与语音外呼：callback.route.ts。声明接口路径、中间件和处理函数。
 */
import {Router,text} from 'express';
import rateLimit from 'express-rate-limit';
import type {CrmDb} from '../crm/crm.service.js';
import {crmDb} from '../crm/crm.db.js';
import {tokenHash} from './callback.credentials.js';
import {parseProviderJson} from './callback.client.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ingestCallback} from './callback.events.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
export function createCallbackRouter(db:CrmDb=crmDb){
const router=Router();
// Authenticate before reading a bounded body. The token is a 256-bit random
// capability and neither HTTP access logs nor application logs retain its URL.
router.post('/:token',rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}),async(req,res,next)=>{
 try{
  if(!/^[a-f0-9]{64}$/.test(String(req.params.token)))throw new ForbiddenError('回拨通知认证失败。');
  const connection=(await db.query('SELECT "workspaceId" FROM "CallbackConnection" WHERE "hookHash"=$1',[tokenHash(String(req.params.token))]))[0];
  if(!connection)throw new ForbiddenError('回拨通知认证失败。');
  res.locals.callbackWorkspaceId=connection.workspaceId;next();
 }catch(e){next(e);}
},text({type:'application/json',limit:'16kb'}),async(req,res,next)=>{
 try{if(typeof req.body!=='string')throw new BadRequestError('话单格式无效。');let payload;try{payload=parseProviderJson(req.body);}catch{throw new BadRequestError('话单格式无效。');}await ingestCallback(db,res.locals.callbackWorkspaceId,payload);res.setHeader('Cache-Control','no-store');res.json({code:200,message:'success'});}catch(e){next(e);}
});
return router;
}
export default createCallbackRouter();
