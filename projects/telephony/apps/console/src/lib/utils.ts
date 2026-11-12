/*
 * 中文导读：共享基础能力：utils.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
