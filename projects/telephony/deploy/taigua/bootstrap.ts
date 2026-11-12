/*
 * 中文导读：维护与构建工具：bootstrap.ts。按文件内参数执行对应操作，运行前先核对目标环境。
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import prisma from '../../apps/server/src/config/prisma.js';
import { agentConfigCreateDefaults } from '../../apps/server/src/modules/agent/agent.repository.js';

async function main() {
const admin = JSON.parse(await readFile('/opt/taigua-sales/admin-hash.json','utf8'));
const imported = JSON.parse(await readFile('/opt/taigua-sales/agent.json','utf8'));
await prisma.$transaction(async tx => {
  let user = await tx.user.findUnique({where:{email:admin.email}});
  if (!user) {
    user = await tx.user.create({data:{id:randomUUID(),email:admin.email,name:'泰卦管理员',emailVerified:true,role:'admin'}});
    await tx.account.create({data:{id:randomUUID(),accountId:user.id,providerId:'credential',userId:user.id,password:admin.hash}});
  } else {
    await tx.user.update({where:{id:user.id},data:{role:'admin',emailVerified:true,banned:false}});
    await tx.account.upsert({where:{providerId_accountId:{providerId:'credential',accountId:user.id}},update:{},create:{id:randomUUID(),accountId:user.id,providerId:'credential',userId:user.id,password:admin.hash}});
  }
  if (admin.email !== 'admin@dx.zezejun.cn') await tx.user.updateMany({where:{email:'admin@dx.zezejun.cn'},data:{banned:true,banReason:'已替换为指定管理员账号'}});
  const org = await tx.organization.upsert({where:{slug:'taigua-sales'},update:{logo:'/brand/taigua-icon.png'},create:{id:randomUUID(),slug:'taigua-sales',name:'泰卦外贸',logo:'/brand/taigua-icon.png',createdAt:new Date()}});
  await tx.member.upsert({where:{organizationId_userId:{organizationId:org.id,userId:user.id}},update:{},create:{id:randomUUID(),organizationId:org.id,userId:user.id,role:'owner',createdAt:new Date()}});
  await tx.billingAccount.upsert({where:{organizationId:org.id},update:{},create:{organizationId:org.id}});
  if (imported && !await tx.agent.findUnique({where:{agentId:imported.agentId}})) {
    await tx.agent.create({data:{agentId:imported.agentId,name:imported.name,agentSlug:'taigua-business',organizationId:org.id,userId:user.id,isActive:imported.isActive,isConfigured:true,templateId:imported.templateId}});
    await tx.agentConfiguration.create({data:{agentId:imported.agentId,...agentConfigCreateDefaults,...imported.configuration,data_needed:imported.configuration.data_needed ?? [],data_evaluation:imported.configuration.data_evaluation ?? [],variables:imported.configuration.variables ?? {}}});
  }
});
console.log('Administrator, Taigua workspace and saved agent initialized.');
await prisma.$disconnect();

}
main().catch(async error => { console.error('Initialization failed:', error.message); await prisma.$disconnect(); process.exitCode = 1; });
