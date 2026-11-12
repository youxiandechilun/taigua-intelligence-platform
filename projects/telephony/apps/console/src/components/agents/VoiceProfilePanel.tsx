/*
 * 中文导读：人物声音档案与绑定信息。
 */
"use client";

import { uiLabel, languageLabel as languageName } from "@/src/lib/locale";

import { useMemo, useState } from "react";
import { Volume2 } from "lucide-react";

import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import type { Voice } from "@/src/lib/data/voices";

export function VoiceProfilePanel({
  voice,
  languageLabel,
  ttsModelLabel,
}: {
  voice?: Voice;
  languageLabel: string;
  ttsModelLabel: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const canPreview =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const tags = useMemo(
    () => [...(voice?.styles ?? []), ...(voice?.useCases ?? [])].slice(0, 8),
    [voice?.styles, voice?.useCases]
  );

  function playBrowserSample() {
    if (!canPreview || !voice) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      "您好，感谢来电。请问有什么可以帮您？"
    );
    utterance.lang = voice.locale || voice.languages[0] || "en-US";
    utterance.rate = 0.96;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  if (!voice) {
    return (
      <div className="border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
        选择兼容的声音后，可查看音色详情。
      </div>
    );
  }

  return (
    <div className="border bg-muted/20 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{voice.name}</h3>
            <Badge variant="outline">{voice.provider}</Badge>
            <Badge variant="secondary">{ttsModelLabel}</Badge>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">性别</p>
              <p className="mt-1 font-medium">{uiLabel(voice.gender)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">语言地区</p>
              <p className="mt-1 font-medium">{voice.locale ? languageName(voice.locale) : languageLabel}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">口音</p>
              <p className="mt-1 font-medium">{uiLabel(voice.accent)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">支持语言</p>
              <p className="mt-1 font-medium tabular-nums">
                {voice.languages.length}
              </p>
            </div>
          </div>
          {tags.length ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge key={uiLabel(tag)} variant="outline">
                  {uiLabel(tag)}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 lg:w-52">
          <Button
            type="button"
            variant="outline"
            title="浏览器试听仅用于比较语速，不代表实际通话效果。"
            onClick={playBrowserSample}
            disabled={!canPreview || speaking}
          >
            <Volume2 className="size-4" />
            {speaking ? "播放中" : "浏览器试听"}
          </Button>
        </div>
      </div>
    </div>
  );
}
