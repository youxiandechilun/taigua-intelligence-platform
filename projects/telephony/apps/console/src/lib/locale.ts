/*
 * 中文导读：共享基础能力：locale.ts。相关类型、配置或辅助实现集中在本文件。
 */
import messages from "./locale-messages.json";

// Localize presentation only. API IDs, enum values, and custom names are preserved.
const labels: Record<string, string> = {
  owner: "所有者", admin: "管理员", member: "成员", user: "用户",
  create: "创建", read: "查看", update: "修改", delete: "删除",
  pending: "待处理", accepted: "已接受", rejected: "已拒绝",
  canceled: "已取消", cancelled: "已取消", expired: "已过期",
  active: "已启用", suspended: "已停用", paused: "已暂停",
  scheduled: "已计划", in_progress: "进行中", needs_review: "结果待核对", completed: "已完成",
  failed: "失败", not_answered: "未接听", processed: "已处理",
  error: "失败", processing: "处理中", queued: "排队中",
  importing: "正在导入", imported: "已导入", draft: "草稿",
  release_pending: "等待释放", releasing: "正在释放", released: "已释放",
  inbound: "呼入", outbound: "呼出", quick: "单次外呼", batch: "批量外呼",
  instant: "立即", later: "稍后", unmetered: "不按平台用量计费",
  self_hosted: "自行部署", prepaid: "预付费", blocked: "已暂停",
  paid: "已支付", trialing: "试用中", past_due: "已逾期",
  string: "文本", text: "文本", number: "数字", boolean: "是 / 否",
  date: "日期", enum: "选项", object: "对象", array: "列表",
  "LLM Prompt": "模型提取提示", "Static Value": "固定值", "Dynamic Variable": "动态变量",
  feminine: "女声", masculine: "男声", neutral: "中性",
  American: "美式", British: "英式", Indian: "印度口音", Australian: "澳大利亚口音",
  Clear: "清晰", Confident: "自信", Energetic: "有活力", Comfortable: "舒适",
  Smooth: "流畅", Warm: "温暖", Professional: "专业", Deep: "低沉",
  Trustworthy: "可信赖", Friendly: "亲切", Natural: "自然", Baritone: "男中音",
  Calm: "平静", Narrative: "叙事", "Well-rounded": "均衡", Soft: "柔和",
  Conversational: "自然对话", Expressive: "富有表现力", Bright: "明亮",
  Gentle: "温柔", Serious: "严肃", Mature: "成熟", Youthful: "年轻",
  Advertising: "广告", Informative: "信息讲解", IVR: "电话语音菜单",
  Storytelling: "故事讲述", Narration: "旁白", Configured: "已配置",
  summary: "摘要", intent: "客户意向", reason: "通话原因",
  outboundId: "外呼编号", fromNumber: "主叫号码", toNumber: "被叫号码",
  provider: "服务商", zeroPiiRetention: "不保留个人信息", retentionDays: "保留天数",
  transcript: "文字记录", audio_url: "录音链接", language: "语言",
  minutes: "分钟", call: "通话", minute: "分钟", duration: "时长",
  connected: "已连接", disconnected: "已断开", failed_to_connect: "连接失败",
  success: "成功", passed: "通过", pass: "通过", fail: "未通过", unknown: "未知",
  top_up: "充值", promotional: "赠送额度", adjustment: "调整", refund: "退款",
  authorized: "已授权", settled: "已结算", credited: "已入账", reversed: "已冲回",
  refunded: "已退款", disputed: "支付争议", held: "已预留", owed: "待支付",
  recorded: "已记录", microphone: "麦克风", session: "试聊会话",
  network: "网络连接", live: "实时试聊",
};
const translations: Record<string, string> = messages;

export function uiLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return labels[value] ?? labels[value.toLowerCase()] ?? translations[value] ?? value;
}

export function roleLabel(value: string): string {
  return value.split(",").map((role) => uiLabel(role.trim())).join("、");
}

export function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const authErrors: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确，请重新输入。",
  EMAIL_NOT_VERIFIED: "请先验证邮箱，再登录。",
  USER_ALREADY_EXISTS: "此邮箱已注册，请登录或重置密码。",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "此邮箱已注册，请登录或重置密码。",
  INVALID_ORIGIN: "当前登录地址未获允许，请使用系统正式访问地址。",
  INVALID_TOKEN: "验证链接无效或已过期，请重新申请。",
  SESSION_EXPIRED: "登录已过期，请重新登录。",
  UNAUTHORIZED: "请先登录，再继续操作。",
  FORBIDDEN: "你没有执行此操作的权限，请联系管理员。",
  RATE_LIMITED: "操作过于频繁，请稍后重试。",
  VOICE_RUNTIME_UNAVAILABLE: "语音服务暂不可用，请先完成语音服务配置。",
  KB_EMPTY_TEXT: "资料中未找到可读取的文字。",
  KB_DOWNLOAD_TOO_LARGE: "文档超过允许的文件大小。",
  KB_CHUNK_LIMIT_EXCEEDED: "文档内容超过知识库的处理上限。",
  KB_UNSUPPORTED_FILE_CONTENT_TYPE: "当前文件格式不受支持。",
  KB_UNSUPPORTED_URL_CONTENT_TYPE: "链接内容不是可处理的网页。",
  KB_URL_REQUIRED: "尚未填写资料网址。",
  KB_URL_UNSUPPORTED_SCHEME: "网址必须以 http:// 或 https:// 开头。",
  KB_URL_HOST_REQUIRED: "网址缺少域名。",
  KB_URL_CREDENTIALS_NOT_ALLOWED: "资料网址不能包含用户名或密码。",
  KB_URL_PRIVATE_HOST: "本机或内网地址无法作为公开知识资料。",
  KB_URL_HOST_NOT_ALLOWED: "当前域名未获工作区允许。",
  KB_URL_HOST_UNRESOLVED: "无法解析网址的域名。",
  KB_TOO_MANY_REDIRECTS: "资料网址跳转次数过多。",
  KB_FILE_URL_REQUIRED: "文档上传链接缺失。",
  KB_FILE_UNAVAILABLE: "已上传的文档暂不可用。",
  KB_PROCESSING_TIMEOUT: "资料处理超时。",
  KB_PROCESSING_RESULT_MISSING: "未获取到资料处理结果。",
  KB_VECTOR_STORE_API_KEY_INVALID: "知识库服务的密钥无效。",
  KB_VECTOR_STORE_API_KEY_MISSING: "知识库服务尚未配置密钥。",
  KB_VECTOR_STORE_HOST_MISSING: "知识库服务尚未配置地址。",
  KB_PROCESSING_NOT_CONFIGURED: "知识库处理功能尚未配置。",
  KB_PROCESSING_UNAVAILABLE: "知识库处理服务暂不可用。",
};

export function userMessage(message: string, code?: string): string {
  if (code === "INTERNAL_SERVER_ERROR" || /something went wrong|internal server error|bad gateway|service unavailable/i.test(message)) return "服务暂时异常，请稍后重试；如仍无法使用，请联系管理员。";
  if (code && authErrors[code]) return authErrors[code];
  const exact = translations[message] ?? translations[message.replaceAll("泰卦电销智能体", "QuickVoice").replaceAll("泰卦数字员工", "QuickVoice")];
  if (exact) return exact;
  if (/Invalid email or password/i.test(message)) return authErrors.INVALID_EMAIL_OR_PASSWORD;
  if (/email (is )?not verified/i.test(message)) return authErrors.EMAIL_NOT_VERIFIED;
  if (/network error|failed to fetch|fetch failed/i.test(message)) return "无法连接服务器，请检查网络和服务器状态。";
  if (/too many requests|rate limit/i.test(message)) return authErrors.RATE_LIMITED;
  if (/not configured|configuration.*missing|missing.*credentials/i.test(message)) return "相关服务尚未配置，请先完成服务配置。";
  if (/permission|forbidden|access denied/i.test(message)) return authErrors.FORBIDDEN;
  if (/unauthorized|session expired/i.test(message)) return authErrors.UNAUTHORIZED;
  if (!/[\u4e00-\u9fff]/.test(message) && /error|failed|could not|cannot|unable|invalid|not available|not supported|unavailable|required/i.test(message)) {
    return "操作未完成，请检查当前配置后重试；如仍失败，请联系技术支持。";
  }
  return message;
}
