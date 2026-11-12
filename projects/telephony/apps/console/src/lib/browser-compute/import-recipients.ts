/*
 * 中文导读：共享基础能力：import-recipients.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {readExcelRows} from '@/src/lib/import-excel';
import {aliyunApi} from '@/src/lib/api/resources/aliyun';
import {browserComputeProfile,localTask} from './runtime';

const parsedFiles=new WeakMap<File,Promise<string[][]>>();
async function parseTableRows(file:File) {
  if(file.size>5*1024*1024)throw new Error('文件最大5MB，请拆分文件。');
  if(file.name.toLowerCase().endsWith('.xlsx'))return readExcelRows(file);
  return localTask('csv',(await file.text()).replace(/^\uFEFF/,''));
}
export function readTableRows(file:File) {
  let pending=parsedFiles.get(file);
  if(!pending){pending=parseTableRows(file).catch(error=>{parsedFiles.delete(file);throw error;});parsedFiles.set(file,pending);}
  return pending;
}

export async function importRecipients(file:File,org:string) {
  if(!/\.(csv|xlsx)$/i.test(file.name)||file.size>2000000)throw new Error('请选择2MB以内的 CSV 或 XLSX 表格。');
  const profile=await browserComputeProfile();
  // Keep regional phone resolution and older browsers on the existing authenticated path.
  if(profile.workers&&!(profile.lowPower&&file.size>512000)) {
    try { return await localTask('recipients',await readTableRows(file)); } catch { /* Existing server validation supplies the final import result. */ }
  }
  const content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file);});
  return aliyunApi.importFile(file.name,content,org);
}
