/*
 * 中文导读：数字员工与话术的 AgentIdentity 组件，封装该界面的展示与交互。
 */
"use client";
import { useRef, useState } from "react";
import { characterFor, defaultCharacter } from "@/src/lib/agents/character-library";
import { CharacterLibraryPicker } from "./CharacterLibraryPicker";
import {
  Phone,
  Briefcase,
  Headset,
  Sparkles,
  ChartNoAxesCombined,
  Handshake,
  Globe,
  MessageCircle,
  Pencil, Save } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/src/components/ui/dialog";
import { useUpdateAgent } from "@/src/hooks/queries/agents";
import type { Agent } from "@/src/lib/api/types";
import { toast } from "@/src/lib/toast";
const choices = [
  { id: "phone", label: "电话", Icon: Phone },
  { id: "briefcase", label: "商务", Icon: Briefcase },
  { id: "headset", label: "客服", Icon: Headset },
  { id: "sparkles", label: "智能", Icon: Sparkles },
  { id: "chart", label: "数据", Icon: ChartNoAxesCombined },
  { id: "handshake", label: "合作", Icon: Handshake },
  { id: "globe", label: "外贸", Icon: Globe },
  { id: "message", label: "沟通", Icon: MessageCircle },
];
const colors = [
  "bg-rose-50 text-rose-600",
  "bg-amber-50 text-amber-700",
  "bg-primary/5 text-primary",
  "bg-violet-50 text-violet-600",
  "bg-sky-50 text-sky-700",
  "bg-orange-50 text-orange-700",
  "bg-primary/5 text-primary",
  "bg-indigo-50 text-indigo-600",
];
function defaultAvatar(agent: Agent) {
  return defaultCharacter(agent.agentId);
}
export function AgentAvatar({
  agent,
  avatar,
  large = false,
}: {
  agent: Agent;
  avatar?: string | null;
  large?: boolean;
}) {
  const value = avatar || agent.avatar || defaultAvatar(agent);
  const character = characterFor(value);
  const isImage = !!character || value.startsWith("data:image/");
  const index = Math.max(
    0,
    choices.findIndex((c) => "icon:" + c.id === value),
  );
  const Icon = choices[index].Icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border ${large ? "h-[76px] w-16" : "h-12 w-11"} ${isImage ? "bg-white border-border/60" : colors[index]}`}
    >
      {isImage ? (
        <img
          src={character?.src || value}
          alt={`${agent.name}头像`}
          width={256}
          height={256}
          decoding="async"
          className={character ? "size-full object-contain" : "size-full object-cover"}
        />
      ) : (
        <Icon className={large ? "size-6" : "size-5"} />
      )}
    </span>
  );
}
export function AgentIdentity({
  agent,
  large = false,
  description,
  editable = false,
}: {
  agent: Agent;
  large?: boolean;
  description?: string;
  editable?: boolean;
}) {
  const [mode, setMode] = useState<"name" | "avatar" | null>(null);
  const [name, setName] = useState(agent.name);
  const [avatar, setAvatar] = useState<string | null>(
    agent.avatar || defaultAvatar(agent),
  );
  const [loading, setLoading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const update = useUpdateAgent(agent.agentId);
  function open(next: "name" | "avatar") {
    if (!editable) return;
    setName(agent.name);
    setAvatar(agent.avatar || defaultAvatar(agent));
    setMode(next);
  }
  async function imageUpload(selected: File | undefined) {
    if (!selected) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(selected.type) ||
      selected.size > 5 * 1024 * 1024
    ) {
      toast.error("请上传 5 MB 以内的 PNG、JPG 或 WebP 图片");
      return;
    }
    setLoading(true);
    const url = URL.createObjectURL(selected);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 192;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("图片无法处理");
      const side = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        192,
        192,
      );
      const data = canvas.toDataURL("image/webp", 0.85);
      if (data.length > 80000) throw new Error("图片过大");
      setAvatar(data);
    } catch {
      toast.error("无法读取图片，请换一张图片");
    } finally {
      URL.revokeObjectURL(url);
      setLoading(false);
      if (file.current) file.current.value = "";
    }
  }
  async function save() {
    if (!editable) return;
    try {
      await update.mutateAsync(
        mode === "name" ? { name: name.trim() } : { avatar },
      );
      toast.success(mode === "name" ? "名称已更新" : "头像已更新");
      setMode(null);
    } catch {
      /* Hook shows error. */
    }
  }
  return (
    <>
      <div
        className={`flex min-w-0 gap-3 ${description ? "items-start" : "items-center"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {editable ? <button
          type="button"
          className="rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={`修改${agent.name}头像`}
          title="点击修改头像"
          onClick={() => open("avatar")}
        >
          <AgentAvatar agent={agent} large={large} />
        </button> : <AgentAvatar agent={agent} large={large} />}
        <div className="min-w-0 flex-1">
        {editable ? <button
          type="button"
          className={`group flex min-w-0 items-center gap-2 text-left font-semibold hover:text-primary ${large ? "text-base" : "text-sm"}`}
          aria-label={`重命名${agent.name}`}
          title="点击修改名称"
          onClick={() => open("name")}
        >
          <span className="break-words [overflow-wrap:anywhere] max-w-[320px]">{agent.name}</span>
          <Pencil className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
        </button> : <p className={`font-semibold break-words [overflow-wrap:anywhere] ${large ? "text-base" : "text-sm"}`}>{agent.name}</p>}
        {description && <p className="mt-1.5 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{description}</p>}
        </div>
      </div>
      <Dialog
        open={editable && !!mode}
        onOpenChange={(v) => {
          if (!v && !update.isPending) setMode(null);
        }}
      >
        <DialogContent className={mode === "avatar" ? "sm:max-w-[760px]" : undefined} onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {mode === "name" ? "修改数字员工名称" : "修改数字员工头像"}
            </DialogTitle>
          </DialogHeader>
          {mode === "name" ? (
            <label className="grid gap-2 text-sm">
              数字员工名称
              <Input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    name.trim().length >= 2 &&
                    !update.isPending
                  )
                    void save();
                }}
              />
            </label>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <AgentAvatar agent={agent} avatar={avatar} large />
                
              </div>
              <CharacterLibraryPicker value={avatar} onChange={setAvatar} disabled={loading || update.isPending} />
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void imageUpload(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                disabled={loading || update.isPending}
                onClick={() => file.current?.click()}
              >
                {loading ? "正在处理图片…" : "上传头像图片"}
              </Button>
              
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={update.isPending}
              onClick={() => setMode(null)}
            >
              取消
            </Button>
            <Button
              disabled={
                update.isPending ||
                loading ||
                (mode === "name" && name.trim().length < 2)
              }
              onClick={() => void save()}
            ><Save aria-hidden="true" className="size-4" />
              {update.isPending ? "保存中…" : "保存修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
