/*
 * 中文导读：企业微信：wecom.crypto.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Protocol reference: official @wecom/crypto 1.0.1 (MIT), downloaded from the
// official Enterprise WeChat resource page. Validate padding and receiver ID
// before accepting the plaintext. This module uses the existing Node crypto.
import {createHash,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {XMLParser} from 'fast-xml-parser';
const parser=new XMLParser({ignoreAttributes:true,parseTagValue:false,processEntities:false});
export function xmlMessage(input:string):Record<string,string>{if(input.length>65536||/<!DOCTYPE|<!ENTITY/i.test(input))throw new Error('invalid XML');const value=parser.parse(input)?.xml;if(!value||typeof value!=='object')throw new Error('invalid XML');return value;}
export function decryptCallback(token:string,key:string,corpId:string,signature:string,timestamp:string,nonce:string,encrypted:string){
 if(!/^[a-f0-9]{40}$/i.test(signature)||!/^\d{1,13}$/.test(timestamp)||nonce.length>128||encrypted.length>65536||!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted))throw new Error('invalid callback');
 if(Math.abs(Date.now()/1000-Number(timestamp))>600)throw new Error('expired callback');
 const expected=createHash('sha1').update([token,timestamp,nonce,encrypted].sort().join('')).digest();if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new Error('signature mismatch');
 if(!/^[A-Za-z0-9+/]{43}$/.test(key))throw new Error('invalid key');const aes=Buffer.from(key+'=','base64');const decipher=createDecipheriv('aes-256-cbc',aes,aes.subarray(0,16));decipher.setAutoPadding(false);const plain=Buffer.concat([decipher.update(Buffer.from(encrypted,'base64')),decipher.final()]);const pad=plain[plain.length-1]!;
 if(pad<1||pad>32||plain.subarray(-pad).some(b=>b!==pad))throw new Error('invalid padding');const data=plain.subarray(0,-pad);if(data.length<20)throw new Error('invalid message');const len=data.readUInt32BE(16);if(len>data.length-20)throw new Error('invalid length');if(data.subarray(20+len).toString()!==corpId)throw new Error('receiver mismatch');return data.subarray(20,20+len).toString('utf8');
}
