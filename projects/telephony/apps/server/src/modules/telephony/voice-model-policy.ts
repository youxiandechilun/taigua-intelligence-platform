/*
 * 中文导读：通话语音模型的约束与兼容规则。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';
// Central call policy; user-supplied profile fields cannot change the model.
// Change this constant only together with clone compatibility and telephone acceptance.
export const CALL_VOICE_MODEL='qwen3.8-omni-flash-realtime' as const;
export function assertFixedCallModel(model:string){if(model!==CALL_VOICE_MODEL)throw new BadRequestError('此声音使用旧版模型，请先在声音库升级复刻声音，再进行通话。');}
