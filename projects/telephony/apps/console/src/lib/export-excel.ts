/*
 * 中文导读：共享基础能力：export-excel.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { exportWorkbook } from '@repo/spreadsheets';
import { downloadBlobAsFile, type CsvColumn } from './export-csv';
const labels: Record<string,string> = {
 REVIEW:'待审核',READY:'待拨打',CONNECTED:'已接通',INTERESTED:'有意向',FOLLOW_UP:'跟进中',WON:'已成交',INVALID:'无效线索',OPT_OUT:'拒绝联系',
 PROCESSED:'已处理',ACTIVE:'执行中',immediate:'立即执行',scheduled:'预约执行',PENDING:'待处理',SCHEDULED:'待执行',QUEUED:'排队中',RUNNING:'执行中',IN_PROGRESS:'进行中',COMPLETED:'已完成',NOT_ANSWERED:'未接通',FAILED:'失败',CANCELLED:'已取消',DRAFT:'草稿',PAUSED:'已暂停',
 inbound:'呼入',outbound:'呼出',INBOUND:'呼入',OUTBOUND:'呼出',IMMEDIATE:'立即执行',SCHEDULE:'预约执行',
};
export function excelDisplay(value: unknown, header: string): unknown {
 if(value == null)return '';
 if(typeof value==='boolean')return value?'是':'否';
 if(typeof value==='string' && /状态|方向|模式|意向/.test(header))return labels[value]??value;
 if(/时间|日期/.test(header) && (value instanceof Date || typeof value==='string' && /^\d{4}-\d\d-\d\dT/.test(value))){const d=new Date(value);if(Number.isFinite(d.getTime()))return d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});}
 return value;
}
export function downloadExcelMatrix(filename: string, headers: string[], rows: unknown[][], scope = '当前筛选条件下已加载的记录；未加载的分页数据不包含在此文件中。') {
 const bytes=exportWorkbook(headers,rows.map(row=>row.map((v,i)=>excelDisplay(v,headers[i]??''))),filename.replace(/\.xlsx$/i,'').slice(0,31),[['数据范围',scope],['时区','时间均按北京时间显示，时长单位在对应表头注明。']]);
 downloadBlobAsFile(filename,new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
export function downloadRowsAsExcel<T>(filename: string, rows: T[], columns: CsvColumn<T>[], scope?: string) {
 downloadExcelMatrix(filename,columns.map(c=>c.header),rows.map(row=>columns.map(c=>c.value(row))),scope);
}
