/*
 * 中文导读：系统固定话术的配置界面。
 */
"use client";

import {useState} from 'react';
import type {SystemSpeech,SystemSpeechLanguage} from '@/src/lib/api/resources/playbook';
import {Button} from '@/src/components/ui/button';
import {Textarea} from '@/src/components/ui/textarea';

const aliyunDefaults={aliyunDefaultEnd:'好的，先不打扰您了，再见。',aliyunOptOut:'好的，已记录不再联系，先不打扰您了，再见。',aliyunDurationEnd:'今天先沟通到这里，感谢您的时间，再见。',aliyunSilencePrompt:'请问您还在听吗？',aliyunSilenceEnd:'可能现在不方便，先不打扰您了，再见。',aliyunContinue:'我在听，您可以接着说。',aliyunFlowLimit:'今天先沟通到这里，后续请同事跟进，感谢您的时间，再见。',aliyunFlowError:'这个问题需要同事确认，今天先不打扰您了，再见。',aliyunNoReply:'嗯，您接着说。',aliyunUnclear:'刚才的信息我还没有听清，您可以接着说。',aliyunHandoff:'已记录您的人工跟进需求，会请同事联系您。感谢您的时间，再见。'};
export const systemSpeechDefaults:SystemSpeech={
  zh:{noResponseFirst:'您还有什么想了解的吗？',noResponseSecond:'请问您还在听吗？',noResponseEnd:'暂时没听到您的回复，先不打扰您了，再见。',unclear:'刚才没听清，麻烦您再说一下。',declined:'好，不打扰您了，再见。',followUp:'好的，我这边挂断后加您微信，谢谢，再见。',goodbye:'再见。',handoffStart:'请稍等，我联系一下在岗同事。',handoffUnavailable:'现在同事暂时没接通，我会安排同事跟进。先不打扰您了，再见。',audioCheck:'我在，您现在能听到我说话吗？',...aliyunDefaults},
  en:{noResponseFirst:"Is there anything else you'd like to know?",noResponseSecond:'Are you still there?',noResponseEnd:"I haven't heard a reply, so I'll let you go for now. Goodbye.",unclear:"Sorry, I didn't catch that. Could you repeat it?",declined:"Of course. I'll let you go. Goodbye.",followUp:"Okay, I'll follow up with you on WeChat after the call. Goodbye.",goodbye:'Goodbye.',handoffStart:'Please hold while I contact an available colleague.',handoffUnavailable:"My colleague isn't available right now. I'll arrange a follow-up. Thank you, and goodbye.",audioCheck:"I'm here. Can you hear me now?",...aliyunDefaults},
};
const fields: Array<{key:keyof SystemSpeechLanguage;label:string}>=[
  {key:'declined',label:'客户拒绝或结束'},
  {key:'followUp',label:'确认微信跟进后结束'},
  {key:'goodbye',label:'补充告别'},
  {key:'unclear',label:'听不清'},
  {key:'audioCheck',label:'客户听不到声音'},
  {key:'noResponseFirst',label:'第一次无回复'},
  {key:'noResponseSecond',label:'第二次无回复'},
  {key:'noResponseEnd',label:'无回复后结束'},
  {key:'handoffStart',label:'转人工前'},
  {key:'handoffUnavailable',label:'转人工未接通'},
  {key:'aliyunDefaultEnd',label:'阿里云：默认结束语'},
  {key:'aliyunOptOut',label:'阿里云：客户要求不再联系'},
  {key:'aliyunDurationEnd',label:'阿里云：通话时长到期'},
  {key:'aliyunSilencePrompt',label:'阿里云：静音提醒'},
  {key:'aliyunSilenceEnd',label:'阿里云：静音结束'},
  {key:'aliyunContinue',label:'阿里云：请客户继续'},
  {key:'aliyunFlowLimit',label:'阿里云：流程次数上限'},
  {key:'aliyunFlowError',label:'阿里云：流程异常结束'},
  {key:'aliyunNoReply',label:'阿里云：无有效回复'},
  {key:'aliyunUnclear',label:'阿里云：信息未听清'},
  {key:'aliyunHandoff',label:'阿里云：安排人工跟进'},
];
const hasSpeech = (value?:string) => !!value?.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();

// Save exactly the values displayed in the editor, including legacy defaults.
export function completeSystemSpeech(value?:SystemSpeech):SystemSpeech {
  return {zh:{...systemSpeechDefaults.zh,...value?.zh},en:{...systemSpeechDefaults.en,...value?.en}};
}

export function SystemSpeechEditor({value,disabled,onChange}:{value?:SystemSpeech;disabled:boolean;onChange:(value:SystemSpeech)=>void}){
  const [language,setLanguage]=useState<'zh'|'en'>('zh');
  const current=completeSystemSpeech(value);
  return <div className="space-y-4">
    <div className="flex gap-2" role="group" aria-label="场景话术语言">
      <Button type="button" size="sm" variant={language==='zh'?'secondary':'outline'} aria-pressed={language==='zh'} onClick={()=>setLanguage('zh')}>中文</Button>
      <Button type="button" size="sm" variant={language==='en'?'secondary':'outline'} aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>英文</Button>
    </div>
    <p className="text-xs text-muted-foreground">场景话术均需填写；保存并发布后，新建任务使用页面显示的内容。已创建任务保留原设置。</p>
    <div className="grid gap-4">
      {fields.map(({key,label})=><label key={key} className="grid gap-2 text-sm font-medium"><span>{label}</span><Textarea rows={2} maxLength={500} required aria-invalid={!hasSpeech(current[language][key])} value={current[language][key]??''} disabled={disabled} onChange={event=>onChange({...current,[language]:{...current[language],[key]:event.target.value}})}/>{!hasSpeech(current[language][key])&&<span className="text-destructive">请填写可播报的文字</span>}</label>)}
    </div>
  </div>;
}
