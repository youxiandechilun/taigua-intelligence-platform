/*
 * 中文导读：数字员工与话术的 NewAgentDialog 组件，封装该界面的展示与交互。
 */
"use client";
import {useCompanyContext} from "@/src/lib/api/resources/company";

import { useState } from "react";
import { CharacterLibraryPicker } from "./CharacterLibraryPicker";
import { characterLibrary, characterFor } from "@/src/lib/agents/character-library";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Building2,
  Headphones,
  Bell,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Search,
  Check,
  MessageSquare, RefreshCw } from "lucide-react";
import { toast } from "@/src/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Switch } from "@/src/components/ui/switch";
import { Label } from "@/src/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { useCreateAgent } from "@/src/hooks/queries/agents";
import {
  getAgentTemplates,
  type AgentTemplate,
} from "@/src/lib/api/resources/agent-templates";
import { cn } from "@/src/lib/utils";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "数字员工名称至少需要 2 个字符")
    .max(100, "名称最多 100 个字符"),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof schema>;
const categories = [
  "全部",
  "拓客销售",
  "客户服务",
  "通知提醒",
  "通用场景",
] as const;
type Category = (typeof categories)[number];
const categoryIcons = {
  拓客销售: Building2,
  客户服务: Headphones,
  通知提醒: Bell,
  通用场景: Layers,
};

export function NewAgentDialog() {
  const [open, setOpen] = useState(false);
  const [avatar, setAvatar] = useState<string>(characterLibrary[5].value);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(
    "customer-development",
  );
  const [category, setCategory] = useState<Category>("全部");
  const [search, setSearch] = useState("");
  const router = useRouter();
  const createAgent = useCreateAgent();
  const company = useCompanyContext();
  const catalog = useQuery({
    queryKey: ["agents", "templates"],
    queryFn: getAgentTemplates,
    enabled: open,
    staleTime: 300000,
  });
  const templates = catalog.data ?? [];
  const selected = templates.find((t) => t.id === selectedTemplate);
  const keyword = search.trim().toLowerCase();
  const filtered = templates.filter(
    (t) =>
      (category === "全部" || t.category === category) &&
      `${t.title} ${t.description} ${t.fields.join(" ")}`
        .toLowerCase()
        .includes(keyword),
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", isActive: true },
  });

  function selectTemplate(template: AgentTemplate) {
    const name = form.getValues("name");
    if (!name.trim() || name === selected?.title)
      form.setValue("name", template.title, {
        shouldValidate: true,
        shouldDirty: true,
      });
    setSelectedTemplate(template.id);
  }
  async function onSubmit(values: FormValues) {
    if (!selected) return;
    try {
      const agent = await createAgent.mutateAsync({
        ...values,
        templateId: selected.id,
        avatar,
      });
      toast.success(`数字员工“${agent.name}”已创建`);
      setOpen(false);
      setSelectedTemplate("customer-development");
      setCategory("全部");
      setSearch("");
      form.reset();
      setAvatar(characterLibrary[5].value);
      setChoosingAvatar(false);
      router.push(`/agents/${agent.agentId}?tab=behavior`);
    } catch {
      /* Mutation hook displays the error; keep the user's draft. */
    }
  }

  if (!company.data?.canCreateAgents) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!createAgent.isPending) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          新建数字员工
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-4xl gap-4 sm:flex sm:h-[min(820px,calc(100dvh-2rem))] sm:flex-col sm:overflow-hidden"
        onEscapeKeyDown={(event) => {
          if (createAgent.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (createAgent.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>创建数字员工</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5 sm:flex sm:min-h-0 sm:flex-1 sm:flex-col sm:gap-4 sm:space-y-0"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>数字员工名称</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="例如：客户意向筛选助手"
                      autoFocus
                      maxLength={100}
                      disabled={createAgent.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex shrink-0 items-center gap-3 rounded-lg border p-3">
              <img src={characterFor(avatar)?.src} alt="所选人物形象" width={56} height={64} className="h-16 w-14 object-contain" />
              <div className="min-w-0 flex-1"><p className="text-sm font-medium" title="创建后可随时更换">人物形象</p></div>
              <Dialog open={choosingAvatar} onOpenChange={setChoosingAvatar}>
                <DialogTrigger asChild><Button type="button" variant="outline" disabled={createAgent.isPending}>选择人物</Button></DialogTrigger>
                <DialogContent className="sm:max-w-[760px]">
                  <DialogHeader><DialogTitle>人物形象库</DialogTitle></DialogHeader>
                  {choosingAvatar && <CharacterLibraryPicker value={avatar} onChange={value => {setAvatar(value); setChoosingAvatar(false);}} disabled={createAgent.isPending} />}
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-3 sm:flex sm:min-h-0 sm:flex-1 sm:flex-col sm:gap-3 sm:space-y-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor="template-search">
                  岗位模板{templates.length ? ` · ${templates.length} 个` : ""}
                </Label>
                <div className="relative w-full sm:w-64">
                  <Search
                    aria-hidden
                    className="absolute left-3 top-2.5 size-4 text-muted-foreground"
                  />
                  <Input
                    id="template-search"
                    className="pl-9"
                    placeholder="搜索用途、名称或采集字段"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    disabled={createAgent.isPending}
                  />
                </div>
              </div>
              <div aria-label="模板分类" className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button
                    type="button"
                    aria-pressed={category === c}
                    key={c}
                    disabled={createAgent.isPending}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "px-3 py-1.5 rounded-md border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      category === c
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-muted text-muted-foreground",
                    )}
                  >
                    {c}
                    {templates.length > 0 && (
                      <span className="ml-1.5 opacity-75">
                        {c === "全部"
                          ? templates.length
                          : templates.filter((t) => t.category === c).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {catalog.isLoading ? (
                <div
                  role="status"
                  className="flex h-64 items-center justify-center gap-2 border text-muted-foreground"
                >
                  <Loader2 className="size-4 animate-spin" />
                  加载岗位模板…
                </div>
              ) : catalog.error ? (
                <div role="alert" className="border p-5 space-y-3">
                  <p className="text-sm text-destructive">
                    {catalog.error.message}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={catalog.isFetching}
                    onClick={() => catalog.refetch()}
                  ><RefreshCw aria-hidden="true" className="size-4" />
                    重新加载模板
                  </Button>
                </div>
              ) : (
                <div className="grid min-h-0 gap-4 sm:flex-1 md:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="flex min-h-0 flex-col">
                    <div
                      role="radiogroup"
                      aria-label="选择岗位模板"
                      className="grid min-h-0 max-h-80 content-start overflow-y-auto gap-3 p-1 sm:max-h-none sm:flex-1 sm:grid-cols-2"
                    >
                      {filtered.map((template) => {
                        const Icon =
                          template.id === "blank"
                            ? Sparkles
                            : categoryIcons[template.category];
                        const isSelected = selectedTemplate === template.id;
                        return (
                          <label
                            key={template.id}
                            className={cn(
                              "relative cursor-pointer rounded-lg border p-3 transition-colors hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "bg-card",
                              createAgent.isPending &&
                                "pointer-events-none opacity-60",
                            )}
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              name="agent-template"
                              value={template.id}
                              checked={isSelected}
                              onChange={() => selectTemplate(template)}
                              disabled={createAgent.isPending}
                            />
                            <span className="mb-2 flex items-center gap-2">
                              <span
                                className={cn(
                                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                                  isSelected
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                <Icon aria-hidden className="size-4" />
                              </span>
                              <span className="text-sm font-medium pr-4">
                                {template.title}
                              </span>
                              {isSelected && (
                                <Check
                                  aria-hidden
                                  className="absolute right-3 top-4 size-4 text-primary"
                                />
                              )}
                            </span>
                            <span className="block text-xs leading-5 text-muted-foreground">
                              {template.description}
                            </span>
                          </label>
                        );
                      })}
                      {!filtered.length && (
                        <div
                          role="status"
                          className="col-span-full p-6 text-center text-sm text-muted-foreground"
                        >
                          没有符合条件的模板。
                          <Button
                            type="button"
                            variant="link"
                            onClick={() => {
                              setSearch("");
                              setCategory("全部");
                            }}
                          >
                            查看全部模板
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  <aside
                    aria-label="所选模板详情"
                    className="max-h-80 overflow-y-auto border bg-muted/20 p-4 space-y-4 rounded-lg sm:max-h-none"
                  >
                    {selected && (
                      <>
                        <div>
                          <span className="text-xs text-primary">
                            {selected.category}
                          </span>
                          <h3 className="mt-1 font-semibold">
                            {selected.title}
                          </h3>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {selected.description}
                          </p>
                        </div>
                        {selected.id === "blank" ? (null) : (
                          <>
                            <div>
                              <h4 className="mb-2 text-xs font-medium flex items-center gap-1.5">
                                <MessageSquare className="size-3.5" />
                                开场白示例
                              </h4>
                              <p className="text-xs leading-6">
                                {selected.firstMessage}
                              </p>
                            </div>
                            <div>
                              <h4 className="mb-2 text-xs font-medium">
                                自动配置的采集字段
                              </h4>
                              <div className="flex flex-wrap gap-1.5">
                                {selected.fields.map((name) => (
                                  <span
                                    key={name}
                                    className="bg-background border px-2 py-1 rounded text-xs"
                                  >
                                    {name}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <h4 className="mb-1 text-xs font-medium">
                                结果分析
                              </h4>
                              <p className="text-xs leading-5 text-muted-foreground">
                                {selected.evaluations.join("、")}
                              </p>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </aside>
                </div>
              )}
            </div>
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex shrink-0 items-center justify-between rounded-lg border px-4 py-3">
                  <div className="space-y-1">
                    <Label htmlFor="new-agent-active">
                      {field.value ? "创建后启用" : "创建后暂停"}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      启用后可用于创建外呼任务；实际拨号仍需确认启动。
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      id="new-agent-active"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={createAgent.isPending}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <div className="flex shrink-0 flex-wrap justify-between items-center gap-3 border-t pt-4">
              
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={createAgent.isPending}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={createAgent.isPending || !selected}
                >
                  {createAgent.isPending ? (
                    <>
                      <Loader2 className="animate-spin" />
                      创建中…
                    </>
                  ) : (
                    "创建数字员工"
                  )}
                </Button>
              </DialogFooter>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
