/*
 * 中文导读：工作区与权限：workspace.profile.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import prisma from '../../config/prisma.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { NotFoundError } from '../../common/errors/notFound.js';
const text=(max:number)=>z.string().trim().max(max).default('');
const dashboardAnnouncementSchema=z.object({
 text:z.string().trim().max(240).default(''),
 color:z.string().regex(/^#[0-9a-fA-F]{6}$/,'公告颜色格式无效。').default('#b83240'),
 enabled:z.boolean().default(true),
 speed:z.enum(['slow','normal','fast']).default('normal'),
}).default({text:'',color:'#b83240',enabled:true,speed:'normal'});
export const workspaceProfileSchema=z.object({
 workspaceName:z.string().trim().min(1).max(80),
 companyName:z.string().trim().min(1).max(120),
 brandName:text(80),address:text(200),businessDescription:text(4000),phone:text(40),
 email:z.union([z.email(),z.literal('')]).default(''),
 website:z.union([z.url().max(2000).refine(s=>/^https?:\/\//i.test(s),'请输入公开 HTTP 或 HTTPS 官网网址'),z.literal('')]).default(''),
 logo:z.string().max(500000).nullable(),
 dashboardAnnouncement:dashboardAnnouncementSchema,
}).strict();
export type WorkspaceProfileInput=z.infer<typeof workspaceProfileSchema>;
export function validateWorkspaceLogo(logo:string|null|undefined){
 if(!logo)return null;
 if(['/brand/taigua-logo.png','/brand/taigua-icon.png'].includes(logo))return logo;
 const prefix='data:image/png;base64,';
 if(!logo.startsWith(prefix))throw new BadRequestError('Logo 请使用上传的 PNG 图片。');
 const encoded=logo.slice(prefix.length);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new BadRequestError('Logo 图片格式无效。');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length>350000||bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString('ascii')!=='IHDR')throw new BadRequestError('Logo 图片无效或超过大小限制。');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>2048||height>2048||width*height>4194304)throw new BadRequestError('Logo 图片尺寸过大。');
 return logo;
}
function metadata(raw:string|null):Record<string,unknown>{
 try{const data=JSON.parse(raw||'{}');if(data&&typeof data==='object'&&!Array.isArray(data))return data;}catch{}
 return raw?{legacyMetadata:raw}:{};
}
function fields(raw:unknown){const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};const get=(key:string,max:number)=>typeof value[key]==='string'?(value[key] as string).trim().slice(0,max):'';return {companyName:get('companyName',120),brandName:get('brandName',80),address:get('address',200),businessDescription:get('businessDescription',4000),phone:get('phone',40),email:get('email',254),website:get('website',2000)};}
function announcement(raw:unknown){
 const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const textValue=typeof value.text==='string'?value.text.trim().slice(0,240):'';
 const colorValue=typeof value.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(value.color)?value.color:'#b83240';
 const speedValue=value.speed==='slow'||value.speed==='fast'||value.speed==='normal'?value.speed:'normal';
 return {text:textValue,color:colorValue,enabled:value.enabled!==false,speed:speedValue as 'slow'|'normal'|'fast'};
}
const present=(org:{id:string;name:string;logo:string|null;metadata:string|null})=>{
 const allMetadata=metadata(org.metadata);
 const profile=fields(allMetadata.companyProfile);
 let logo:null|string=null;try{logo=validateWorkspaceLogo(org.logo);}catch{}
 // Older account creation inserted the same default Taigua icon for every company.
 if(logo?.startsWith('/brand/taigua-')&&!org.name.includes('泰卦'))logo=null;
 if(logo==='/brand/taigua-icon.png')logo='/brand/taigua-logo.png';
 return {organizationId:org.id,workspaceName:org.name,...profile,dashboardAnnouncement:announcement(allMetadata.dashboardAnnouncement),companyName:profile.companyName||org.name,brandName:profile.brandName||profile.companyName||org.name,logo};
};
export async function getWorkspaceProfile(organizationId:string){const org=await prisma.organization.findUnique({where:{id:organizationId},select:{id:true,name:true,logo:true,metadata:true}});if(!org)throw new NotFoundError('工作区不存在。');return present(org);}
export async function saveWorkspaceProfile(organizationId:string,input:WorkspaceProfileInput){
 const logo=validateWorkspaceLogo(input.logo);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`;
  const org=await tx.organization.findUnique({where:{id:organizationId},select:{metadata:true}});if(!org)throw new NotFoundError('工作区不存在。');
  const {workspaceName,logo:_logo,dashboardAnnouncement,...profile}=input;
  const result=await tx.organization.update({where:{id:organizationId},data:{name:workspaceName,logo,metadata:JSON.stringify({...metadata(org.metadata),companyProfile:profile,dashboardAnnouncement})},select:{id:true,name:true,logo:true,metadata:true}});
  return present(result);
 });
}
