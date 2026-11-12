/*
 * 中文导读：共享基础能力：express.d.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { auth } from "../lib/auth.js";

type BetterAuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

export interface RequestAuth {
  userId: string;
  activeOrganizationId: string | null;
  authMethod: "session" | "apiKey" | "internal";
  session: BetterAuthSession;
  apiKeyId?: string;
  apiKeyPermissions?: Record<string, string[]>;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: RequestAuth;
  }
}

declare global {
  interface PhoneNumber {
    phId: string;
    number: string;
    userId: string | null;
    agentId: string | null;
    sid: string;
    friendlyName: string;
    // agent?: Agent;
    // user: User;
    createdAt: DateTime;
    updatedAt: DateTime;
    provider: TelephonyProvider;
  }
}
