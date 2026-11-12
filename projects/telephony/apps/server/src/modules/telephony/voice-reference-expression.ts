/*
 * 中文导读：从参考录音信息提取表达提示，供后续语音生成使用。
 */
// Acoustic values describe the selected recording. They guide the model's
// delivery in ordinary language; they are not a speaker-verification score or
// exposed pitch / similarity controls in the provider API.
export function voiceReferenceExpression(opening:{text:string;durationSeconds:number;analysis?:Record<string,unknown>}){
 const seconds=opening.durationSeconds;
 const reference=typeof opening.analysis?.referenceText==='string'?opening.analysis.referenceText:opening.text;
 const characters=(reference.match(/\p{Script=Han}/gu)||[]).length;
 const pace=seconds>0?characters/seconds:0;
 const pause=Number(opening.analysis?.medianPauseMs)||0;
 const rhythm=pace>4.8?'轻快利落，连贯说完意群':pace>0&&pace<3.2?'舒缓从容，但不要逐字拖长':'自然适中，短句连贯';
 return '\n【本人开场参考】使用这条原开场训练得到的本人声线和口音，延续本人放松的交流状态。'
  +(pace>=2&&pace<=8?'录音按汉字与总时长估算约'+pace.toFixed(1)+'字/秒，后续短句以相近的整体速度表达，'+rhythm+'。礼貌确认、拒绝收尾也保持这个节奏，不突然切换成慢速客服腔；数字和复杂信息才适当放慢。':'')
  +(pause>=160&&pause<=1500?'在完整意群之间保留类似开场的短停顿，不把每个词拆开。':'')
  +'意群内连读，逗号只轻停；一句只突出一个信息点。不要连说“好的、明白了、那”，也不要用拉长语气词表示温和。不模仿背景声，不把测量值念出来。语气随当前客户的意思变化，不能把同一套朗读腔套到每个回答。';
}
