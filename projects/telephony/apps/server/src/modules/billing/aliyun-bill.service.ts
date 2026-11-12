/*
 * 中文导读：阿里云账单同步、查询与对账业务。
 */
import OpenApi, { $OpenApiUtil } from '@alicloud/openapi-core';
import { rpcRuntime } from '../aliyun/aliyun.client.js';
import { connection } from '../aliyun/aliyun.service.js';

type BillItem={ProductName?:string;ProductCode?:string;Currency?:string;PretaxAmount?:number;PaymentAmount?:number;OutstandingAmount?:number};
type BillBody={Success?:boolean;Code?:string;RequestId?:string;Data?:{TotalCount?:number;Items?:{Item?:BillItem[]}}};
// Account totals are exclusively exposed to the platform administrator, never
// presented as one company's allocated bill.
export async function aliyunAccountBill(organizationId:string,month:string){
 const {credentials}=await connection(organizationId);
 if(!credentials.accessKeyId||!credentials.accessKeySecret)return {connected:false,reason:'未保存阿里云 AccessKey，请在阿里云配置中保存费用只读凭据。',items:[],month};
 const client=new OpenApi.default(new $OpenApiUtil.Config({endpoint:'business.aliyuncs.com',regionId:'cn-hangzhou',protocol:'https',accessKeyId:credentials.accessKeyId,accessKeySecret:credentials.accessKeySecret,securityToken:credentials.securityToken}));
 try{
  const items:BillItem[]=[];let requestId:string|undefined;
  for(let page=1;page<=20;page++){
   const result=await client.callApi(new $OpenApiUtil.Params({action:'QueryAccountBill',version:'2017-12-14',protocol:'HTTPS',pathname:'/',method:'POST',authType:'AK',style:'RPC',reqBodyType:'formData',bodyType:'json'}),new $OpenApiUtil.OpenApiRequest({query:{BillingCycle:month,Granularity:'MONTHLY',IsGroupByProduct:'true',PageNum:String(page),PageSize:'100'}}),rpcRuntime()) as {body?:BillBody};
   const body=result.body;
   if(body?.Success!==true)return {connected:false,reason:'阿里云未确认账单查询成功。请检查费用查询权限和账期。',code:body?.Code,month,items:[]};
   requestId=body.RequestId;const batch=body.Data?.Items?.Item??[];items.push(...batch);
   if(items.length>=(body.Data?.TotalCount??items.length)||!batch.length)break;
   if(page===20)return {connected:false,reason:'账单条目过多，请在阿里云费用中心查看完整账单。',month,items:[]};
  }
  return {connected:true,reason:'已从阿里云费用中心获取账户产品账单，当前账期可能存在结算延迟。',month,requestId,syncedAt:new Date().toISOString(),items:items.map(item=>({product:item.ProductName??item.ProductCode??'其他产品',productCode:item.ProductCode??'',currency:item.Currency??'CNY',pretaxAmount:item.PretaxAmount??null,paidAmount:item.PaymentAmount??null,outstandingAmount:item.OutstandingAmount??null}))};
 }catch(e){
  const code=(e as {code?:string}).code??'ALIYUN_BILL_UNAVAILABLE';
  return {connected:false,code,reason:/forbidden|denied|permission|unauthorized/i.test(code)?'阿里云拒绝了费用查询。请给此 RAM 凭据授予 bss:QueryAccountBill 只读权限。':/invalidaccess|signature|token|accesskey/i.test(code)?'阿里云访问凭据无效或已过期，请更新 AccessKey。':'阿里云费用中心暂时无法连接，请稍后刷新。',month,items:[]};
 }
}
