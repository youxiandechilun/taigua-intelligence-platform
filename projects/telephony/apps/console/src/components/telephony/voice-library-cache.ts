/*
 * 中文导读：线路与语音外呼的 voice-library-cache 组件，封装该界面的展示与交互。
 */
import type {QueryClient} from '@tanstack/react-query';
export function refreshVoiceLibrary(client:QueryClient){
 for(const key of ['voice-library','my-voice','voice-opening','voice-control','employee-voice-catalog','employee-model-catalog','voice-model-catalog'])void client.invalidateQueries({queryKey:[key]});
}
