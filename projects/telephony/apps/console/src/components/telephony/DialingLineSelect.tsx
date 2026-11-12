/*
 * 中文导读：拨号线路选择控件。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import { RefreshCw } from "lucide-react";
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { telephonyApi } from '@/src/lib/api/resources/telephony';
import { useCompanyContext, hasCompanyPermission } from '@/src/lib/api/resources/company';
import { dialingLines, dialProvinceName, selectedDialLine, type DialSelection } from '@/src/lib/outbound/dialing-lines';
import { Button } from '@/src/components/ui/button';

export function useDialingLines(enabled = true, ownerId?: string) {
  const { org, user } = useAliyunIdentity(), company = useCompanyContext();
  const lineOwner = ownerId || user;
  const query = useQuery({
    queryKey: ['telephony', user, org, 'dialing-lines', lineOwner],
    queryFn: async () => { const [callers, regional] = await Promise.all([telephonyApi.callers(org), telephonyApi.lines(org)]); return dialingLines(callers, regional, lineOwner, company.data?.isSystemAdmin === true && lineOwner === user); },
    enabled: enabled && !!org && !!user && !!company.data,
    staleTime: 15000, refetchInterval: enabled ? 30000 : false, refetchIntervalInBackground: false, retry: false,
  });
  return { ...query, data: query.data || [], canManage: hasCompanyPermission(company.data, 'lines', 'assign') };
}

export function DialingLineSelect({ value, onChange, disabled = false, compact = false }: { value: DialSelection; onChange: (value: DialSelection) => void; disabled?: boolean; compact?: boolean }) {
  const query = useDialingLines();
  const selected = selectedDialLine(query.data, value);
  const suppliers=[...new Set(query.data.filter(line=>line.provider==='HAOKEHU_SIP').map(line=>line.serviceProvider||'好客呼'))];
  const supplier=value.serviceProvider||selected?.serviceProvider||suppliers[0]||'好客呼';
  const routes = query.data.filter(line => line.provider === value.provider&&(value.provider!=='HAOKEHU_SIP'||(line.serviceProvider||'好客呼')===supplier));
  const provinces = [...new Set(routes.flatMap(line => line.provinces))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const lines = routes.filter(line => line.provinces.includes(value.province));
  const style = 'h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm disabled:opacity-50';
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <div className={'grid gap-3 ' + (compact ? '' : 'sm:grid-cols-3')}>
      <label className="grid min-w-0 gap-2 text-sm">线路供应商<NativeSelect aria-label="线路供应商" className={style} value={value.provider==='ALIYUN_ENGINE'?'aliyun':'sip:'+supplier} onChange={event => onChange({ provider: event.target.value==='aliyun'?'ALIYUN_ENGINE':'HAOKEHU_SIP',serviceProvider:event.target.value==='aliyun'?undefined:event.target.value.slice(4), province: '', lineId: '' })}>{(suppliers.length?suppliers:['好客呼']).map(name=><option key={name} value={'sip:'+name}>{name}</option>)}<option value="aliyun">阿里云</option></NativeSelect></label>
      <label className="grid min-w-0 gap-2 text-sm">省份 / 范围<NativeSelect aria-label="线路省份" className={style} required disabled={query.isPending || query.isError || !provinces.length} value={value.province} onChange={event => onChange({ ...value, province: event.target.value, lineId: '' })}><option value="">{query.isPending ? '读取中…' : provinces.length ? '请选择省份或范围' : '暂无已配置线路'}</option>{provinces.map(province => <option key={province} value={province}>{dialProvinceName(province)}</option>)}</NativeSelect></label>
      <label className="grid min-w-0 gap-2 text-sm">具体线路<NativeSelect aria-label="具体线路" className={style} required disabled={!value.province || query.isPending || query.isError} value={selected?.id || ''} onChange={event => onChange({ ...value, lineId: event.target.value })}><option value="">请选择线路</option>{lines.map(line => <option key={line.id} value={line.id}>{line.name}{!line.enabled ? '（未启用）' : !line.ready ? '（待完善）' : ''}</option>)}</NativeSelect></label>
    </div>
    {query.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>线路读取失败：{query.error.message}</span><Button type="button" variant="link" size="sm" onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新读取</Button></div> : selected && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground"><span>主叫标识 <span className="ml-2 tabular-nums text-foreground">{selected.identifier}</span></span>{!selected.enabled || !selected.ready ? <span className="text-amber-700">{!selected.enabled ? '线路未启用，可保存任务草稿' : '线路配置待完善，可保存任务草稿'}</span> : null}</div>}
    {!query.isPending && !query.error && !routes.length && <p className="text-sm text-muted-foreground">当前账号暂无可选线路。{query.canManage && <Link href="/settings/telephony" className="ml-2 text-primary hover:underline">管理线路</Link>}</p>}
  </fieldset>;
}
