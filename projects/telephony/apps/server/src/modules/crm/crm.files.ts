/*
 * 中文导读：客户管理：crm.files.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { unzipSync,strFromU8 } from 'fflate';
import { cleanSpreadsheetHeader, isSpreadsheetExampleRow } from '@repo/spreadsheets';
import { XMLParser } from 'fast-xml-parser';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { normalizePhone } from './crm.phone.js';
import { companyInput, contactInput, leadInput } from './crm.schema.js';
import type { Row } from './crm.service.js';
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true,htmlEntities:true});
const array=(v:any)=>v===undefined?[]:Array.isArray(v)?v:[v];
export { multiSheetWorkbook, workbook, crmTemplateWorkbook, aliyunImportTemplateWorkbook, outboundRecipientsTemplateWorkbook } from './crm.templates.js';
export function csvRows(text:string){const first=text.split(/\r?\n/)[0]||'';const delimiter=first.includes('\t')?'\t':first.includes(',')?',':';';const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!cell||quoted)quoted=!quoted;else cell+=c;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}if(quoted)throw new BadRequestError('CSV 引号未闭合。');row.push(cell);if(row.some(Boolean))rows.push(row);return rows;}
export function readWorkbook(bytes:Uint8Array,name:string){if(bytes.length>4*1024*1024)throw new BadRequestError('文件最大4MB，请拆分后导入。');if(!/\.xlsx$/i.test(name)){if(!/\.csv$/i.test(name))throw new BadRequestError('只支持 .xlsx 或 .csv 文件。');let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gb18030').decode(bytes);}return csvRows(text.replace(/^\uFEFF/,''));}
 let total=0,count=0;const files=unzipSync(bytes,{filter:file=>{total+=file.originalSize;count++;if(total>16*1024*1024||count>400)throw new BadRequestError('Excel 解压大小超出限制。');return /^xl\//.test(file.name)&&/\.xml$|\.rels$/.test(file.name);}});
 const read=(path:string)=>{const raw=files[path];if(!raw)return null;const text=strFromU8(raw);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new BadRequestError('Excel 包含不支持的 XML 声明。');return parser.parse(text);};
 const book=read('xl/workbook.xml');const relId=array(book?.workbook?.sheets?.sheet)[0]?.['@_r:id'];const rel=array(read('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship).find(r=>r['@_Id']===relId);let path=rel?.['@_Target']||'worksheets/sheet1.xml';path=path.startsWith('/')?path.slice(1):'xl/'+path;if(path.includes('..'))throw new BadRequestError('不支持的 Excel 工作表路径。');
 const textValue=(v:any):string=>v===undefined?'':typeof v==='object'?String(v['#text']??''):String(v);const shared=array(read('xl/sharedStrings.xml')?.sst?.si).map(si=>si.t!==undefined?textValue(si.t):array(si.r).map(r=>textValue(r.t)).join(''));
 const sheet=read(path);if(!sheet)throw new BadRequestError('找不到 Excel 第一张工作表。');return array(sheet.worksheet?.sheetData?.row).map(r=>{const cells:string[]=[];for(const c of array(r.c)){if(c.f!==undefined)throw new BadRequestError('导入表包含公式，请先粘贴为数值或文本。');const col=String(c['@_r']||'A').match(/^[A-Z]+/)?.[0]||'A';const pos=[...col].reduce((n,char)=>n*26+char.charCodeAt(0)-64,0)-1;if(pos>80)throw new BadRequestError('导入列数过多。');cells[pos]=c['@_t']==='s'?shared[Number(c.v)]||'':c['@_t']==='inlineStr'?c.is?.t!==undefined?textValue(c.is.t):array(c.is?.r).map(v=>textValue(v.t)).join(''):textValue(c.v);}return cells;});
}
const columns:Record<string,string[]>={name:['企业名称','公司名称'],industry:['所属行业','行业'],region:['所在地区','地区'],address:['公司地址','地址'],business:['经营业务','经营的业务','业务'],website:['官网','公司官网'],creditCode:['统一社会信用代码'],phone:['企业联系电话','联系电话','电话号码'],source:['来源','来源网址'],ownerName:['负责人'],status:['客户状态','状态','客户意向'],contactName:['联系人姓名','联系人'],position:['职位'],mobile:['手机号码','手机号'],landline:['座机号码','座机'],areaCode:['座机区号','区号'],extension:['分机号码','分机'],email:['邮箱'],wechatNote:['微信备注'],contactStatus:['联系人状态','联系状态'],doNotCall:['拒绝联系','拒呼状态'],tags:['标签'],nextFollowUp:['下次跟进时间'],notes:['跟进备注','备注']};
const statusLabels:Record<string,string>={待跟进:'REVIEW',继续跟进:'FOLLOW_UP',暂无需求:'INVALID',待审核:'REVIEW',待拨打:'READY',已接通:'CONNECTED',有意向:'INTERESTED',跟进中:'FOLLOW_UP',已成交:'WON',无效线索:'INVALID',拒绝联系:'OPT_OUT',REVIEW:'REVIEW',READY:'READY',CONNECTED:'CONNECTED',INTERESTED:'INTERESTED',FOLLOW_UP:'FOLLOW_UP',WON:'WON',INVALID:'INVALID',OPT_OUT:'OPT_OUT'};
const parseStatus=(value:string, fallback='REVIEW')=>{const v=String(value||'').trim();if(!v)return fallback;if(!statusLabels[v])throw new BadRequestError('状态不正确，请从模板下拉列表选择。');return statusLabels[v]!;};
const parseBoolean=(value:string)=>{const v=String(value||'').trim();if(!v||/^(否|false|0|未拒呼)$/i.test(v))return false;if(/^(是|true|1|拒绝|拒呼|已拒呼)$/i.test(v))return true;throw new BadRequestError('拒绝联系只能填写是或否。');};
function importDate(value:string){
 if(!value)return null;const v=value.trim();
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)){const parsed=leadInput.shape.nextFollowUp.safeParse(v);if(parsed.success)return new Date(v).toISOString();}
 const m=v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
 if(m){const iso=`${m[1]}-${m[2]!.padStart(2,'0')}-${m[3]!.padStart(2,'0')}T${m[4]!.padStart(2,'0')}:${m[5]}:${m[6]||'00'}+08:00`;const date=new Date(iso);if(!Number.isFinite(date.getTime())||new Date(date.getTime()+8*3600000).toISOString().slice(0,19)!==iso.slice(0,19))throw new BadRequestError('下次跟进时间不是有效日期。');return date.toISOString();}
 throw new BadRequestError('下次跟进时间请按北京时间 YYYY-MM-DD HH:MM 填写。');
}
export function importRows(matrix:string[][]){if(matrix.length<2)throw new BadRequestError('表格至少需要标题行和一条数据。');if(matrix.slice(1).filter(row=>!isSpreadsheetExampleRow(row)&&row.some(v=>String(v||'').trim())).length>5000)throw new BadRequestError('每次最多导入5000行，请拆分文件。');const headers=matrix[0]!.map(cleanSpreadsheetHeader);const mapping:Record<string,number>=Object.fromEntries(Object.entries(columns).map(([key,names])=>[key,headers.findIndex(h=>names.includes(h))]));const nameColumn=mapping.name??-1;if(nameColumn<0)throw new BadRequestError('缺少“公司名称”或“企业名称”列。');return matrix.slice(1).map((cells,index)=>({cells,index})).filter(({cells})=>cells.some(v=>Boolean(String(v||'').trim()))).filter(({cells})=>!isSpreadsheetExampleRow(cells)&&!/^【示例】/.test(String(cells[nameColumn]||'').trim())).map(({cells,index})=>{const input:Row={};for(const [key,pos] of Object.entries(mapping)){const column=pos??-1;input[key]=column<0?'':String(cells[column]||'').trim();}return validateImportRow(input,index+2);});}
export function validateImportRow(input:Row,line:number){try{
 const company=companyInput.parse({name:input.name,industry:input.industry||'',region:input.region||'',address:input.address||'',business:input.business||'',website:input.website||'',creditCode:input.creditCode||'',source:input.source||'',status:parseStatus(input.status),tags:String(input.tags||'').split(/[,，;；、]/).map(x=>x.trim()).filter(Boolean)});
 const region=company.region+' '+company.address;
 const mobile=normalizePhone(input.mobile||'','',region);
 if(input.mobile&&!mobile.mobile)throw new BadRequestError('手机号码列只能填写国内手机号。');
 const landline=normalizePhone(input.landline||'',input.areaCode||'',region);
 if(input.landline&&landline.mobile)throw new BadRequestError('座机号码列请填写座机，手机号码放入手机列。');
 const primary=normalizePhone(input.mobile||input.landline||input.phone||'',input.areaCode||'',region);
 if(!primary.phoneKey)throw new BadRequestError('缺少有效联系电话。');
 company.phone=normalizePhone(input.phone||primary.phoneKey,input.areaCode||'',region).phoneKey;
 const contactStatus=parseStatus(input.contactStatus);
 const doNotCall=parseBoolean(input.doNotCall)||company.status==='OPT_OUT'||contactStatus==='OPT_OUT';
 const c=contactInput.omit({companyId:true}).parse({name:input.contactName||'',position:input.position||'',mobile:mobile.mobile||primary.mobile,landline:landline.landline||primary.landline,areaCode:landline.areaCode||primary.areaCode,extension:input.extension||landline.extension||primary.extension,email:input.email||'',wechatNote:input.wechatNote||'',status:doNotCall?'OPT_OUT':contactStatus,doNotCall});
 const lead=leadInput.omit({companyId:true,contactId:true}).parse({status:doNotCall?'OPT_OUT':company.status,notes:input.notes||'',nextFollowUp:importDate(input.nextFollowUp||'')});
 return {line,company,ownerName:input.ownerName||'',contact:c,lead,error:''};
 }catch(e){return {line,company:null,ownerName:'',contact:null,lead:null,error:e instanceof Error?e.message:'数据格式错误'};}}
