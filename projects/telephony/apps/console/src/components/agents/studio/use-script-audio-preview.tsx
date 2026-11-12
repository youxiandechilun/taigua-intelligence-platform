/*
 * 中文导读：数字员工与话术的 use-script-audio-preview 组件，封装该界面的展示与交互。
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Loader2, Play, Square } from "lucide-react";
import { apiClient, unwrap } from "@/src/lib/api/client";
import { personalVoices, type CallVoiceProvider } from "@/src/lib/api/resources/personal-voices";
import { personalPlaybookApi } from "@/src/lib/api/resources/playbook";
import { defaultAudioSettings, telephonyApi, type AgentVoicePreview, type VoiceProfile } from "@/src/lib/api/resources/telephony";
import { cachedScriptAudio, CancelledBeforeSubmitError } from "@/src/lib/agents/script-audio-cache";
import { previewWav } from "@/src/components/telephony/employee-voice-audio";

type RecordingIdentity = { user: string; org: string; agentId: string; mode: "personal" | "template"; scope: string };
type PreviewPhase = "idle" | "loading" | "playing" | "error";
type PreviewState = { id: string; phase: PreviewPhase; message: string };
type PreviewInput = { id: string; text: string; label: string; blob?: Blob; getBlob?: () => Blob | undefined | Promise<Blob | undefined> };
type PreviewContext = { state: PreviewState; play: (input: PreviewInput) => Promise<void>; stop: (id?: string) => void };
const ScriptAudioContext = createContext<PreviewContext | null>(null);
const idle: PreviewState = { id: "", phase: "idle", message: "" };

function identityFromScope(scope: string): RecordingIdentity | null {
  try {
    const value: unknown = JSON.parse(scope);
    if (!Array.isArray(value) || value.length !== 5 || value[0] !== "script-recordings-v1" ||
      !value.slice(1, 4).every(item => typeof item === "string" && item.trim()) ||
      (value[4] !== "personal" && value[4] !== "template")) return null;
    return { user: value[1], org: value[2], agentId: value[3], mode: value[4], scope: JSON.stringify(value) };
  } catch { return null; }
}

async function currentProfile(identity: RecordingIdentity, provider: CallVoiceProvider, override?: VoiceProfile, anchor?:string): Promise<VoiceProfile> {
  // Tabs on the same origin share login cookies. Never put a new account's
  // generated clip into the old page's account/workspace cache.
  const session = (await apiClient.get<{ user?: { id?: string }; session?: { activeOrganizationId?: string } }>("/auth/get-session")).data;
  if (session.user?.id !== identity.user || session.session?.activeOrganizationId !== identity.org) {
    throw new Error("登录账号或工作区已切换，请刷新页面后再试听。");
  }
  if (provider !== "HAOKEHU_SIP") throw new Error("当前线路音色暂未支持按指定话术生成试听，请选择数字员工的模型声音。");
  // A trainer is auditioning the unsaved template voice. Personal preferences
  // must never replace that explicit selection.
  if (identity.mode === "template" && override && !anchor) {
    if (!override.realtimeModel || (!override.voiceId && !override.voice)) {
      throw new Error("请先在基础设置中选定语音模型和音色，再试听话术。");
    }
    return stableProfile(override);
  }
  const [catalog, base] = await Promise.all([
    personalVoices.catalog(identity.org, identity.agentId),
    override ? Promise.resolve(override) : identity.mode === "personal"
      ? personalPlaybookApi.get(identity.agentId, identity.org).then(value => value.configuration.profile)
      : telephonyApi.profile(identity.org, identity.agentId).then(value => value.profile),
  ]);
  const preference = catalog.providers.find(item => item.provider === provider);
  const anchored=anchor?preference?.options.find(v=>v.voiceId===anchor&&v.available):undefined;
  if(anchor&&!anchored)throw new Error('开场录音绑定的声音不可用，请重新选择录音人物。');
  const sound = anchored?{...anchored,volume:base.audio.volume}:preference?.effective;
  if (!sound || preference?.error) throw new Error(preference?.error || "当前个人声音不可用，请先在基础设置中选择声音。");
  return stableProfile({
    voiceId: sound.voiceId,
    realtimeModel: sound.model,
    voice: sound.voice,
    language: base.language,
    audio: {
      ...defaultAudioSettings,
      ...base.audio,
      volume: sound.volume ?? base.audio?.volume ?? defaultAudioSettings.volume,
    },
  });
}

// Stable field order also keeps a harmless object-key reorder from stopping
// playback. Audio settings remain local transforms, outside the synthesis key.
function stableProfile(value: VoiceProfile): VoiceProfile {
  const audio = { ...defaultAudioSettings, ...value.audio };
  return {
    voiceId: value.voiceId,
    realtimeModel: value.realtimeModel,
    voice: value.voice,
    language: value.language,
    audio: {
      volume: audio.volume,
      enhanceQuietSpeech: audio.enhanceQuietSpeech,
      noiseReduction: audio.noiseReduction,
      responseSpeed: audio.responseSpeed,
      sensitivity: audio.sensitivity,
      noInputSeconds: audio.noInputSeconds,
    },
  };
}

// Persist the original WAV. Gain is a playback transform, so changing volume
// never creates a second synthesis identity or another model request.
async function playbackGain(blob: Blob, volume: number): Promise<Blob> {
  if (volume === 100) return blob;
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("已保存的试听音频格式不正确，已停止重复生成。");
  let pcm = false;
  let found = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) throw new Error("已保存的试听音频不完整，已停止重复生成。");
    if (tag(offset) === "fmt ") pcm = size >= 16 && view.getUint16(start, true) === 1 && view.getUint16(start + 14, true) === 16;
    if (tag(offset) === "data") {
      if (!pcm || size % 2) throw new Error("已保存的试听音频格式不受支持，已停止重复生成。");
      for (let index = start; index < end; index += 2) {
        view.setInt16(index, Math.max(-32768, Math.min(32767, Math.round(view.getInt16(index, true) * volume / 100))), true);
      }
      found = true;
    }
    offset = end + size % 2;
  }
  if (!found) throw new Error("已保存的试听未包含音频，已停止重复生成。");
  return new Blob([buffer], { type: "audio/wav" });
}

export type ScriptPreviewProviderProps = {
  recordingScope?: string;
  /** Alias for callers which already name their recording key `scope`. */
  scope?: string;
  children: ReactNode;
  voiceProfile?: VoiceProfile;
  voiceAnchor?:string;
  provider?: CallVoiceProvider;
};

/** One playback owner for the editor; no audio/model request is started by an effect. */
export function ScriptPreviewProvider({ recordingScope, scope, children, voiceProfile, voiceAnchor, provider = "HAOKEHU_SIP" }: ScriptPreviewProviderProps) {
  const resolvedScope = recordingScope ?? scope ?? "";
  const profileSignature = voiceProfile ? JSON.stringify(stableProfile(voiceProfile)) : "";
  const source = useId();
  const [state, setState] = useState<PreviewState>(idle);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef("");
  const mounted = useRef(false);
  const operation = useRef(0);
  const currentId = useRef("");
  const currentPhase = useRef<PreviewPhase>("idle");
  const activeScope = useRef(resolvedScope);

  const show = useCallback((value: PreviewState) => {
    currentPhase.current = value.phase;
    if (mounted.current) setState(value);
  }, []);

  const releaseAudio = useCallback(() => {
    const player = audio.current;
    audio.current = null;
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
  }, []);

  const stop = useCallback((id?: string) => {
    if (id !== undefined && currentId.current !== id) return;
    operation.current += 1;
    currentId.current = "";
    releaseAudio();
    show(idle);
  }, [releaseAudio, show]);

  useEffect(() => {
    mounted.current = true;
    const started = (event: Event) => {
      if ((event as CustomEvent<{ source?: string }>).detail?.source !== source) stop();
    };
    const stopped = () => stop();
    window.addEventListener("taigua-script-audio-start", started);
    window.addEventListener("taigua-script-audio-stop", stopped);
    return () => {
      mounted.current = false;
      window.removeEventListener("taigua-script-audio-start", started);
      window.removeEventListener("taigua-script-audio-stop", stopped);
      stop();
    };
  }, [source, stop]);

  useEffect(() => {
    activeScope.current = resolvedScope;
    stop();
  }, [resolvedScope, provider, profileSignature, voiceAnchor, stop]);

  const play = useCallback(async (input: PreviewInput) => {
    if (currentId.current === input.id && (currentPhase.current === "loading" || currentPhase.current === "playing")) {
      stop(input.id);
      return;
    }
    releaseAudio();
    const token = ++operation.current;
    const requestScope = resolvedScope;
    currentId.current = input.id;
    const current = () => mounted.current && operation.current === token && activeScope.current === requestScope;
    show({ id: input.id, phase: "loading", message: "" });
    // Also stop legacy inline audio controls still present in advanced settings.
    document.querySelectorAll<HTMLAudioElement>("audio[data-script-recording]").forEach(player => player.pause());
    window.dispatchEvent(new CustomEvent("taigua-script-audio-start", { detail: { source } }));
    try {
      let blob = (await input.getBlob?.()) ?? input.blob;
      let warning = "";
      if (!blob) {
        const text = input.text.trim();
        const identity = identityFromScope(requestScope);
        if (!identity) throw new Error("请先登录并选择数字员工，再试听当前话术。");
        if (!text) throw new Error("请先填写这句话，再点击试听。");
        if (text.length > 300) throw new Error("单次语音试听最多300字，请将这段话术分成较短的步骤。");
        if (/\{\{[^{}]+\}\}/u.test(text)) throw new Error("这句话还有未填写的变量，请先替换后试听。");
        const profile = await currentProfile(identity, provider, voiceProfile,voiceAnchor);
        if (!current()) return;
        // Only parameters consumed by synthesizePreview belong to its cache
        // identity. Microphone settings and local PCM gain never change speech.
        const policy=await unwrap<{settings:Record<string,unknown>}>(apiClient.get("/telephony/voice-policy",{headers:{"x-workspace-id":identity.org}}));
        const {deliveryStyle,speakingPace,pauseStyle,emotionLevel,conversationalStyle,replyLength,followCustomerEmotion,customDirection}=policy.settings;
        if(!current())return;
        const signature = JSON.stringify({deliveryStyle,speakingPace,pauseStyle,emotionLevel,conversationalStyle,replyLength,followCustomerEmotion,customDirection,
          version: "expressive-context-20261020", text,
          model: profile.realtimeModel, voiceId: profile.voiceId,
          voice: profile.voice, language: profile.language,
        });
        const key = JSON.stringify(["script-audio-v1", identity.scope, signature]);
        const clip = await cachedScriptAudio({ key, scope: identity.scope, signature }, requestId => {
          // Web Locks and IndexedDB can wait beyond a stop/unmount. Check at
          // the actual submission boundary, with no await between guard/POST.
          if (!current()) throw new CancelledBeforeSubmitError();
          return unwrap<AgentVoicePreview>(apiClient.post(identity.mode==="personal"?"/telephony/my-voices/"+encodeURIComponent(identity.agentId)+"/script-preview":"/telephony/agents/" + encodeURIComponent(identity.agentId) + "/voice-preview", identity.mode==="personal"?{text,requestId,confirmed:true,...(voiceAnchor?{voiceId:voiceAnchor}:{})}:{
            profile, text, requestId, confirmed: true,
          }, { headers: { "x-workspace-id": identity.org, "x-script-preview-user": identity.user }, timeout: 65000 }));
        },
          data => previewWav(data, 100),
        );
        blob = await playbackGain(clip.blob, profile.audio.volume);
        warning = clip.warning || "";
      }
      if (!current()) return;
      if (!(blob instanceof Blob) || !blob.size) throw new Error("这条录音没有可播放的音频，请重新选择。");
      const objectUrl = URL.createObjectURL(blob);
      url.current = objectUrl;
      const player = new Audio(objectUrl);
      audio.current = player;
      player.onended = () => {
        if (!current()) return;
        releaseAudio();
        show({ id: input.id, phase: "idle", message: warning });
      };
      player.onerror = () => {
        if (!current()) return;
        releaseAudio();
        show({ id: input.id, phase: "error", message: "音频暂时无法播放，可再次点击播放已保存的音频。" });
      };
      await player.play();
      if (current()) show({ id: input.id, phase: "playing", message: warning });
    } catch (error) {
      if (!current()) return;
      releaseAudio();
      show({ id: input.id, phase: "error", message: error instanceof Error ? error.message : "试听暂不可用，请稍后再试。" });
    }
  }, [resolvedScope, provider, voiceProfile, voiceAnchor, source, releaseAudio, show, stop]);

  const context = useMemo(() => ({ state, play, stop }), [state, play, stop]);
  return <ScriptAudioContext.Provider value={context}>{children}</ScriptAudioContext.Provider>;
}

export type ScriptPreviewButtonProps = Omit<PreviewInput, "id" | "label"> & {
  id?: string;
  label?: string;
  revision?: string | number;
  disabled?: boolean;
  className?: string;
  showText?: boolean;
};

/** A compact play/stop control; an available recording never needs voice configuration. */
export function ScriptPreviewButton({ id: suppliedId, text, label = "试听这句话", blob, getBlob, revision, disabled = false, className, showText = false }: ScriptPreviewButtonProps) {
  const fallbackId = useId();
  const id = suppliedId || "script-audio:" + fallbackId;
  const context = useContext(ScriptAudioContext);
  const stop = context?.stop;
  // Editing/removing the line or changing its recording invalidates an in-flight
  // playback. Its already-submitted model result may still finish saving safely.
  useEffect(() => () => stop?.(id), [id, text, blob, revision, stop]);
  const currentState = context && context.state.id === id ? context.state : null;
  const busy = currentState?.phase === "loading";
  const playing = currentState?.phase === "playing";
  const message = currentState?.message || "";
  const action = busy ? "停止试听准备" : playing ? "停止试听" : label;
  const unavailable = !context || (!blob && !getBlob && !text.trim());
  return <span className="inline-flex max-w-full items-center gap-1.5">
    <button
      type="button"
      className={className || "inline-flex shrink-0 items-center justify-center rounded border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"}
      style={showText ? { height: 36, minWidth: 80, padding: "0 12px" } : { width: 28, height: 28, minWidth: 28 }}
      aria-label={action}
      title={message || action}
      aria-pressed={playing}
      aria-busy={busy}
      disabled={unavailable || (disabled && !busy && !playing)}
      onClick={event => { event.stopPropagation(); if (context) void context.play({ id, text, label, blob, getBlob }); }}
    >
      {busy ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : playing ? <Square size={13} aria-hidden="true" fill="currentColor" /> : <Play size={13} aria-hidden="true" fill="currentColor" />}
      {showText && <span>{busy ? "准备中" : playing ? "停止" : "试听"}</span>}
    </button>
    {message ? <><span title={message} aria-label={message} tabIndex={0} className="inline-flex text-destructive"><CircleAlert size={13} aria-hidden="true" /></span><span role="status" aria-live="polite" className="sr-only">{message}</span></> : null}
  </span>;
}
