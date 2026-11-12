/*
 * 中文导读：知识库的 EditKbDialog 组件，封装该界面的展示与交互。
 */
"use client";

import { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";

import { KnowledgeSourceStatus } from "@/src/components/kb/kb-utils";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { useUpdateKb } from "@/src/hooks/queries/kb";
import type { Agent, KnowledgeSource } from "@/src/lib/api/types";

function formatDate(value: string | null) {
  if (!value) return "尚未建立索引";
  return new Date(value).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-medium">{value}</p>
    </div>
  );
}

type EditKbDialogProps = {
  source: KnowledgeSource | null;
  agents: Agent[];
  onOpenChange: (open: boolean) => void;
};

type EditKbDialogContentProps = Omit<EditKbDialogProps, "source"> & {
  source: KnowledgeSource;
};

export function EditKbDialog({
  source,
  agents,
  onOpenChange,
}: EditKbDialogProps) {
  if (!source) {
    return null;
  }

  return (
    <EditKbDialogContent
      key={source.kbId}
      source={source}
      agents={agents}
      onOpenChange={onOpenChange}
    />
  );
}

function EditKbDialogContent({
  source,
  agents,
  onOpenChange,
}: EditKbDialogContentProps) {
  const [name, setName] = useState(source.name);
  const [agentId, setAgentId] = useState(source.agentId ?? "");
  const [url, setUrl] = useState(
    source.sourceType === "URL" ? source.storagePath : ""
  );
  const update = useUpdateKb();

  const metadata = useMemo(() => {
    if (!source.metadata || Object.keys(source.metadata).length === 0) {
      return "此条目暂无附加信息。";
    }
    return JSON.stringify(source.metadata, null, 2);
  }, [source]);

  const isProcessing = source.status === "PROCESSING";
  const canSave =
    !isProcessing &&
    !update.isPending &&
    name.trim().length > 0 &&
    agentId.length > 0 &&
    (source.sourceType !== "URL" || url.trim().length > 0);

  async function handleSave() {
    if (!canSave) return;

    const input: { name?: string; agentId?: string; url?: string } = {};
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (trimmedName !== source.name) input.name = trimmedName;
    if (agentId !== source.agentId) input.agentId = agentId;
    if (source.sourceType === "URL" && trimmedUrl !== source.storagePath) {
      input.url = trimmedUrl;
    }

    if (Object.keys(input).length === 0) {
      onOpenChange(false);
      return;
    }

    try {
      await update.mutateAsync({ kbId: source.kbId, input });
      onOpenChange(false);
    } catch {
      // The mutation displays the API error and keeps the dialog open so the
      // user can correct the fields without losing their changes.
    }
  }

  return (
    <Dialog open={!!source} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>知识库资料详情</DialogTitle>
          <DialogDescription>
            查看已保存的数据并编辑支持的字段。保存后，资料将重新加入处理队列。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3" aria-labelledby="kb-status-heading">
            <h3 id="kb-status-heading" className="text-sm font-semibold">
              处理状态
            </h3>
            <div className="border p-3">
              <KnowledgeSourceStatus source={source} />
            </div>
            {isProcessing ? (
              <p className="text-xs leading-5 text-muted-foreground">
                请等待处理完成后，再编辑此条目。
              </p>
            ) : null}
          </section>

          <section className="space-y-4" aria-labelledby="kb-edit-heading">
            <div>
              <h3 id="kb-edit-heading" className="text-sm font-semibold">
                可编辑设置
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                无法在这里修改文件类型和已上传文件的内容。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kb-entry-name">显示名称</Label>
              <Input
                id="kb-entry-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isProcessing || update.isPending}
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kb-entry-agent">已分配智能体</Label>
              <Select
                value={agentId}
                onValueChange={setAgentId}
                disabled={isProcessing || update.isPending}
              >
                <SelectTrigger id="kb-entry-agent">
                  <SelectValue placeholder="选择智能体" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.agentId} value={agent.agentId}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {source.sourceType === "URL" ? (
              <div className="space-y-1.5">
                <Label htmlFor="kb-entry-url">来源 URL</Label>
                <Input
                  id="kb-entry-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  disabled={isProcessing || update.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  网址必须通过 HTTP 或 HTTPS 公开访问。
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3" aria-labelledby="kb-stored-heading">
            <h3 id="kb-stored-heading" className="text-sm font-semibold">
              已保存的信息
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="知识库资料编号" value={source.kbId} />
              <Detail label="资料类型" value={source.sourceType} />
              <Detail
                label={source.sourceType === "URL" ? "已保存网址" : "原始文件"}
                value={
                  source.sourceType === "URL"
                    ? source.storagePath
                    : source.originalFileName ?? "未记录"
                }
              />
              <Detail label="上传时间" value={formatDate(source.uploadedAt)} />
              <Detail label="最近索引时间" value={formatDate(source.lastIndexedAt)} />
              {source.sourceType !== "URL" ? (
                <Detail label="存储引用" value={source.storagePath} />
              ) : null}
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="kb-metadata-heading">
            <h3 id="kb-metadata-heading" className="text-sm font-semibold">
              通话信息
            </h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border bg-muted/20 p-3 font-mono text-xs leading-5 text-muted-foreground">
              {metadata}
            </pre>
          </section>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            关闭
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {update.isPending ? (
              <>
                <Loader2 className="animate-spin" /> 正在保存…
              </>
            ) : (
              <>
                <Save /> 保存修改
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
