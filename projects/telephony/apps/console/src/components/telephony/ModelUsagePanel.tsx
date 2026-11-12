/*
 * 中文导读：线路与语音外呼的 ModelUsagePanel 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {ExternalLink,RefreshCw,Bell, Save } from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type ModelAccountSettings,type ModelPlatformUsage,type ModelCatalog} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {toast} from '@/src/lib/toast';

export const tokenNumber=(v:number|null|undefined)=>v==null?'—':v.toLocaleString('zh-CN');
const currencyLabel:Record<string,string>={CNY:'元',USD:'美元',JPY:'日元'};
export function balanceText(p:ModelPlatformUsage){
 const b=p.balances.find(b=>b.currency===p.settings.currency)??p.balances[0];
 return (b?.available??0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+(currencyLabel[b?.currency??p.settings.currency]??p.settings.currency);
}
export const balanceNeedsAuthorization=(p:ModelPlatformUsage)=>p.id==='qwen'&&p.settings.balanceSource==='auto'&&!p.balanceCredentialsConfigured;
export function balanceStatusText(p:ModelPlatformUsage){
 return balanceNeedsAuthorization(p)?'余额待授权':p.balanceError?'余额获取失败':!p.balances.length?p.configured?'未获取':'未配置':p.balanceStale?'待更新':p.settings.balanceSource==='manual'?'手动记录':'已同步';
}
function AlertSettings({platform:p}:{platform:ModelPlatformUsage}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const [settings,setSettings]=useState<ModelAccountSettings>(p.settings);
 const set=<K extends keyof ModelAccountSettings>(key:K,value:ModelAccountSettings[K])=>setSettings(s=>({...s,[key]:value}));
 const save=useMutation({mutationFn:()=>telephonyApi.saveModelAccount(org,p.id,settings),onSuccess:()=>{void qc.invalidateQueries({queryKey:['model-usage']});void qc.invalidateQueries({queryKey:['model-alerts']});toast.success('余额与预警设置已保存');},onError:(e:Error)=>toast.error(e.message)});
 return <form onSubmit={e=>{e.preventDefault();save.mutate();}} className="space-y-4 pt-4">
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
   <label className="grid gap-2 text-sm">余额来源<NativeSelect className="h-9 rounded-md border bg-background px-3" value={settings.balanceSource} onChange={e=>set('balanceSource',e.target.value as 'auto'|'manual')}><option value="auto" disabled={!p.automaticBalance}>平台自动同步</option><option value="manual">手动维护</option></NativeSelect></label>
   <label className="grid gap-2 text-sm">预警币种<NativeSelect className="h-9 rounded-md border bg-background px-3" value={settings.currency} onChange={e=>set('currency',e.target.value as ModelAccountSettings['currency'])}><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option><option value="JPY">日元 JPY</option></NativeSelect></label>
   {settings.balanceSource==='manual'&&<label className="grid gap-2 text-sm">当前余额<Input type="number" step="0.01" min={-1e9} max={1e9} placeholder="0.00" value={settings.manualBalance??''} onChange={e=>set('manualBalance',e.target.value===''?null:Number(e.target.value))}/></label>}
   <label className="grid gap-2 text-sm">余额预警线（{currencyLabel[settings.currency]}）<Input type="number" min={0} max={1e9} step="0.01" placeholder="留空不提醒" value={settings.lowBalanceThreshold??''} onChange={e=>set('lowBalanceThreshold',e.target.value===''?null:Number(e.target.value))}/></label>
   <label className="grid gap-2 text-sm">月度 Token 提醒额度<Input type="number" min={1} max={1e12} step={1} placeholder="未设置" value={settings.monthlyTokenLimit??''} onChange={e=>set('monthlyTokenLimit',e.target.value===''?null:Number(e.target.value))}/></label>
   <label className="grid gap-2 text-sm">用量达到多少时提醒（%）<Input type="number" min={1} max={100} step={1} value={settings.tokenWarningPercent} onChange={e=>set('tokenWarningPercent',Number(e.target.value))}/></label>
  </div>
  <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={settings.alertsEnabled} onChange={e=>set('alertsEnabled',e.target.checked)}/><Bell aria-hidden="true" className="size-3.5 text-muted-foreground"/>在首页提醒超级管理员</label><Button size="sm" type="submit" disabled={save.isPending}><Save aria-hidden="true" className="size-4" />{save.isPending?'保存中…':settings.balanceSource==='manual'?'更新余额并保存预警':'保存预警设置'}</Button></div>
  <p className="text-sm leading-5 text-muted-foreground">月度额度只用于提醒，达到后仍会继续工作。{settings.balanceSource==='manual'?'手动余额请按平台账单更新。':'平台余额约每5分钟同步一次，账单可能有延迟。'}</p>
 </form>;
}
const purposeLabel:Record<string,string>={REHEARSAL:'文字试聊',SUMMARY:'通话整理',ALIYUN_CALL:'阿里云通话',VOICE_CALL:'实时语音',VOICE_PREVIEW:'声音试听',CONNECTIVITY:'连通检查',TRANSCRIPTION:'录音转写',RECORDING_LEARNING:'录音学习',KNOWLEDGE_ANALYSIS:'知识整理'};
function BillingAuthorization({platform:p}:{platform:ModelPlatformUsage}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const [credentials,setCredentials]=useState({accessKeyId:'',accessKeySecret:'',securityToken:''});
 const save=useMutation({
  mutationFn:()=>telephonyApi.saveBillingCredentials(org,credentials),
  onSuccess:data=>{
   setCredentials({accessKeyId:'',accessKeySecret:'',securityToken:''});
   void qc.invalidateQueries({queryKey:['model-usage']});void qc.invalidateQueries({queryKey:['model-alerts']});
   const account=data.platforms.find(v=>v.id==='qwen');
   if(account?.balanceError)toast.error(account.balanceError);else toast.success(account?.settings.balanceSource==='manual'?'余额授权已保存':'余额授权已保存，余额已刷新');
  },
  onError:(e:Error)=>toast.error(e.message),gcTime:0,
 });
 return <form className="space-y-3 pt-3" onSubmit={e=>{e.preventDefault();save.mutate();}}>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="grid gap-2 text-sm">AccessKey ID<Input autoComplete="off" spellCheck={false} maxLength={128} value={credentials.accessKeyId} placeholder={p.balanceCredentialsConfigured?'已保存，可填写新凭据替换':'填写费用只读凭据 ID'} onChange={e=>setCredentials(c=>({...c,accessKeyId:e.target.value}))}/></label>
   <label className="grid gap-2 text-sm">AccessKey Secret<Input autoComplete="off" spellCheck={false} maxLength={256} value={credentials.accessKeySecret} placeholder="填写配套的 Secret" onChange={e=>setCredentials(c=>({...c,accessKeySecret:e.target.value}))}/></label>
  </div>
  <details><summary className="cursor-pointer text-sm text-muted-foreground">临时凭据（选填）</summary><label className="mt-3 grid gap-2 text-sm">SecurityToken<Input autoComplete="off" spellCheck={false} maxLength={8192} value={credentials.securityToken} onChange={e=>setCredentials(c=>({...c,securityToken:e.target.value}))}/></label></details>
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">使用阿里云费用只读凭据，和模型、通话配置分开保存。</p><Button type="submit" size="sm" disabled={save.isPending||!credentials.accessKeyId.trim()||!credentials.accessKeySecret.trim()}><Save aria-hidden="true" className="size-4" />{save.isPending?'保存并查询中…':p.settings.balanceSource==='manual'?'保存余额授权':'保存并查询余额'}</Button></div>
 </form>;
}
export function ModelUsagePanel({platform:p,catalog,trackingSince}:{platform:ModelPlatformUsage;catalog:ModelCatalog;trackingSince:string|null}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const [authorizationOpen,setAuthorizationOpen]=useState(false);
 const refresh=useMutation({mutationFn:()=>telephonyApi.refreshModelBalance(org,p.id),onSuccess:d=>{void qc.invalidateQueries({queryKey:['model-usage']});void qc.invalidateQueries({queryKey:['model-alerts']});const result=d.platforms.find(v=>v.id===p.id);if(result?.balanceError)toast.error(result.balanceError);else toast.success('余额已刷新');},onError:(e:Error)=>toast.error(e.message)});
 const percent=p.settings.monthlyTokenLimit===null?null:Math.min(100,p.totalTokens/p.settings.monthlyTokenLimit*100);
 const balanceStatus=balanceStatusText(p);
 return <section className="overflow-hidden rounded-xl border bg-card" aria-label={p.name+'用量与余额'}>
  <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><h3 className="text-sm font-semibold">用量与余额</h3><div className="flex items-center gap-3"><a href={p.billingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">官方账单<ExternalLink aria-hidden="true" className="size-3"/></a>{p.settings.balanceSource==='auto'&&<Button size="xs" type="button" variant="ghost" disabled={refresh.isPending||!p.configured} onClick={()=>refresh.mutate()} className="h-7 gap-1 px-2 text-sm font-normal"><RefreshCw aria-hidden="true" className={'size-3 '+(refresh.isPending?'animate-spin motion-reduce:animate-none':'')}/>{refresh.isPending?'刷新中…':'刷新余额'}</Button>}</div></div>
  <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
   <div title={p.balanceScope+(p.balanceCheckedAt?' · 更新于 '+new Date(p.balanceCheckedAt).toLocaleString('zh-CN'):' · 尚无已同步余额')}><div className="flex items-center gap-2 text-sm text-muted-foreground"><span>{p.id==='qwen'?'阿里云账户可用额度':'平台余额'}</span><span className={'rounded px-1.5 py-0.5 text-xs '+(p.balanceError||p.balanceStale?'bg-amber-500/10 text-amber-700 dark:text-amber-400':'bg-muted')}>{balanceStatus}</span></div><p className="mt-2 text-xl font-semibold tabular-nums">{balanceText(p)}</p>{p.balances.filter(b=>b.currency!==(p.balances.find(b=>b.currency===p.settings.currency)??p.balances[0])?.currency).map(b=><p key={b.currency} className="mt-1 text-sm text-muted-foreground">{b.available.toFixed(2)} {b.currency}</p>)}</div>
   <div><p className="text-sm text-muted-foreground">本月已记录 Token</p><p className="mt-2 text-xl font-semibold tabular-nums">{tokenNumber(p.totalTokens)}</p></div>
   <div><p className="text-sm text-muted-foreground">今日已记录 Token</p><p className="mt-2 text-xl font-semibold tabular-nums">{tokenNumber(p.todayTokens)}</p></div>
   <div><p className="text-sm text-muted-foreground">本月提醒额度剩余</p><p className="mt-2 text-xl font-semibold tabular-nums">{p.remainingBudget===null?'未设置':tokenNumber(p.remainingBudget)}</p>{percent!==null&&<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="月度提醒额度使用比例" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><div className={'h-full rounded-full '+(percent>=p.settings.tokenWarningPercent?'bg-amber-500':'bg-primary')} style={{width:percent+'%'}}/></div>}</div>
  </div>
  {(p.balanceError||balanceNeedsAuthorization(p))&&<p role="status" className="mx-4 mb-3 text-sm text-amber-700 dark:text-amber-400">{balanceNeedsAuthorization(p)?<>余额查询需单独授权，模型调用不受影响。<button type="button" className="ml-2 underline underline-offset-2" onClick={()=>setAuthorizationOpen(true)}>配置余额授权</button></>:p.balanceError}</p>}
  {p.id==='qwen'&&<p className="mx-4 mb-3 text-sm text-muted-foreground">此额度包含阿里云其他产品，百炼费用以官方账单为准。</p>}
  <details className="border-t px-4 py-3"><summary className="cursor-pointer text-sm font-medium">用量明细<span className="ml-2 font-normal text-muted-foreground">输入 {tokenNumber(p.inputTokens)} · 输出 {tokenNumber(p.outputTokens)}</span></summary><div className="overflow-x-auto pt-3"><table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-b text-muted-foreground">{['模型 / 用途','输入','输出','合计'].map(h=><th key={h} className="pb-2 font-normal">{h}</th>)}</tr></thead><tbody>{p.models.map(m=><tr key={m.modelId+m.purpose} className="border-b last:border-0"><td className="py-2.5"><span>{catalog.models.find(v=>v.id===m.modelId)?.name??m.modelId}</span><span className="ml-2 text-muted-foreground">{purposeLabel[m.purpose]??m.purpose}</span></td><td>{tokenNumber(m.inputTokens)}</td><td>{tokenNumber(m.outputTokens)}</td><td>{tokenNumber(m.totalTokens)}</td></tr>)}{!p.models.length&&<tr><td colSpan={4} className="py-4 text-muted-foreground">暂无用量记录</td></tr>}</tbody></table></div><p className="mt-3 text-sm leading-5 text-muted-foreground">{p.month} · 本系统已记录 {p.requests} 次模型响应 · 音频输入 {tokenNumber(p.inputAudioTokens)} / 输出 {tokenNumber(p.outputAudioTokens)} · 缓存 {tokenNumber(p.cachedTokens)}{p.missingUsage>0&&<span className="text-amber-700 dark:text-amber-400"> · {p.missingUsage} 次未返回完整用量</span>}</p><p className="mt-1 text-sm leading-5 text-muted-foreground">{trackingSince?'自 '+new Date(trackingSince).toLocaleDateString('zh-CN')+' 起记录。':''}历史消耗及其他系统调用以官方账单为准。</p></details>
  <details className="border-t px-4 py-3"><summary className="cursor-pointer text-sm font-medium">余额与预警设置<span className="ml-2 font-normal text-muted-foreground">{p.settings.alertsEnabled?'首页提醒已开启':'首页提醒已关闭'}</span></summary><AlertSettings key={org+p.id} platform={p}/></details>
  {p.id==='qwen'&&<details open={authorizationOpen} onToggle={e=>setAuthorizationOpen(e.currentTarget.open)} className="border-t px-4 py-3"><summary className="cursor-pointer text-sm font-medium">阿里云余额授权<span className="ml-2 font-normal text-muted-foreground">{p.balanceCredentialsConfigured?'已配置':'待配置'}</span></summary><BillingAuthorization key={org} platform={p}/></details>}
 </section>;
}
