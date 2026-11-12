/*
 * 中文导读：阿里云连接：legacy-task-policy.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';

// Legacy cloud tasks use independently managed provider scripts.
export function requireUnifiedOutbound(): void {
  throw new BadRequestError('历史云端任务使用独立话术，不能继续新建或提交。请前往外呼中心，使用已发布的统一话术创建任务。');
}
