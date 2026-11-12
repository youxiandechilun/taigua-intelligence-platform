/*
 * 中文导读：共享基础能力：keyword-list.ts。相关类型、配置或辅助实现集中在本文件。
 */
export const parseKeywordList = (value: string): string[] =>
  [...new Set(value.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean))];

export function validateKeywordLength(values: string[], maxLength: number, label: string) {
  if (values.some(value => value.length > maxLength)) {
    throw new Error(`${label}每项最多 ${maxLength} 字，请修改后保存，当前输入已保留。`);
  }
}

export const keywordListsEqual = (expected: string[], actual: string[]): boolean =>
  expected.length === actual.length && expected.every((value, index) => value === actual[index]);
