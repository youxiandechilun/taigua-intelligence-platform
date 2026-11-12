/*
 * 中文导读：通话失败原因和错误明细展示。
 */
import { callFailure } from '@/src/lib/api/call-diagnostics';

export function CallFailureCode({ metadata, status }: { metadata: unknown; status: string }) {
  const failure = callFailure(metadata, status);
  return failure ? <span className="block max-w-56 break-all font-mono text-xs leading-5 text-muted-foreground" title={failure.message}>{failure.code}</span> : null;
}

export function CallFailureDetails({ metadata, status }: { metadata: unknown; status: string }) {
  const failure = callFailure(metadata, status);
  if (!failure) return null;
  const { reason, diagnostics, message } = failure;
  const leg = diagnostics?.leg === 'EMPLOYEE' ? '员工接听侧' : diagnostics?.leg === 'CUSTOMER' ? '客户接听侧' : '未记录';
  const fields = [
    ['系统原因代码', reason || '未记录'],
    ['SIP 返回码', diagnostics?.sipStatus === undefined ? '未记录' : String(diagnostics.sipStatus)],
    ['挂断原因', diagnostics?.cause || '未记录'],
    ['SIP 结束标记', diagnostics?.sipDisposition || '未记录'],
    ['呼叫阶段', leg],
  ];
  return <section aria-label="通话返回与结束原因" className="space-y-3 rounded-lg border bg-card p-4">
    <h3 className="text-sm font-semibold">通话返回与结束原因</h3>
    <p className="break-words text-sm leading-6">{message}</p>
    <dl className="space-y-2">{fields.map(([label, value]) => <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-xs"><dt className="text-muted-foreground">{label}</dt><dd className="break-all font-mono">{value}</dd></div>)}</dl>
    {reason === 'VOICE_SERVICE_ERROR' && <p className="text-xs leading-5 text-muted-foreground">这是语音服务异常记录；SIP 返回码单独展示，模型接口的错误码需结合服务日志核对。</p>}
  </section>;
}
