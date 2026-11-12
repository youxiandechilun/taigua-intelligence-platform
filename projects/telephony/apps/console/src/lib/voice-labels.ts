/*
 * 中文导读：共享基础能力：voice-labels.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {realtimeBuiltinVoices} from './realtime-voices';

// Keep provider identifiers in request values and use readable names in forms.
const builtinNames: Record<string, string> = {
  ...Object.fromEntries(Object.values(realtimeBuiltinVoices).flat().map(voice=>[voice.id,voice.name])),
  'longanqian_v3.1': '默认客服音色',
  Cherry: '芊悦',
};

export function builtinVoiceLabel(id: string, name?: string): string {
  // A voice ID can have different display names across model catalogs.
  if (name && /\p{Script=Han}/u.test(name)) return name;
  return builtinNames[id] || '系统音色';
}

export function personalVoiceLabel(voice: { name: string; voice: string; voiceId?: string; kind?: string }): string {
  return voice.kind === 'builtin' || (!voice.kind && !voice.voiceId)
    ? builtinVoiceLabel(voice.voice, voice.name)
    : voice.name;
}
