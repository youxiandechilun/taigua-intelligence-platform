/*
 * 中文导读：客户已读状态标识。
 */
import { Check, Circle } from 'lucide-react';

export function CustomerReadBadge({ readAt }: { readAt: string | null | undefined }) {
  if (readAt === undefined) return <span className="text-xs text-muted-foreground" title="阅读状态暂不可用">—</span>;
  return readAt ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground" title={`本账号已于 ${new Date(readAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 查看`}><Check aria-hidden="true" className="size-3" />已读</span> : <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary"><Circle aria-hidden="true" className="size-2 fill-current" />未读</span>;
}
