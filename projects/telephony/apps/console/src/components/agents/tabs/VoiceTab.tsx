/*
 * 中文导读：数字员工与话术的 VoiceTab 组件，封装该界面的展示与交互。
 */
"use client";

import { languageLabel } from "@/src/lib/locale";

import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { VoiceProfilePanel } from "@/src/components/agents/VoiceProfilePanel";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/src/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/src/components/ui/select";
import {
    useAgentConfig,
    useSaveAgentConfig,
    useVoiceCatalog,
} from "@/src/hooks/queries/agents";
import {
    COMMON_TIMEZONES,
    buildVoiceOptionsFromCatalog,
    getSttModelsForLanguage,
    getTtsModelsForLanguage,
    getVoicesForTtsModel,
    LANGUAGES,
    LLM_MODELS,
    normalizeLanguageCode,
    type LanguageAwareModelOption,
    type ModelOption,
    type Voice,
} from "@/src/lib/data/voices";
import { mergeConfig } from "@/src/lib/agents/config-defaults";

const schema = z.object({
    voiceId: z.string().min(1),
    agent_language: z.string().min(2),
    llmModel: z.string().min(2),
    sttModel: z.string().min(1),
    ttsModel: z.string().min(1),
    timezone: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

type UnknownModelKind = "STT" | "LLM" | "TTS";

function trimProviderPrefix(value: string) {
    return value.includes("/") ? value.split("/").at(-1) ?? value : value;
}

function humanizeModelId(value: string) {
    return trimProviderPrefix(value)
        .replace(/[:_.-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatEstimatedMicros(value: number | string) {
    const micros = Number(value);
    if (!Number.isFinite(micros)) return null;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    }).format(micros / 1_000_000);
}

function findModelOption<T extends ModelOption>(options: T[], value?: string) {
    if (!value) return undefined;
    return options.find(
        (option) =>
            option.id === value ||
            trimProviderPrefix(option.id) === value ||
            option.id.endsWith(`/${value}`)
    );
}

function ensureSelectedModelOption<T extends ModelOption>(
    options: T[],
    value: string | undefined,
    kind: UnknownModelKind
): T[] {
    if (!value || options.some((option) => option.id === value)) return options;

    const matched = findModelOption(options, value);
    const fallback = {
        ...(matched ?? {
            label: `已配置${kind}: ${humanizeModelId(value)}`,
            provider: "已配置",
        }),
        id: value,
    } as T;

    return [fallback, ...options];
}

function ensureSelectedLanguageModelOption(
    options: LanguageAwareModelOption[],
    value: string | undefined,
    kind: Exclude<UnknownModelKind, "LLM">
) {
    if (!value || options.some((option) => option.id === value)) return options;

    const matched = findModelOption(options, value);
    const fallback: LanguageAwareModelOption = {
        ...(matched ?? {
            label: `已配置${kind}: ${humanizeModelId(value)}`,
            provider: "已配置",
            languages: [],
        }),
        id: value,
        languages: matched?.languages ?? [],
    };

    return [fallback, ...options];
}

function ensureSelectedVoiceOption(options: Voice[], value: string | undefined) {
    if (!value || options.some((voice) => voice.id === value)) return options;

    const fallback: Voice = {
        id: value,
        name: `已配置声音：${humanizeModelId(value)}`,
        provider: "已配置",
        gender: "neutral",
        locale: "",
        accent: "",
        languages: [],
        ttsModels: [],
        styles: ["已保存的配置"],
        useCases: [],
    };

    return [fallback, ...options];
}

export function VoiceTab({ agentId }: { agentId: string }) {
    const { data: config, isLoading } = useAgentConfig(agentId);
    const { data: voiceCatalog } = useVoiceCatalog();
    const save = useSaveAgentConfig(agentId);
    const voiceOptions = useMemo(
        () => (voiceCatalog ? buildVoiceOptionsFromCatalog(voiceCatalog) : null),
        [voiceCatalog]
    );
    const languages = voiceOptions?.languages ?? LANGUAGES;
    const timezones = voiceOptions?.timezones ?? COMMON_TIMEZONES;
    const llmModels = voiceOptions?.llmModels ?? LLM_MODELS;

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            voiceId: "aura-2-asteria-en",
            agent_language: "en",
            llmModel: "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
            sttModel: "deepgram/nova-3",
            ttsModel: "deepgram/aura-2",
            timezone: "UTC",
        },
    });

    useEffect(() => {
        if (!config) return;
        form.reset({
            voiceId: config.voiceId,
            agent_language: normalizeLanguageCode(config.agent_language),
            llmModel: config.llmModel,
            sttModel: config.sttModel ?? "deepgram/nova-3",
            ttsModel: config.ttsModel ?? "deepgram/aura-2",
            timezone: config.timezone,
        });
    }, [config, form]);

    const selectedLanguage = useWatch({
        control: form.control,
        name: "agent_language",
    });
    const selectedSttModel = useWatch({
        control: form.control,
        name: "sttModel",
    });
    const selectedLlmModel = useWatch({
        control: form.control,
        name: "llmModel",
    });
    const selectedTtsModel = useWatch({
        control: form.control,
        name: "ttsModel",
    });
    const selectedVoiceId = useWatch({
        control: form.control,
        name: "voiceId",
    });

    const availableSttModels = useMemo(
        () => getSttModelsForLanguage(selectedLanguage, voiceOptions ?? undefined),
        [selectedLanguage, voiceOptions]
    );
    const availableTtsModels = useMemo(
        () => getTtsModelsForLanguage(selectedLanguage, voiceOptions ?? undefined),
        [selectedLanguage, voiceOptions]
    );
    const availableVoices = useMemo(
        () => getVoicesForTtsModel(selectedTtsModel, selectedLanguage, voiceOptions ?? undefined),
        [selectedLanguage, selectedTtsModel, voiceOptions]
    );
    const sttModelsWithConfiguredValue = useMemo(
        () => ensureSelectedLanguageModelOption(availableSttModels, selectedSttModel, "STT"),
        [availableSttModels, selectedSttModel]
    );
    const llmModelsWithConfiguredValue = useMemo(
        () => ensureSelectedModelOption(llmModels, selectedLlmModel, "LLM"),
        [llmModels, selectedLlmModel]
    );
    const ttsModelsWithConfiguredValue = useMemo(
        () => ensureSelectedLanguageModelOption(availableTtsModels, selectedTtsModel, "TTS"),
        [availableTtsModels, selectedTtsModel]
    );
    const voicesWithConfiguredValue = useMemo(
        () => ensureSelectedVoiceOption(availableVoices, selectedVoiceId),
        [availableVoices, selectedVoiceId]
    );
    const selectedVoice = useMemo(
        () => voicesWithConfiguredValue.find((voice) => voice.id === selectedVoiceId),
        [selectedVoiceId, voicesWithConfiguredValue]
    );
    const selectedLanguageLabel =
        languages.find((language) => language.code === selectedLanguage)?.label ?? selectedLanguage;
    const selectedTtsModelLabel =
        ttsModelsWithConfiguredValue.find((model) => model.id === selectedTtsModel)?.label ?? selectedTtsModel;
    const estimatedModelPrice =
        config?.estimatedPricePerMinuteMicros === null ||
        config?.estimatedPricePerMinuteMicros === undefined
            ? null
            : formatEstimatedMicros(config.estimatedPricePerMinuteMicros);
    const estimateMatchesSelection = Boolean(
        config &&
        config.sttModel === selectedSttModel &&
        config.llmModel === selectedLlmModel &&
        config.ttsModel === selectedTtsModel
    );

    async function onSubmit(values: FormValues) {
      try {
          await save.mutateAsync(mergeConfig(config, values));
      } catch {
        // The mutation hook displays the API error; preserve the current state for retry.
      }
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <section className="border bg-card p-6">
                    <div className="mb-5">
                        <h2 className="text-base font-semibold" title="先选择客户语言，再选择语音模型">地区与语言</h2>
                    </div>
                    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="agent_language"
                            render={({ field }) => (
                                <FormItem className="min-w-0">
                                    <FormLabel>语言</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {languages.map((language) => (
                                                <SelectItem key={language.code} value={language.code}>
                                                    {languageLabel(language.code)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="timezone"
                            render={({ field }) => (
                                <FormItem className="min-w-0">
                                    <FormLabel>时区</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {timezones.map((timezone) => (
                                                <SelectItem key={timezone} value={timezone}>
                                                    {timezone === "UTC" ? "世界标准时间（UTC）" : timezone === "Asia/Shanghai" ? "北京时间（Asia/Shanghai）" : timezone}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </section>

                <section className="border bg-card p-6">
                    <div className="mb-5">
                        <h2 className="text-base font-semibold" title="为所选语言配置语音识别和对话模型">对话模型</h2>
                    </div>
                    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="sttModel"
                            render={({ field }) => (
                                <FormItem className="min-w-0">
                                    <FormLabel>语音识别（STT）</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {sttModelsWithConfiguredValue.map((model) => (
                                                <SelectItem key={model.id} value={model.id}>
                                                    {model.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="llmModel"
                            render={({ field }) => (
                                <FormItem className="min-w-0">
                                    <FormLabel>对话模型（LLM）</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {llmModelsWithConfiguredValue.map((model) => (
                                                <SelectItem key={model.id} value={model.id}>
                                                    {model.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    {estimatedModelPrice ? (
                        <div className="mt-5 border bg-muted/20 p-4">
                            {estimateMatchesSelection ? (
                                <p className="text-sm font-medium">
                                    预计 AI 与平台费用： {estimatedModelPrice} / 接通分钟
                                </p>
                            ) : (
                                <p className="text-sm font-medium">
                                    保存模型选择后，费用估算会更新。
                                </p>
                            )}
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                估算包含语音识别、语音合成、对话模型用量，以及 泰卦电销智能体 每接通分钟 0.01 美元的平台费用。通信费用按服务商价格加上加价另计，实际金额以用量为准。
                            </p>
                        </div>
                    ) : null}
                </section>

                <section className="border bg-card p-6">
                    <div className="mb-5">
                        <h2 className="text-base font-semibold" title="选择语音合成模型和兼容的声音">语音输出</h2>
                    </div>
                    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="ttsModel"
                            render={({ field }) => (
                                <FormItem className="min-w-0">
                                    <FormLabel>语音合成（TTS）</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {ttsModelsWithConfiguredValue.map((model) => (
                                                <SelectItem key={model.id} value={model.id}>
                                                    {model.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="voiceId"
                            render={({ field }) => (
                                <FormItem className="min-w-0">
                                    <FormLabel>声音</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue placeholder="选择声音" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {voicesWithConfiguredValue.map((voice) => (
                                                <SelectItem key={voice.id} value={voice.id}>
                                                    {voice.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    <div className="mt-5">
                        <VoiceProfilePanel
                            voice={selectedVoice}
                            languageLabel={selectedLanguageLabel}
                            ttsModelLabel={selectedTtsModelLabel}
                        />
                    </div>
                </section>

                <div className="flex items-center justify-end gap-3">
                    <Button
                        type="submit"
                        disabled={save.isPending || isLoading || !form.formState.isDirty}
                    >
                        {save.isPending ? (
                            <>
                                <Loader2 className="animate-spin" /> 保存中…
                            </>
                        ) : (
                            <>
                                <Save /> 保存修改
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
