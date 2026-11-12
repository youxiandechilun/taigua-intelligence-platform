/*
 * 中文导读：共享基础能力：toast.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { toast as sonnerToast } from "sonner";
import { businessMessage } from "./business-copy";
import { userMessage } from "./locale";

// Provider error strings are localized at the notification boundary.
export const toast: typeof sonnerToast = new Proxy(sonnerToast, {
  get(target, key) {
    if (key !== "error") return Reflect.get(target, key);
    return (...args: Parameters<typeof sonnerToast.error>) => target.error(
      typeof args[0] === "string" ? businessMessage(userMessage(args[0])) : args[0],
      args[1],
    );
  },
});
