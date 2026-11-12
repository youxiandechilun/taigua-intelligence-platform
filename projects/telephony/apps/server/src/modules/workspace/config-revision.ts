/*
 * 中文导读：对配置内容生成稳定版本号，并在保存时发现多人修改冲突。
 */
import { createHash } from 'node:crypto';
import CustomApiError from '../../common/errors/customApiError.js';

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}
/* 中文注释：先稳定排序对象键，再计算配置哈希，避免仅键顺序变化造成版本差异。 */


export function configurationRevision(value: unknown) {
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
/* 中文注释：比较提交版本和当前版本；不一致返回冲突，避免覆盖其他人的新设置。 */


// Compare under the same transaction lock used by every writer of this config.
export function assertConfigurationRevision(expected: string | undefined, current: unknown) {
  if (!expected || expected !== configurationRevision(current)) throw new CustomApiError('设置已被其他页面修改或页面版本过旧，当前输入已保留，请刷新并核对后再保存。', 409);
}
