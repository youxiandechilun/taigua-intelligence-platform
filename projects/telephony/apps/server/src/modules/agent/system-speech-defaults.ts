/*
 * 中文导读：数字员工与话术：system-speech-defaults.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';

// Keep these defaults aligned with the values displayed in SystemSpeechEditor.
// They are copied into newly created task snapshots; existing tasks are untouched.
const aliyunDefaults={aliyunDefaultEnd:'好的，先不打扰您了，再见。',aliyunOptOut:'好的，已记录不再联系，先不打扰您了，再见。',aliyunDurationEnd:'今天先沟通到这里，感谢您的时间，再见。',aliyunSilencePrompt:'请问您还在听吗？',aliyunSilenceEnd:'可能现在不方便，先不打扰您了，再见。',aliyunContinue:'我在听，您可以接着说。',aliyunFlowLimit:'今天先沟通到这里，后续请同事跟进，感谢您的时间，再见。',aliyunFlowError:'这个问题需要同事确认，今天先不打扰您了，再见。',aliyunNoReply:'嗯，您接着说。',aliyunUnclear:'刚才的信息我还没有听清，您可以接着说。',aliyunHandoff:'已记录您的人工跟进需求，会请同事联系您。感谢您的时间，再见。'};
export const systemSpeechDefaults={
  zh:{noResponseFirst:'您还有什么想了解的吗？',noResponseSecond:'请问您还在听吗？',noResponseEnd:'暂时没听到您的回复，先不打扰您了，再见。',unclear:'刚才没听清，麻烦您再说一下。',declined:'好，不打扰您了，再见。',followUp:'好的，我这边挂断后加您微信，谢谢，再见。',goodbye:'再见。',handoffStart:'请稍等，我联系一下在岗同事。',handoffUnavailable:'现在同事暂时没接通，我会安排同事跟进。先不打扰您了，再见。',audioCheck:'我在，您现在能听到我说话吗？',...aliyunDefaults},
  en:{noResponseFirst:"Is there anything else you'd like to know?",noResponseSecond:'Are you still there?',noResponseEnd:"I haven't heard a reply, so I'll let you go for now. Goodbye.",unclear:"Sorry, I didn't catch that. Could you repeat it?",declined:"Of course. I'll let you go. Goodbye.",followUp:"Okay, I'll follow up with you on WeChat after the call. Goodbye.",goodbye:'Goodbye.',handoffStart:'Please hold while I contact an available colleague.',handoffUnavailable:"My colleague isn't available right now. I'll arrange a follow-up. Thank you, and goodbye.",audioCheck:"I'm here. Can you hear me now?",...aliyunDefaults},
};

export function completeSystemSpeech(input: unknown) {
  if(input != null && (typeof input !== 'object' || Array.isArray(input)))
    throw new BadRequestError('场景话术格式有误，请联系管理员重新保存并发布。');
  const raw=(input || {}) as Record<string,unknown>;
  const complete=(language:'zh'|'en')=>{
    const original=raw[language];
    if(original != null && (typeof original !== 'object' || Array.isArray(original)))
      throw new BadRequestError('场景话术格式有误，请联系管理员重新保存并发布。');
    const configured=(original || {}) as Record<string,unknown>;
    return Object.fromEntries(Object.entries(systemSpeechDefaults[language]).map(([key,fallback])=>{
      const value=configured[key] === undefined ? fallback : configured[key];
      if(typeof value !== 'string' || !value.replace(/<[^>]*>/g,'').replace(/[<>]/g,'').trim())
        throw new BadRequestError('场景话术不能为空，请联系管理员补充后保存并发布。');
      return [key,value];
    }));
  };
  return {zh:complete('zh'),en:complete('en')};
}
