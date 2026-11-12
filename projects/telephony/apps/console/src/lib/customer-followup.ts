/*
 * 中文导读：共享基础能力：customer-followup.ts。相关类型、配置或辅助实现集中在本文件。
 */
export type CustomerIntent = "interested" | "unclear" | "uninterested" | "optout";
export type CustomerRecognitionStatus = "provisional" | "confirmed";
export type WechatStage = "pending" | "requested" | "added" | "sent" | "deferred" | "failed" | "closed";
export const intentLabels: Record<CustomerIntent, string> = { interested: "有意向", unclear: "未明确意向", uninterested: "无意向", optout: "拒绝联系" };
export const wechatLabels: Record<WechatStage, string> = { pending: "待加微信", requested: "申请已发送", added: "已加微信", sent: "已发直播链接", deferred: "暂缓联系", failed: "添加失败", closed: "已停止联系" };
export type FollowupActivity = { at: string; actor: string; title: string; note: string };
export type CustomerOverview = {
  id: string; phone: string; name: string; ownerId: string | null; ownerName: string;
  intent: CustomerIntent; stage: WechatStage; callCount: number; updatedAt: string; demo?: boolean;
  dueAt: string | null; readOnly: boolean; followedUp: boolean; hasAddedWechat: boolean;
  recognitionStatus?: CustomerRecognitionStatus; temporary?: boolean;
  readAt?: string | null; readRevision?: string;
};
export type CustomerRecord = CustomerOverview & {
  company: string; wechatId: string; wechatConsent: boolean; evidence: string; summary: string;
  history: FollowupActivity[]; callIds: string[]; createdAt: string; version: number;
  resumeStage?: WechatStage; latestAt: string;
};
export type FollowupCallState = { id: string; intent: CustomerIntent; customerId: string | null; stage: WechatStage | null; summary: string; source: string; demo?: boolean; recognitionStatus?: CustomerRecognitionStatus; temporary?: boolean };
export type FollowupCall = { id: string; at: string | null; duration: number | null; status: string; audio: string | null; transcriptError?: boolean; transcriptMore?: boolean; transcript: { speaker: string; text: string }[]; intent: CustomerIntent; summary: string };
export type CustomerSnapshot = {
  rows: CustomerOverview[]; total: number; page: number; pageSize: number; canAssign: boolean;
  staff: { id: string; name: string }[]; partial: boolean; syncWarning: string | null;
  counts: { interested: number; pending: number; added: number; sent: number };
};

export function isTemporaryCustomer(customer: Pick<CustomerOverview, "recognitionStatus" | "temporary">) {
  return customer.temporary === true || customer.recognitionStatus === "provisional";
}

export async function followupRequest<T>(workspace: string, path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/customer-followup${path}`, {
    ...init, cache: "no-store", headers: { "x-workspace-id": workspace, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "客户资料暂时不可用，请稍后重试。");
  return data as T;
}

export function followupDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
