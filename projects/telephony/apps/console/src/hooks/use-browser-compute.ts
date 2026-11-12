/*
 * 中文导读：共享基础能力的 use-browser-compute 钩子，复用组件状态和生命周期处理。
 */
"use client";
import {useEffect,useState} from 'react';
import {browserComputeProfile,localTask,type ComputeProfile} from '@/src/lib/browser-compute/runtime';
import {parseRecipientText} from '@/src/lib/outbound/recipient-input';

export function useBrowserCompute() {
  const [profile,setProfile]=useState<ComputeProfile|null>(null);
  useEffect(()=>{let live=true;void browserComputeProfile().then(value=>{if(live)setProfile(value);});return()=>{live=false;};},[]);
  return profile;
}

export function useLocalRecipients(text:string) {
  const [state,setState]=useState<{text:string;result:ReturnType<typeof parseRecipientText>;error:string}|null>(null);
  useEffect(()=>{
    if(!text)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{void localTask('numbers',text,controller.signal).then(result=>setState({text,result,error:''})).catch((error:Error)=>{if(error.name!=='AbortError')setState({text,result:{recipients:[],issues:[],duplicates:0},error:'号码未读取完成，请重新粘贴。'});});},120);
    return()=>{clearTimeout(timer);controller.abort();};
  },[text]);
  const ready=state?.text===text;
  return { ...(ready?state.result:{recipients:[],issues:[],duplicates:0}), pending:!!text&&!ready,error:ready?state.error:'' };
}
