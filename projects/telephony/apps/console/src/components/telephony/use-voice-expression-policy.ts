/*
 * 中文导读：线路与语音外呼的 use-voice-expression-policy 组件，封装该界面的展示与交互。
 */
"use client";
import {useQuery} from '@tanstack/react-query';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {apiClient,unwrap} from '@/src/lib/api/client';
const fields=['deliveryStyle','speakingPace','pauseStyle','emotionLevel','conversationalStyle','replyLength','followCustomerEmotion','customDirection'] as const;
export function useVoiceExpressionPolicy(){
 const {org,user}=useAliyunIdentity();
 const query=useQuery({queryKey:['voice-delivery',org,user],queryFn:()=>unwrap<{settings:Record<string,unknown>}>(apiClient.get('/telephony/voice-policy',{headers:{'x-workspace-id':org}})),enabled:!!org&&!!user,retry:false});
 return {ready:query.isSuccess&&!query.isFetching,signature:JSON.stringify(fields.map(key=>query.data?.settings[key]??null)),error:query.error};
}
