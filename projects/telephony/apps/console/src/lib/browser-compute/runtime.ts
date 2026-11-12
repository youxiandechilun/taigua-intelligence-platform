/*
 * 中文导读：共享基础能力：runtime.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type {TaskInputs,TaskResults} from './tasks';

class WorkerUnavailable extends Error {}
let available: boolean | undefined;
export function resetWorkerCheck() { available=undefined; }
export function workerTask<K extends keyof TaskInputs>(kind:K,input:TaskInputs[K],signal?:AbortSignal):Promise<TaskResults[K]> {
  if (signal?.aborted) return Promise.reject(new DOMException('已取消','AbortError'));
  if (typeof Worker==='undefined' || available===false) return Promise.reject(new WorkerUnavailable('使用兼容处理方式'));
  return new Promise((resolve,reject) => {
    let worker:Worker;
    try { worker=new Worker(new URL('./compute.worker.ts',import.meta.url),{type:'module',name:'taigua-local-compute'}); }
    catch { available=false;reject(new WorkerUnavailable('使用兼容处理方式'));return; }
    const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();};
    const abort=()=>{clean();reject(new DOMException('已取消','AbortError'));};
    const unavailable=()=>{available=false;clean();reject(new WorkerUnavailable('使用兼容处理方式'));};
    const timer=setTimeout(unavailable,30000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=unavailable;worker.onmessageerror=unavailable;
    worker.onmessage=(event:MessageEvent<{ok:boolean;result:TaskResults[K];error:string}>)=>{available=true;clean();if(event.data.ok)resolve(event.data.result);else reject(new Error(event.data.error));};
    try { worker.postMessage({kind,input}); } catch { unavailable(); }
  });
}

export async function localTask<K extends keyof TaskInputs>(kind:K,input:TaskInputs[K],signal?:AbortSignal):Promise<TaskResults[K]> {
  try { return await workerTask(kind,input,signal); }
  catch (error) {
    if (!(error instanceof WorkerUnavailable)) throw error;
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    if (signal?.aborted) throw new DOMException('已取消','AbortError');
    const {executeTask}=await import('./tasks');
    return executeTask(kind,input);
  }
}

export type ComputeProfile={workers:boolean;audio:boolean;cores:number;lowPower:boolean;probeMs:number|null};
let profile:Promise<ComputeProfile>|undefined;
export function browserComputeProfile(refresh=false) {
  if(refresh){profile=undefined;resetWorkerCheck();}
  return profile??= (async()=>{
    const cores=navigator.hardwareConcurrency||2;
    const memory=(navigator as Navigator & {deviceMemory?:number}).deviceMemory;
    const probeMs=await workerTask('probe',null).catch(()=>null);
    return {workers:probeMs!==null,audio:typeof AudioContext!=='undefined'&&typeof OfflineAudioContext!=='undefined',cores,lowPower:cores<=2||(memory!==undefined&&memory<=2)||(probeMs!==null&&probeMs>45),probeMs};
  })();
}
