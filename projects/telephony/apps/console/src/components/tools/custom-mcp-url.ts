/*
 * 中文导读：工具管理的 custom-mcp-url 组件，封装该界面的展示与交互。
 */
export type CustomMcpUrlValidation = {
  isValid: boolean;
  tone: "hint" | "error" | "success";
  message: string;
};

export function validateCustomMcpUrl(value: string): CustomMcpUrlValidation {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      isValid: false,
      tone: "hint",
      message: "请粘贴 MCP 服务商提供的完整 HTTPS 接口地址。",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      tone: "error",
      message: "请输入完整网址，例如 https://server.example.com/mcp。",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      isValid: false,
      tone: "error",
      message: "自定义 MCP 接口必须使用 HTTPS。",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      tone: "error",
      message: "请移除网址中的登录凭据，连接后再完成授权。",
    };
  }

  return {
    isValid: true,
    tone: "success",
    message: "HTTPS 接口格式有效。连接时 泰卦电销智能体 会验证 MCP 服务。",
  };
}
