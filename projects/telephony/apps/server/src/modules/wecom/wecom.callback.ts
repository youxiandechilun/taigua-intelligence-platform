/*
 * 中文导读：企业微信：wecom.callback.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {Router,text} from 'express';
import rateLimit from 'express-rate-limit';
import {callback} from './wecom.service.js';
const router=Router();router.use(rateLimit({windowMs:60000,limit:200,standardHeaders:true,legacyHeaders:false}));router.use(text({type:()=>true,limit:'64kb'}));
router.all('/:workspaceId',async(req,res)=>{res.setHeader('Cache-Control','no-store');try{if(!['GET','POST'].includes(req.method))return res.sendStatus(405);const query:Record<string,string>={};for(const k of ['msg_signature','timestamp','nonce','echostr']){if(req.query[k]!==undefined&&typeof req.query[k]!=='string')throw new Error('invalid query');query[k]=String(req.query[k]||'');}const result=await callback(String(req.params.workspaceId),query,req.method==='POST'?req.body:undefined);res.type('text/plain').send(result);}catch{res.status(403).type('text/plain').send('invalid callback');}});
export default router;
