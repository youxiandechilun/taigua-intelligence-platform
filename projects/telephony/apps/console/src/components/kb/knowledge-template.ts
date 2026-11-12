/*
 * 中文导读：知识库的 knowledge-template 组件，封装该界面的展示与交互。
 */
import {multiSheetWorkbook} from '@repo/spreadsheets';
import {downloadBlobAsFile} from '@/src/lib/export-csv';
export function knowledgeTemplate(){
 const headers=['知识主题','问题或标题','业务答案'];
 const bytes=multiSheetWorkbook([
  {name:'业务知识',headers,kind:'data',blankRows:25,columnHints:[{column:0,text:'填写业务分类。'},{column:1,text:'填写问题或标题。'},{column:2,text:'填写已确认的业务答案。'}]},
  {name:'填写说明',headers:['说明项','内容'],kind:'notes',rows:[['填写位置','业务知识工作表从第2行开始填写。'],['正文要求','只填写已确认业务资料，保留适用范围、限制、数字和单位。'],['文件要求','不合并单元格，不使用公式，最大8MB。'],['导入后','原资料保留在知识库，AI整理后由负责人审核入库。']],widths:[18,64]},
 ]);
 downloadBlobAsFile('业务知识导入模板.xlsx',new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
