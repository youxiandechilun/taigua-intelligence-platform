/*
 * 中文导读：线路与语音外呼：model-platforms.ts。相关类型、配置或辅助实现集中在本文件。
 */
export const modelPlatforms = [
  { id: 'qwen', name: '阿里云百炼', vendor: '阿里云百炼', key: 'DASHSCOPE_API_KEY', balance: 'aliyun', billingUrl: 'https://usercenter2.aliyun.com/finance/assets/balance' },
  { id: 'stepfun', name: '阶跃星辰', vendor: '阶跃星辰', key: 'STEPFUN_API_KEY', balance: 'stepfun', billingUrl: 'https://platform.stepfun.com/account-info' },
  { id: 'deepseek', name: 'DeepSeek', vendor: '深度求索', key: 'DEEPSEEK_API_KEY', balance: 'deepseek', billingUrl: 'https://platform.deepseek.com/usage' },
  { id: 'zhipu', name: '智谱', vendor: '智谱', key: 'ZHIPU_API_KEY', balance: 'manual', billingUrl: 'https://bigmodel.cn/finance/overview' },
] as const;
export type ModelPlatformId = typeof modelPlatforms[number]['id'];
