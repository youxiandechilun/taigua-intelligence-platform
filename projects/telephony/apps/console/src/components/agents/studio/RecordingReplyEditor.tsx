/*
 * 中文导读：话术录音直播放音设置。
 */
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AudioLines, Check, CircleAlert, Loader2, Mic, Square, Trash2, Upload } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { openingClips, withOpeningClips, type OpeningRecordingClip, type ScriptRecording } from "./use-script-recordings";
import { ScriptPreviewButton } from "./use-script-audio-preview";
import { OpeningVoiceCloneButton } from "./OpeningVoiceCloneButton";
import styles from "./simple-script-editor.module.css";

const maxBytes = 20 * 1024 * 1024;
const defaultRecording: ScriptRecording = { mode: "recording-first" };

export function recordingStatus(entry: ScriptRecording | undefined, text: string) {
  if (entry?.mode === "ai") return "AI回答";
  if (!entry?.blob) return "可添加录音";
  return entry.transcript?.trim() === text.trim() ? "已有录音" : "录音待核对";
}

export function RecordingAudio({ blob, label, disabled }: { blob: Blob; label: string; disabled?: boolean }) {
  const id = useId();
  return <span className={styles.audioControl}><ScriptPreviewButton id={id} text="" blob={blob} label={label} disabled={disabled} className={styles.previewButton} /></span>;
}

function inspectAudio(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let settled = false;
    const timer = window.setTimeout(() => done("音频读取超时，请重新选择文件。"), 10000);
    function done(message?: string) {
      if (settled) return;
      settled = true; audio.onloadedmetadata = null; audio.onerror = null;
      window.clearTimeout(timer); audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url);
      message ? reject(new Error(message)) : resolve();
    }
    audio.onloadedmetadata = () => {
      audio.onloadedmetadata = null; audio.onerror = null;
      done(!Number.isFinite(audio.duration) || audio.duration < 0.1 || audio.duration > 45 ? "每条录音请控制在 0.1 至 45 秒。" : undefined);
    };
    audio.onerror = () => { audio.onloadedmetadata = null; audio.onerror = null; done("无法读取这段录音，请换成 MP3、M4A 或 WAV 文件。"); };
    audio.preload = "metadata"; audio.src = url;
  });
}

export function RecordingReplyEditor({ entry: storedEntry = defaultRecording, text, onChange, disabled, onRecordingChange, kind = "answer", voiceOptions = [], defaultVoiceId,recordingScope,canUpdateExistingVoice,onVoiceCloned }: {
  recordingScope?:string;
  canUpdateExistingVoice?:boolean;
  onVoiceCloned?:(id:string)=>void;
  voiceOptions?: {voiceId:string;name:string}[];
  defaultVoiceId?:string;
  entry?: ScriptRecording;
  text: string;
  onChange: (entry: ScriptRecording) => void;
  disabled: boolean;
  onRecordingChange: (recording: boolean) => void;
  kind?: "opening" | "speech" | "answer";
}) {
  const entry = kind === "opening" ? { ...storedEntry, mode: "recording-first" as const } : storedEntry;
  const fileInput = useRef<HTMLInputElement>(null);
  const openingGroup = useId();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const clips = openingClips(entry);
  const inactive = disabled || recording || pending;
  const stale = !!entry.blob && entry.transcript?.trim() !== text.trim();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
      onRecordingChange(false);
    };
  }, [onRecordingChange]);
  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => setSeconds(s => s + 1), 1000);
    const limit = window.setTimeout(() => recorder.current?.stop(), 44000);
    return () => { window.clearInterval(interval); window.clearTimeout(limit); };
  }, [recording]);

  function attachAudio(blob: Blob, fileName: string) {
    if (kind === "opening") {
      onChange(withOpeningClips(entry, [...clips, { id: crypto.randomUUID(), blob, fileName, transcript: text, voiceId:defaultVoiceId }]));
    } else {
      onChange({ ...entry, mode: "recording-first", blob, fileName, transcript: text, updatedAt: new Date().toISOString() });
    }
  }

  async function upload(files: File[]) {
    if (!files.length || disabled || pending || recording) return;
    setPending(true); setError(""); onRecordingChange(true);
    const added: OpeningRecordingClip[] = [];
    const errors: string[] = [];
    try {
      for (const file of (kind === "opening" ? files : files.slice(0, 1))) {
        if (!mounted.current) break;
        try {
          if (file.size > maxBytes) throw new Error("超过 20MB，请压缩或剪短后重选。");
          if (!file.size || !/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(file.name)) throw new Error("请选择有效的音频文件。");
          await inspectAudio(file);
          added.push({ id: crypto.randomUUID(), blob: file, fileName: file.name, transcript: text, voiceId:defaultVoiceId });
        } catch (e) { errors.push(`${file.name}：${e instanceof Error ? e.message : "读取失败，请重新选择。"}`); }
      }
      if (mounted.current) {
        if (added.length) {
          if (kind === "opening") onChange(withOpeningClips(entry, [...clips, ...added]));
          else attachAudio(added[0].blob, added[0].fileName);
        }
        setError(errors.join("\n"));
      }
    }
    finally { if (mounted.current) { setPending(false); onRecordingChange(false); } }
  }

  async function startRecording() {
    if (disabled || pending) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("当前浏览器不支持录音，请使用上传录音。"); return; }
    window.dispatchEvent(new Event("taigua-script-audio-stop"));
    setPending(true); setError(""); onRecordingChange(true);
    let started = false;
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!mounted.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      const device = new MediaRecorder(input, mimeType ? { mimeType } : undefined);
      recorder.current = device;
      const chunks: Blob[] = [];
      let interrupted = false;
      device.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      device.onstop = () => {
        input.getTracks().forEach(track => track.stop()); stream.current = null; recorder.current = null;
        if (!mounted.current) return;
        setRecording(false); onRecordingChange(false);
        if (interrupted) return;
        const blob = new Blob(chunks, { type: device.mimeType || "audio/webm" });
        if (!blob.size || blob.size > maxBytes) { setError(blob.size ? "录音超过 20MB，请缩短录音。" : "没有录到声音，请重新录制。"); return; }
        attachAudio(blob, `${kind === "opening" ? "开场" : "话术"}录音-${new Date().toLocaleDateString("zh-CN").replaceAll("/", "-")}.${device.mimeType.includes("mp4") ? "m4a" : "webm"}`);
      };
      device.onerror = () => {
        interrupted = true;
        input.getTracks().forEach(track => track.stop());
        if (mounted.current) { setRecording(false); onRecordingChange(false); setError("录音中断，请检查麦克风后重试。"); }
      };
      device.start(); started = true; setSeconds(0); setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
      if (mounted.current) setError(e instanceof DOMException && e.name === "NotAllowedError" ? "未获得麦克风权限，可以允许录音后重试，或上传已有录音。" : "无法使用麦克风，请检查设备或上传已有录音。");
    } finally { if (mounted.current) { setPending(false); if (!started) onRecordingChange(false); } }
  }

  return <section className={styles.recordingConfig} aria-label={kind === "opening" ? "开场录音" : "话术声音"}>
    <div className={styles.recordingToolbar}>
      <span className={styles.recordingLabel}>{kind === "opening" ? `录音${clips.length ? ` ${clips.length}` : ""}` : "声音"}</span>
      <select className={styles.recordingSelect} aria-label={kind === "opening" ? "开场录音播放方式" : "话术播放方式"} value={kind === "opening" ? entry.openingPlayback || "random" : entry.mode} disabled={inactive} onChange={event => onChange(kind === "opening" ? { ...withOpeningClips(entry, clips), openingPlayback: event.target.value as "random" | "fixed" } : { ...entry, mode: event.target.value as ScriptRecording["mode"] })}>
        {kind === "opening" ? <><option value="random">随机播放</option><option value="fixed">指定录音</option></> : <><option value="recording-first">录音优先</option><option value="ai">{kind === "speech" ? "AI朗读" : "AI回答"}</option></>}
      </select>
      {entry.mode !== "ai" && <div className={styles.recordingButtons}>
        <input ref={fileInput} type="file" className="sr-only" accept="audio/*,.m4a" multiple={kind === "opening"} aria-label={kind === "opening" ? "选择多条开场录音文件" : "选择话术录音文件"} disabled={inactive || (kind !== 'opening' && !text.trim())} onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
        <Button type="button" size="xs" variant="ghost" disabled={inactive || (kind !== 'opening' && !text.trim())} title={kind === "opening" ? "支持多选，每条不超过 45 秒、20MB" : "每条不超过 45 秒、20MB"} onClick={() => fileInput.current?.click()}>{pending ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}{kind === "opening" ? "添加录音" : entry.blob ? "替换录音" : "上传录音"}</Button>
        {recording ? <Button type="button" size="xs" variant="ghost" className={styles.stopRecording} onClick={() => recorder.current?.stop()}><Square className="size-3 fill-current" />结束 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</Button> : <Button type="button" size="icon-xs" variant="ghost" aria-label={kind === "opening" ? "直接录制开场白" : "直接录制这句话"} title="直接录制" disabled={disabled || pending || (kind !== 'opening' && !text.trim())} onClick={() => void startRecording()}><Mic className="size-3.5" /></Button>}
      </div>}
    </div>
    {kind === "opening" && clips.length > 0 && <div className={styles.openingClips}>
      {clips.map((clip, index) => <div key={clip.id} className={`${styles.openingClip} ${entry.openingPlayback === "fixed" && (entry.selectedOpeningId || clips[0]?.id) === clip.id ? styles.selectedClip : ""}`}>
        <div className={styles.fileRow}>
          <label className={styles.clipChoice}>
            {entry.openingPlayback === "fixed" ? <input type="radio" name={openingGroup} aria-label={`使用第 ${index + 1} 条开场录音：${clip.fileName}`} checked={(entry.selectedOpeningId || clips[0]?.id) === clip.id} disabled={inactive} onChange={() => onChange({ ...withOpeningClips(entry, clips), selectedOpeningId: clip.id })} /> : <span className={styles.clipNumber}>{index + 1}</span>}
            <span className={styles.fileName} title={clip.fileName}>{clip.fileName}</span>
          </label>
          <RecordingAudio blob={clip.blob} label={`试听开场录音 ${index + 1}：${clip.fileName}`} disabled={inactive} />
          <Button type="button" size="icon-xs" variant="ghost" aria-label={`移除开场录音：${clip.fileName}`} disabled={inactive} onClick={() => onChange(withOpeningClips(entry, clips.filter(item => item.id !== clip.id)))}><Trash2 className="size-3" /></Button>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">声音人物<select aria-label={`开场录音 ${index+1} 的声音人物`} className="h-7 max-w-56 rounded border bg-background px-2 text-foreground" value={clip.voiceId||''} disabled={inactive} onChange={event=>onChange(withOpeningClips(entry,clips.map(item=>item.id===clip.id?{...item,voiceId:event.target.value||undefined}:item)))}><option value="">选择声音库中的本人</option>{clip.voiceId&&!voiceOptions.some(v=>v.voiceId===clip.voiceId)&&<option value={clip.voiceId} disabled>关联声音不可用</option>}{voiceOptions.map(v=><option key={v.voiceId} value={v.voiceId}>{v.name}</option>)}</select>{!clip.voiceId&&<span className="text-amber-700">待关联</span>}</label>
        <OpeningVoiceCloneButton clip={clip} scope={recordingScope} personName={voiceOptions.find(v=>v.voiceId===clip.voiceId)?.name} disabled={inactive} canUpdateExisting={canUpdateExistingVoice} onBusy={onRecordingChange} onReady={(id)=>{onChange(withOpeningClips(entry,clips.map(item=>item.id===clip.id?{...item,voiceId:id}:item)));onVoiceCloned?.(id);}} />
        {text.trim() && clip.transcript.trim() !== text.trim() && <div className={styles.stale}><CircleAlert size={12} /><span>文案已改，请核对录音。</span><button type="button" disabled={inactive} onClick={() => onChange(withOpeningClips(entry, clips.map(item => item.id === clip.id ? { ...item, transcript: text } : item)))}><Check size={12} />已核对</button></div>}
      </div>)}
    </div>}
    {kind !== "opening" && entry.mode !== "ai" && entry.blob && <div className={styles.attachedAudio}>
      <div className={styles.fileRow}><AudioLines size={13} /><span className={styles.fileName} title={entry.fileName}>{entry.fileName || "话术录音"}</span><RecordingAudio blob={entry.blob} label="试听这条话术录音" disabled={inactive} /><Button type="button" size="icon-xs" variant="ghost" aria-label="移除当前录音" disabled={inactive} onClick={() => onChange({ mode: entry.mode })}><Trash2 className="size-3" /></Button></div>
      {stale && <div className={styles.stale}><CircleAlert size={12} /><span>文案已改，请核对录音。</span><button type="button" disabled={inactive} onClick={() => onChange({ ...entry, transcript: text })}><Check size={12} />已核对</button></div>}
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
