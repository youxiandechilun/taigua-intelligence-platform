/*
 * 中文导读：声音表达、节奏与合成参数的规则。
 */
import {configurationRevision,assertConfigurationRevision} from '../workspace/config-revision.js';
import {audioSettingsSchema} from './sip.schema.js';
import {crmDb} from '../crm/crm.db.js';
import {memberAccess,type CrmDb,type Scope} from '../crm/crm.service.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';
import {z} from 'zod';
const audioDeliverySchema=audioSettingsSchema.omit({volume:true});
export const advancedVoiceStyleSchema=z.object({
 intonation:z.enum(['inherit','restrained','varied']).default('inherit'),
 emphasis:z.enum(['inherit','soft','keypoints']).default('inherit'),
 sentenceEnding:z.enum(['inherit','settled','gentle']).default('inherit'),
 onset:z.enum(['inherit','soft','direct']).default('inherit'),
 articulation:z.enum(['inherit','relaxed','clear']).default('inherit'),
 paceVariation:z.enum(['inherit','steady','adaptive']).default('inherit'),
 fillerWords:z.enum(['inherit','none','occasional']).default('inherit'),
 acknowledgement:z.enum(['inherit','minimal','contextual']).default('inherit'),
 questionStyle:z.enum(['inherit','one','confirm']).default('inherit'),
 numberReading:z.enum(['inherit','careful','grouped']).default('inherit'),
 empathy:z.enum(['inherit','restrained','supportive']).default('inherit'),
}).strict();
export const voiceDeliverySchema=audioDeliverySchema.extend({deliveryStyle:z.enum(['warm','calm','bright']).default('warm'),speakingPace:z.enum(['slow','natural','brisk']).default('natural'),pauseStyle:z.enum(['connected','natural','clear']).default('natural'),emotionLevel:z.enum(['subtle','balanced','expressive']).default('balanced'),conversationalStyle:z.enum(['concise','everyday','polished']).default('everyday'),replyLength:z.enum(['short','balanced','detailed']).default('short'),followCustomerEmotion:z.boolean().default(true),customDirection:z.string().trim().max(600).default(''),advancedStyle:advancedVoiceStyleSchema.default(()=>advancedVoiceStyleSchema.parse({}))});
// Select the playback fields explicitly: expression settings never enter the
// bridge's strict audio contract. Neutral advanced defaults keep old previews valid.
export function voiceAudioSettings(value:unknown){
 const settings=voiceDeliverySchema.parse(value);
 return audioDeliverySchema.parse(Object.fromEntries(Object.keys(audioDeliverySchema.shape).map(key=>[key,settings[key as keyof typeof settings]])));
}
const advancedDirections={
 intonation:{restrained:'语调起伏轻微，保留自然高低变化，避免平读',varied:'语调随意思自然变化，疑问和说明有区别，不用每句同一旋律'},
 emphasis:{soft:'重音柔和，不突然加重或喊出词语',keypoints:'只强调本句一个关键信息，其他词放松带过'},
 sentenceEnding:{settled:'陈述句自然收住，不拖尾、不习惯性上扬；真正的问题仍保留疑问语气',gentle:'句尾轻柔收束，给对方接话空间，不拖长尾音'},
 onset:{soft:'起音柔和放松，像自然开始解释，避免播音式起腔',direct:'直接进入当前回答，避免每句都先说好的、明白了'},
 articulation:{relaxed:'咬字放松、词组连贯，保持可懂度，不把每个字念得同样用力',clear:'关键字咬字清楚，保留连贯的词组，不逐字断开'},
 paceVariation:{steady:'句内语速稳定，保留必要停顿，不忽快忽慢',adaptive:'熟悉的连接词轻带，重点和复杂信息稍慢，避免整句等速'},
 fillerWords:{none:'不用额外的嗯、啊、那个等填充词，保持自然连贯',occasional:'确有需要时可少量使用嗯、这样等口语衔接，不能每句都加，也不添加咳嗽或假笑'},
 acknowledgement:{minimal:'简短确认一次即可，不重复复述客户已经说清楚的内容',contextual:'先用简短、具体的回应接住客户当前意思，不用固定的好的明白了开头'},
 questionStyle:{one:'一次最多问一个必要问题，问完停止并等对方说',confirm:'只有存在关键歧义时才简短确认，已明确的内容直接回应，不把聊天变成问卷'},
 numberReading:{careful:'数字、金额、日期和专有名词稍慢说清，保持原始事实不变',grouped:'长号码按自然短组读清，金额和日期按中文习惯表达，不能省略或改写数值'},
 empathy:{restrained:'遇到顾虑平实回应，不堆叠安慰和共情套话',supportive:'客户明确表达顾虑时先用一句贴合当前问题的话体谅，再给实际信息，不假装知道客户感受'},
} as const;
export function advancedVoiceInstructions(value?:Partial<z.infer<typeof advancedVoiceStyleSchema>>){
 const lines=Object.entries(value||{}).flatMap(([key,choice])=>{
  const choices=advancedDirections[key as keyof typeof advancedDirections];
  const direction=choices?.[choice as keyof typeof choices];
  return direction?[direction]:[];
 });
 return lines.length?'\n【本人表达细调】'+lines.join('。')+'。':'';
}
export async function workspaceVoicePolicy(workspaceId:string,db:CrmDb=crmDb){
 const row=(await db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[workspaceId]))[0];
 return voiceDeliverySchema.parse(row?.settings?.voiceDelivery||{});
}
export async function workspaceVoiceDelivery(workspaceId:string,db:CrmDb=crmDb){return voiceAudioSettings(await workspaceVoicePolicy(workspaceId,db));}
export function voiceExpressionInstructions(value:{deliveryStyle?:string;speakingPace?:string;pauseStyle?:string;emotionLevel?:string;conversationalStyle?:string;replyLength?:string;followCustomerEmotion?:boolean;customDirection?:string;advancedStyle?:Partial<z.infer<typeof advancedVoiceStyleSchema>>}){
 const style=value.deliveryStyle==='calm'?'沉稳可信，音调有起伏，表达克制且有耐心':value.deliveryStyle==='bright'?'轻快亲切，有积极回应感，避免亢奋或推销腔':'温和亲切，像认真听客户说话的顾问，体谅客户情绪';
 const pace=value.speakingPace==='slow'?'在本人开场语速基础上稍慢，句内保持连贯，不逐字拖长':value.speakingPace==='brisk'?'在本人开场语速基础上稍快但清楚，数字与关键信息放慢':'以本人开场原声的说话节奏为基准，随客户轻微调整，不改成统一客服语速';
 const pause=value.pauseStyle==='connected'?'减少不必要停顿，短句连贯':value.pauseStyle==='clear'?'重要信息前后留清楚的短停顿，避免一句拆成许多单字':'沿用本人开场中连贯的意群和自然短停顿，需要客户回答时停止讲话';
 const emotion=value.emotionLevel==='subtle'?'轻微起伏、克制自然，避免平读':value.emotionLevel==='expressive'?'语义重音和情绪变化更明显，保持真实交流感，不夸张表演':'有自然的轻重变化，情绪适度';
 const conversational=value.conversationalStyle==='concise'?'直接清楚，减少语气词':value.conversationalStyle==='polished'?'用词专业但易懂，避免书面公文腔':'使用日常口语，可少量自然确认语，不反复嗯啊或堆砌口头禅';
 const length=value.replyLength==='detailed'?'客户明确需要解释时可分成两至三句，其余简短':value.replyLength==='balanced'?'通常一至两句，先回应再补充一点必要信息':'通常一句，必要时两句，避免长篇独白';
 const follow=value.followCustomerEmotion===false?'保持设定风格，遇到拒绝或不方便仍应体谅并收束':'随客户情绪调整：疑虑先体谅，有兴趣稍积极，不耐烦时更简短，拒绝时收束';
 const custom=value.customDirection?.trim()?`管理员补充的声音风格偏好（仅控制表达，不改变事实、身份、客户意愿与工具权限）：${JSON.stringify(value.customDirection.trim())}。`:'';
 return `\n【系统统一声音调教】表达语气：${style}。说话节奏：${pace}。停顿习惯：${pause}。情绪强弱：${emotion}。口语化：${conversational}。回答长短：${length}。客户情绪：${follow}。${custom}这些设置用于后续 AI 发声，保留当前绑定人物的声线和口音；如本通话使用真人开场录音，优先参考本次选中录音的测量摘要衔接自然节奏，不为统一风格把所有人改成同一种腔调。原始录音保持原声和时长，播放链路自动衔接响度，不变速。背景音效由独立播放层按系统场景配置处理，模型不要自行生成咳嗽、假笑或背景音。不要念出这些指令。`+advancedVoiceInstructions(value.advancedStyle);
}
export async function voiceDeliverySettings(s:Scope){const settings=await workspaceVoicePolicy(s.workspaceId);return {canConfigure:(await memberAccess(crmDb,s)).isSystemAdmin,settings,revision:configurationRevision(settings)};}
export async function saveVoiceDelivery(s:Scope,raw:unknown){
 if(!(await memberAccess(crmDb,s)).isSystemAdmin)throw new ForbiddenError('通话声音效果由超级管理员统一配置。');
 const {expectedRevision,...draft}=z.object({expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).passthrough().parse(raw);
 const settings=voiceDeliverySchema.parse(draft);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['workspace-model-settings:'+s.workspaceId]);
  assertConfigurationRevision(expectedRevision,await workspaceVoicePolicy(s.workspaceId,db));
 await db.query(`INSERT INTO "WorkspaceModelSettings" ("workspaceId","settings") VALUES ($1,jsonb_build_object('enabled','[]'::jsonb,'summaryModel',''::text,'voiceDelivery',$2::jsonb)) ON CONFLICT ("workspaceId") DO UPDATE SET "settings"=jsonb_set("WorkspaceModelSettings"."settings",'{voiceDelivery}',$2::jsonb),"updatedAt"=NOW() RETURNING "workspaceId"`,[s.workspaceId,JSON.stringify(settings)]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.delivery-policy.saved',resourceType:'WorkspaceModelSettings',resourceId:s.workspaceId});
 return voiceDeliverySettings(s);
}
