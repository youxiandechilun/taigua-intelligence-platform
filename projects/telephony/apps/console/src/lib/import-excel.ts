/*
 * 中文导读：共享基础能力：import-excel.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { strFromU8 } from 'fflate';
import { localTask } from './browser-compute/runtime';
export { normalizeHeader as normalizeSpreadsheetHeader } from './browser-compute/tasks';
export async function readExcelRows(file: File): Promise<string[][]> {
 if(file.size>5*1024*1024)throw new Error('文件最大5MB，请拆分文件。');
 const files=await localTask('unzip',await file.arrayBuffer());
 const read=(path: string)=>{const bytes=files[path];if(!bytes)throw new Error('Excel 缺少工作表。');const text=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('不支持的 Excel XML 声明。');const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.getElementsByTagName('parsererror').length)throw new Error('Excel 格式损坏。');return xml;};
 const book=read('xl/workbook.xml');const sheet=Array.from(book.getElementsByTagName('sheet')).find(s=>['客户名单','客户资料','外呼客户','业务知识'].includes(s.getAttribute('name')??''))??book.getElementsByTagName('sheet')[0];
 const rel=Array.from(read('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')).find(r=>r.getAttribute('Id')===sheet?.getAttribute('r:id'));
 const target=rel?.getAttribute('Target')??'worksheets/sheet1.xml';if(target.includes('..'))throw new Error('工作表路径不支持。');
 const shared=files['xl/sharedStrings.xml']?Array.from(read('xl/sharedStrings.xml').getElementsByTagName('si')).map(s=>s.textContent??''):[];
 return Array.from(read(target.startsWith('/')?target.slice(1):'xl/'+target).getElementsByTagName('row')).map(row=>{const result:string[]=[];for(const c of Array.from(row.getElementsByTagName('c'))){if(c.getElementsByTagName('f').length)throw new Error('表格包含公式，请先粘贴为文本。');const col=(c.getAttribute('r')??'A').match(/^[A-Z]+/)?.[0]??'A';const i=[...col].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0)-1;if(i>80)throw new Error('表格列数过多。');const v=c.getElementsByTagName('v')[0]?.textContent??'';result[i]=c.getAttribute('t')==='s'?shared[Number(v)]??'':c.getAttribute('t')==='inlineStr'?c.getElementsByTagName('is')[0]?.textContent??'':v;}return result;}).filter(row=>row.some(v=>v.trim()));
}
