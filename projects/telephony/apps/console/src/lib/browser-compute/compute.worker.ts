/*
 * 中文导读：共享基础能力：compute.worker.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { executeTask, type TaskInputs } from './tasks';

const worker = self as unknown as {onmessage: (event: MessageEvent<{kind:keyof TaskInputs;input:TaskInputs[keyof TaskInputs]}>) => void;postMessage:(value:unknown,transfer?:Transferable[])=>void};
worker.onmessage = event => {
  try {
    const result = executeTask(event.data.kind,event.data.input);
    worker.postMessage({ok:true,result},result instanceof ArrayBuffer ? [result] : []);
  } catch (error) {
    worker.postMessage({ok:false,error:error instanceof Error ? error.message : '本机处理未完成。'});
  }
};
