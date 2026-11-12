/*
 * 中文导读：数字员工与话术：voice-delivery.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Tone and timing belong to delivery, independent of the words or voice identity.
export const telephoneVoiceDelivery = [
 '保持所选音色本人的声线、口音和自然发音，延续本人开场的聊天状态。把一句话说给电话对面这个人听，像熟悉业务的人在随口解释，不是在向听众朗读介绍。起音放松，意群内轻重有别，句末自然收住；避免客服播报腔、字字咬重、统一上扬和逐字等速。',
 '按完整意群连贯表达，逗号轻停，句末稍停；称呼后略停，介绍业务时流畅，关键时间、数量和操作说明略放慢。在转折和问句前后自然换气，重音只落在关键信息上，不每个词都停顿，不拖长尾音，也不每句都机械上扬。',
 '疑问句有温和的探询感，解释时耐心清楚，客户表达兴趣时语气轻快并主动承接，客户犹豫时先体谅再放缓，客户拒绝时尊重地收束。语气在整句中随语义变化，不能只在最后一个字上扬，也不能一律用低平慢速表示耐心。',
 '情绪通过声音自然体现，不持续亢奋或夸张表演，不念出情绪和停顿指令，不添加括号旁白、假笑、叹气或刻意口头禅。固定话术和试听保留原文字词，语气自然与内容准确同时满足。',
 '即兴回答使用短的日常说法：先接住对方当前那句话，再说一个有用的信息点。客户没有要求详细介绍时，不完整背公司简介，不连续列服务项目，不用“赋能、矩阵、落地方案”等宣传词解释简单问题。不强行在每句前加“嗯、好的”，也不以“您想了解哪方面”替代已有信息能回答的问题。',
].join('\n');

export const englishTelephoneVoiceDelivery = [
 'Keep the selected speaker\'s voice, accent and natural pronunciation throughout the call, including after interruptions. Use relaxed conversational English, connected short phrases and brief meaningful pauses rather than an announcement or a scripted customer-service voice.',
 'Let emphasis and intonation follow the meaning. Do not stretch endings, pause between every word, overact or add repeated fillers. First respond to the caller\'s latest meaning; usually use one or two short sentences and ask at most one necessary question, then listen.',
 'Reference questions are examples of meaning, not exact triggers. Understand paraphrases and follow-ups in context, and answer concisely using the approved facts. You may rephrase or shorten answers; do not invent business facts or claim external actions. All clarifications and goodbyes must be in English.',
].join('\n');

// A fixed line has no preceding customer audio. Give delivery context without
// inserting spoken stage directions or changing its literal words.
export function telephoneLineDelivery(text:string){
 if(/理解|不打扰|先忙|没关系|不方便|抱歉/u.test(text))return '本句是在体谅对方：起音温暖柔和，前半先接纳，后半像商量一样留余地。保持连贯和有温度的声音，不能只靠压低音高和拖慢来表示耐心。';
 if(/可以呀|好呀|好的|太好|没问题|整理|接下来/u.test(text))return '本句是在爽快回应：开头轻快肯定，主体保持积极、愿意帮忙的语气，关键动作有清楚重音，结尾落稳。让积极贯穿全句，不要只在第一个语气词上扬后转回平读。';
 if(/[？?]/u.test(text))return '本句是交流式询问：有真实的关心与探询感，问题重点轻轻提起，选项有自然对比，结尾柔和上扬并干净收住。语调变化贯穿问句，不只抬高最后一个字。';
 return '本句是在自然说明：信息连贯，重点清楚，语气温和有回应感，句尾自然落稳。';
}
