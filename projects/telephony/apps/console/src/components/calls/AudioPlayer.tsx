/*
 * 中文导读：录音播放、进度和音量控制。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import { useRef, useState } from "react";
import { Download, Loader2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/src/components/ui/button";

function time(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function RecordingPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const loaded = duration > 0;

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    try {
      setError(""); setWaiting(true);
      if (audio.error) audio.load();
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
    } catch {
      setWaiting(false); setPlaying(false);
      setError("录音无法播放，请重试或下载。");
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !loaded) return;
    const next = Math.max(0, Math.min(duration, value));
    try { audio.currentTime = next; setPosition(next); }
    catch { setError("暂时无法定位，请等待录音加载。"); }
  }

  function updateDuration() {
    const value = audioRef.current?.duration ?? 0;
    setDuration(Number.isFinite(value) && value > 0 ? value : 0);
  }

  return <section aria-label="通话录音播放器" className="rounded-xl border bg-background p-4">
    <header className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">通话录音</h3>
      <Button asChild variant="ghost" size="sm" className="h-7 px-2">
        <a href={src} download target="_blank" rel="noreferrer"><Download className="size-3.5" />下载</a>
      </Button>
    </header>
    <input type="range" aria-label="录音播放进度" aria-valuetext={`${time(position)}，共 ${time(duration)}`}
      min={0} max={loaded ? duration : 1} step={0.1} value={Math.min(position, duration || 0)} disabled={!loaded}
      onChange={event => seek(Number(event.target.value))}
      className="block h-5 w-full cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait"
    />
    <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground" aria-live="off">
      <span>{time(position)}</span><span>{loaded ? time(duration) : "—:—"}</span>
    </div>
    <div className="mt-3 grid min-w-0 grid-cols-[36px_minmax(0,1fr)_36px_60px] items-center gap-2">
      <Button type="button" size="icon" variant="ghost" className="size-9" aria-label="后退10秒" disabled={!loaded} onClick={() => seek(position - 10)}><RotateCcw className="size-4" /></Button>
      <Button type="button" className="h-9 w-full min-w-0 max-w-36 justify-self-center px-3" onClick={() => { void toggle(); }} aria-label={playing ? "暂停录音播放" : "播放录音"}>
        {waiting ? <Loader2 className="size-4 animate-spin" /> : playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        {playing ? "暂停" : error ? "重试" : "播放"}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="size-9" aria-label="前进10秒" disabled={!loaded} onClick={() => seek(position + 10)}><RotateCw className="size-4" /></Button>
      <NativeSelect aria-label="播放倍速" value={speed} className="h-9 w-full min-w-0 rounded-md border bg-background px-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onChange={event => { const value = Number(event.target.value); setSpeed(value); if (audioRef.current) audioRef.current.playbackRate = value; }}>
        {[0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}
      </NativeSelect>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <audio ref={audioRef} src={src} preload="metadata"
      onLoadedMetadata={updateDuration} onDurationChange={updateDuration}
      onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPlaying={() => setWaiting(false)} onWaiting={() => setWaiting(true)}
      onPause={() => { setPlaying(false); setWaiting(false); }} onEnded={() => { setPlaying(false); setWaiting(false); }}
      onCanPlay={() => setWaiting(false)}
      onError={() => { setPlaying(false); setWaiting(false); setError("录音无法加载，请重试或下载。"); }}
    />
  </section>;
}

export function AudioPlayer({ src }: { src: string | null }) {
  return src ? <RecordingPlayer key={src} src={src} /> : <div className="rounded-xl border bg-background p-4 text-sm text-muted-foreground">暂无录音</div>;
}
