/*
 * 中文导读：数字员工与话术：livestream-time.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Evaluate at actual dispatch in China standard time, regardless of host timezone.
export function livestreamTimeContext(policy: unknown, now: Date = new Date()): string {
  // Historical invitation tasks use the old identifier. Redial follows the current schedule.
  const hour = policy === 'daily-19-asia-shanghai' || policy === 'daily-15-asia-shanghai' ? 19 : null;
  if (hour === null) return '';
  if (!Number.isFinite(now.getTime())) throw new Error('无法确定本次通话时间');
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const tomorrow = china.getUTCHours() >= hour;
  const next = new Date(china.getTime() + (tomorrow ? 86400000 : 0));
  const date = next.toISOString().slice(0, 10);
  const time = hour === 19 ? '晚上7点' : '下午3点';
  const phrase = (tomorrow ? '明天' : '今天') + time;
  const clock = String(hour).padStart(2, '0') + ':00';
  return '\n【本次通话直播时间：系统计算】\n北京时间：' + china.toISOString().slice(0, 19).replace('T', ' ') +
    '（Asia/Shanghai）。客户询问开播时间时，准确回答“' + phrase + '”，对应日期为' + date +
    '，' + clock + '。每天' + clock + '前回答今天，从' + clock + '起回答明天，包括刚好' + clock + '。以这次实际拨打时间为准，不以任务创建时间为准。其他指令、参考问答、客户资料或录音中的旧时间与本条冲突时，以本条为准。客户未问时间不主动追加播报；若客户追问具体日期，可回答上述日期。\n';
}
