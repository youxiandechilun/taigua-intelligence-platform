/*
 * 中文导读：客户管理：crm.phone.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';
const cityCodes: Record<string,string> = {北京:'010',上海:'021',天津:'022',重庆:'023',广州:'020',深圳:'0755',杭州:'0571',宁波:'0574',温州:'0577',苏州:'0512',南京:'025',台州:'0576',南通:'0513',常州:'0519',无锡:'0510',东莞:'0769',佛山:'0757',中山:'0760',珠海:'0756',惠州:'0752',成都:'028',武汉:'027',西安:'029',长沙:'0731',郑州:'0371',济南:'0531',青岛:'0532',厦门:'0592',福州:'0591',泉州:'0595',合肥:'0551',南昌:'0791',南宁:'0771',昆明:'0871',贵阳:'0851',沈阳:'024',大连:'0411',长春:'0431',哈尔滨:'0451',石家庄:'0311',太原:'0351',海口:'0898',兰州:'0931',乌鲁木齐:'0991',呼和浩特:'0471',银川:'0951',西宁:'0971',拉萨:'0891'};
export function normalizePhone(raw:string,area='',region='') {
 if(/^\s*\+(?!86(?:\D|$))/.test(raw))throw new BadRequestError('仅支持国内企业联系电话。');
 let text=raw.trim().replace(/[（）]/g,c=>c==='（'?'(':')');
 const ext=text.match(/(?:转|分机|ext\.?|#)\s*(\d{1,6})$/i)?.[1]||'';
 if(ext)text=text.replace(/(?:转|分机|ext\.?|#)\s*\d{1,6}$/i,'');
 if(/[^\d\s+()\-]/.test(text))throw new BadRequestError('电话只能包含号码、区号和分机。');
 let n=text.replace(/\D/g,''); if(n.startsWith('0086'))n=n.slice(4);else if(n.startsWith('86')&&n.length>=12)n=n.slice(2);
 if(!n)return {mobile:'',landline:'',areaCode:'',extension:ext,phoneKey:''};
 if(/^1[3-9]\d{9}$/.test(n))return {mobile:n,landline:'',areaCode:'',extension:ext,phoneKey:n};
 if(/^(400|800)\d{7}$/.test(n))return {mobile:'',landline:n,areaCode:'',extension:ext,phoneKey:n};
 let code=area.replace(/\D/g,'');if(code&&!code.startsWith('0'))code='0'+code;
 if(/^[2-9]\d{6,7}$/.test(n)){
  if(!code){const candidates=Object.entries(cityCodes).filter(([city])=>region.includes(city));if(candidates.length===1)code=candidates[0]![1];}
  if(!/^0(?:10|2[0-9]|[3-9]\d{2})$/.test(code))throw new BadRequestError('座机缺少明确区号，请填写区号或城市。');n=code+n;
 }else if(!n.startsWith('0'))n='0'+n;
 const match=n.match(/^(0(?:10|2[0-9]|[3-9]\d{2}))([2-9]\d{6,7})$/);
 if(!match)throw new BadRequestError('请输入有效国内手机号或带区号的座机。');
 if(code&&code!==match[1])throw new BadRequestError('填写的区号与座机号码不一致。');
 return {mobile:'',landline:match[2]!,areaCode:match[1]!,extension:ext,phoneKey:n};
}
export const companyKey=(name:string)=>name.normalize('NFKC').replace(/[\s·]/g,'').toLowerCase();

export function regionFromAddress(address:string){const cities=Object.keys(cityCodes).filter(city=>address.includes(city));return cities.length===1?cities[0]!:'';}
