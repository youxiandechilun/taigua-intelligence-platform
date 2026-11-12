/*
 * 中文导读：共享基础能力：ws.d.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Type only the existing ws dependency's client surface used by voice previews.
// No new runtime library is installed for this integration.
declare module 'ws' {
 import { EventEmitter } from 'node:events';
 export default class WebSocket extends EventEmitter {
  constructor(url:string,options?:{headers?:Record<string,string>;handshakeTimeout?:number;maxPayload?:number});
  send(data:string):void;
  close():void;
 }
}
