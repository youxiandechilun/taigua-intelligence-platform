/*
 * 中文导读：合成与播放配置的版本和交付参数。
 */
import type {z} from 'zod';
import type {voiceDeliverySchema} from './voice-delivery-policy.js';

export type SynthesisDelivery = z.infer<typeof voiceDeliverySchema>;
export const synthesisDeliveryVersion='voice-library-delivery-v1';

// Only acoustic delivery enters TTS. Business identity, reply length, tools and
// dialogue policies belong to the conversation model, never the synthesizer.
export function synthesisDelivery(settings:SynthesisDelivery){
 const style={warm:'温和亲切，放松交流',calm:'沉稳可信，克制有耐心',bright:'轻快积极，不亢奋、不用推销腔'}[settings.deliveryStyle];
 const pause={connected:'短句连贯，减少不必要停顿',natural:'意群内连贯，意群间自然短停顿',clear:'关键信息前后短停顿，不逐字停顿'}[settings.pauseStyle];
 const emotion={subtle:'情绪轻微克制，保留自然起伏',balanced:'语气轻重自然，避免等速平读',expressive:'随语义增加轻重变化，不夸张表演'}[settings.emotionLevel];
 const advanced=settings.advancedStyle;
 const details=[
  advanced.intonation==='restrained'?'语调起伏轻微':advanced.intonation==='varied'?'语调随语义变化':'',
  advanced.emphasis==='soft'?'重音柔和':advanced.emphasis==='keypoints'?'每句只强调一个关键信息':'',
  advanced.sentenceEnding==='settled'?'陈述句自然收住，不习惯性上扬':advanced.sentenceEnding==='gentle'?'句尾轻柔收束，不拖尾':'',
  advanced.onset==='soft'?'起音柔和':advanced.onset==='direct'?'起音直接自然':'',
  advanced.articulation==='relaxed'?'咬字放松连贯':advanced.articulation==='clear'?'关键字清楚，不逐字断开':'',
  advanced.paceVariation==='steady'?'句内速度平稳':advanced.paceVariation==='adaptive'?'连接词轻带，复杂信息稍慢':'',
  advanced.numberReading==='careful'?'数字、金额和日期稍慢读清':advanced.numberReading==='grouped'?'长号码自然分组，数字内容保持不变':'',
 ].filter(Boolean);
 const custom=settings.customDirection.trim().replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,' ');
 const instruction=['保留所选本人音色和口音，只朗读输入原文，不增删内容。',style,pause,emotion,...details,custom?'仅作为发声风格参考：'+JSON.stringify(custom):'','不生成背景声、咳嗽、假笑或额外语气词。'].filter(Boolean).join('。');
 return {rateFactor:{slow:.93,natural:1,brisk:1.07}[settings.speakingPace],instruction};
}
