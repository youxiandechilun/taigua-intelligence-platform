/*
 * 中文导读：知识库的 kb-error-copy 组件，封装该界面的展示与交互。
 */
import type { KnowledgeSource } from "@/src/lib/api/types";
import { userMessage } from "@/src/lib/locale";

export interface KbErrorCopy {
  reason: string;
  guidance: string;
}

export function getKbErrorCopy(
  source: Pick<
    KnowledgeSource,
    "errorCode" | "errorMessage" | "errorRetryable" | "sourceType"
  >,
): KbErrorCopy {
  const reason = userMessage(
    source.errorMessage?.trim() ||
    "文档处理失败，尚未记录详细错误信息。",
    source.errorCode ?? undefined,
  );

  const guidanceByCode: Record<string, string> = {
    KB_EMPTY_TEXT:
      "请上传包含可选中文字的文件。扫描版 PDF 请先进行 OCR 文字识别，再上传。",
    KB_DOWNLOAD_TOO_LARGE:
      "请将文档拆分或压缩为较小文件，再分别上传。",
    KB_CHUNK_LIMIT_EXCEEDED:
      "请缩短文档，或按主题拆分为较小文件后重新上传。",
    KB_UNSUPPORTED_FILE_CONTENT_TYPE:
      "请将文件转换为 PDF、DOCX、TXT、CSV、XLSX 或 XLS 后上传。",
    KB_UNSUPPORTED_URL_CONTENT_TYPE:
      "请使用可公开访问的网页直达链接，不要使用下载、图片或媒体链接。",
    KB_URL_REQUIRED:
      "请填写完整网页网址，再重新添加资料。",
    KB_URL_UNSUPPORTED_SCHEME:
      "请使用以 http:// 或 https:// 开头的网址。",
    KB_URL_HOST_REQUIRED:
      "请填写包含公开域名的完整网址。",
    KB_URL_CREDENTIALS_NOT_ALLOWED:
      "请移除网址中的用户名或密码，并使用公开链接。",
    KB_URL_PRIVATE_HOST:
      "请使用可公开访问的网址，本机和内网地址无法建立索引。",
    KB_URL_HOST_NOT_ALLOWED:
      "请使用工作区允许的域名网址，或联系管理员。",
    KB_URL_HOST_UNRESOLVED:
      "请检查网址是否拼写正确，并确认网页可公开访问，再重新添加。",
    KB_TOO_MANY_REDIRECTS:
      "请在浏览器打开网址，复制跳转后的最终网址，再使用该网址添加资料。",
    KB_FILE_URL_REQUIRED:
      "请删除此失败条目并重新上传文件，以便 泰卦电销智能体 读取。",
    KB_FILE_UNAVAILABLE:
      "请删除此失败条目并重新上传文件。上传完成前请保持浏览器打开。",
    KB_PROCESSING_TIMEOUT:
      "请重新上传文档。如果再次超时，请先拆分为较小文件。",
    KB_PROCESSING_RESULT_MISSING:
      "请删除此失败条目并重新上传文档。",
    KB_VECTOR_STORE_API_KEY_INVALID:
      "请联系工作区管理员修正知识库处理配置，再重新上传文档。",
    KB_VECTOR_STORE_API_KEY_MISSING:
      "请联系工作区管理员配置知识库处理功能，再重新上传文档。",
    KB_VECTOR_STORE_HOST_MISSING:
      "请联系工作区管理员配置知识库处理功能，再重新上传文档。",
    KB_PROCESSING_NOT_CONFIGURED:
      "再次上传前，请联系管理员完成知识库处理配置。",
    KB_PROCESSING_UNAVAILABLE:
      "请删除此失败条目后重新上传。如果仍然失败，请联系工作区管理员。",
  };

  const guidance = source.errorCode
    ? guidanceByCode[source.errorCode]
    : undefined;

  return {
    reason,
    guidance:
      guidance ||
      (source.errorRetryable
        ? "请删除此失败条目后重新上传。如果仍然失败，请联系工作区管理员。"
        : `请检查${source.sourceType === "URL" ? "网址" : "文档"}，修正问题后重新上传。`),
  };
}
