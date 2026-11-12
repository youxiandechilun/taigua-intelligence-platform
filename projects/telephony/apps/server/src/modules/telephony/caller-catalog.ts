/*
 * 中文导读：线路与语音外呼：caller-catalog.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type Scope } from '../crm/crm.service.js';
import { configuration, lineMissing } from './sip.service.js';
import { defaultLineConfiguration, regionalCatalog } from './routing.service.js';
import { engineCatalog, engineSettings } from './aliyun-engine.service.js';

export async function callerCatalog(s:Scope) {
  const access=await memberAccess(crmDb,s);
  const [sip,regional,engine,cloud,defaultConfiguration]=await Promise.allSettled([
    configuration(s),
    regionalCatalog(s),
    engineCatalog(s),
    crmDb.query('SELECT "settings"->\'callerNumbers\' AS numbers FROM "AliyunConnection" WHERE "organizationId"=$1',[s.workspaceId]),
    defaultLineConfiguration(s.workspaceId),
  ]);
  const rows:Record<string,unknown>[]=[];
  if(sip.status==='fulfilled'&&!sip.value.removed) {
    const c=sip.value;
    rows.push({id:'haokehu-default',provider:'HAOKEHU_SIP',serviceProvider:c.serviceProvider||'好客呼',name:c.name||'好客呼默认线路',identifier:c.callerNumber||(c.callerMode==='provider'?'服务商提供':''),identifierLabel:'线路主叫标识',displayNumber:null,scope:'默认线路',ready:c.ready,enabled:c.liveEnabled,usages:[{label:'数字员工外呼',ready:c.ready},{label:'人工通话',ready:c.manualReady}],missing:c.aiMissing,link:'/settings/telephony'});
  } else if(sip.status==='rejected'&&!(defaultConfiguration.status==='fulfilled'&&defaultConfiguration.value.removed)) rows.push({id:'haokehu-default',provider:'HAOKEHU_SIP',name:'好客呼默认线路',identifier:'',identifierLabel:'线路主叫标识',displayNumber:null,scope:'默认线路',ready:false,enabled:false,usages:[],missing:['线路信息读取失败'],link:'/settings/telephony'});
  if(regional.status==='fulfilled') {
    const ids=regional.value.lines.map(l=>l.id);
    const saved=ids.length?await crmDb.query('SELECT "id","settings" FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "id"=ANY($2::text[]) AND "deletedAt" IS NULL',[s.workspaceId,ids]).catch(()=>[]):[];
    for(const r of regional.value.lines) {
      const line=saved.find(l=>l.id===r.id)?.settings;
      if(!line)continue;
      const ready=r.enabled&&line.liveEnabled&&lineMissing(line).length===0&&sip.status==='fulfilled'&&sip.value.serviceReady;
      rows.push({id:r.id,provider:'HAOKEHU_SIP',serviceProvider:line.serviceProvider||'好客呼',name:r.name,identifier:line.callerNumber||(line.callerMode==='provider'?'服务商提供':''),identifierLabel:'线路主叫标识',displayNumber:null,scope:r.provinces.join('、'),ready,enabled:r.enabled&&r.liveEnabled,usages:[{label:'地区外呼',ready}],missing:!r.enabled?['地区线路已停用']:lineMissing(line),link:'/settings/telephony'});
    }
  }
  if(engine.status==='fulfilled') {
    const c=engine.value,settings=await engineSettings(s.workspaceId).catch(()=>null);
    rows.push({id:'aliyun-engine',provider:'ALIYUN_ENGINE',name:c.name,identifier:settings?.callerNumber||'',identifierLabel:'主叫号码 / 服务实例',displayNumber:null,scope:'阿里云通信引擎',ready:!!settings&&c.ready,enabled:settings?.enabled||false,usages:[{label:'数字员工外呼',ready:!!settings&&c.ready}],missing:settings?c.missing:['阿里云配置读取失败'],link:'/settings/telephony'});
  } else rows.push({id:'aliyun-engine',provider:'ALIYUN_ENGINE',name:'阿里云通信引擎',identifier:'',identifierLabel:'主叫号码 / 服务实例',displayNumber:null,scope:'阿里云通信引擎',ready:false,enabled:false,usages:[],missing:['阿里云配置读取失败'],link:'/settings/telephony'});
  if(cloud.status==='fulfilled')for(const n of Array.isArray(cloud.value[0]?.numbers)?cloud.value[0]!.numbers:[]) {
    if(typeof n!=='string'||rows.some(r=>r.provider==='ALIYUN_ENGINE'&&r.identifier===n))continue;
    rows.push({id:'aliyun-legacy:'+n,provider:'ALIYUN_LEGACY',name:'阿里云历史登记',identifier:n,identifierLabel:'登记号码',displayNumber:null,scope:'历史云端任务',ready:false,enabled:false,usages:[{label:'历史登记',ready:false}],missing:['历史登记不代表当前通信引擎已启用'],link:'/settings/telephony'});
  }
  return {canConfigure:access.isSystemAdmin,rows,updatedAt:new Date().toISOString()};
}
