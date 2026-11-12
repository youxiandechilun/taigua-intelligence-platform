/*
 * 中文导读：共享基础能力：business-copy.ts。相关类型、配置或辅助实现集中在本文件。
 */
/** Keep diagnostic detail in ApiError.originalMessage and privileged settings. */
export function businessMessage(message: string, pathname?: string): string {
  const path = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  if (/^\/(settings|secrets)(\/|$)/.test(path)) return message;
  if (/AccessKey|API[ _-]?Key|CorpI[dD]|AgentI[dD]|Secret|Token|凭据|密钥|回调|可信\s*IP|endpoint/i.test(message)) {
    return "服务暂不可用，请联系管理员检查配置。";
  }
  if (/(云端|通信智能体).*(未关联|未绑定|未发布|未生效|待发布)/.test(message)) {
    return "电话话术尚未就绪，请联系管理员确认发布。";
  }
  return message.replace(/阿里云/g, "通话服务").replace(/百炼/g, "文字演练服务");
}
