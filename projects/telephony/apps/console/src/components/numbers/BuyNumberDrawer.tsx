/*
 * 中文导读：电话号码的 BuyNumberDrawer 组件，封装该界面的展示与交互。
 */
"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MapPin, Phone, PhoneCall, Search, Plus, ChevronsUpDown , RefreshCw } from "lucide-react";
import { toast } from "@/src/lib/toast";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/src/components/ui/sheet";
import { Button } from "@/src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/src/components/ui/command";
import { ApiError } from "@/src/lib/errors";
import { Input } from "@/src/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { Skeleton } from "@/src/components/ui/skeleton";
import { EmptyState } from "@/src/components/common/EmptyState";
import { useBuyNumber, useNumberCountries, useNumberSearch } from "@/src/hooks/queries/numbers";
import type { NumberSearchParams } from "@/src/lib/api/resources/numbers";
import type { AvailableNumber } from "@/src/lib/api/types";

const schema = z.object({
  provider: z.enum(["TWILIO", "TELNYX"]),
  country: z.string().length(2, "国家代码（两个英文字母）").toUpperCase(),
  areaCode: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;
const monthlyPriceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMonthlyPrice(value: AvailableNumber["monthlyPriceMicros"]) {
  if (value === null || value === undefined) return null;
  const micros = Number(value);
  if (!Number.isFinite(micros)) return null;
  return monthlyPriceFormatter.format(micros / 1_000_000);
}

function quoteExpiryMs(value: string) {
  const expiryMs = Date.parse(value);
  return Number.isFinite(expiryMs) ? expiryMs : null;
}

function isQuoteExpired(value: string, nowMs: number) {
  const expiryMs = quoteExpiryMs(value);
  return expiryMs === null || expiryMs <= nowMs;
}

export function BuyNumberDrawer() {
  const [open, setOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [searchParams, setSearchParams] = useState<NumberSearchParams | null>(
    null,
  );
  const [buyingNumber, setBuyingNumber] = useState<string | null>(null);
  const [quoteClock, setQuoteClock] = useState(() => Date.now());

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { provider: "TWILIO", country: "US", areaCode: "" },
  });
  const watchedProvider = useWatch({ control: form.control, name: "provider" });
  const watchedCountry = useWatch({ control: form.control, name: "country" });
  const watchedAreaCode = useWatch({ control: form.control, name: "areaCode" });

  const search = useNumberSearch(searchParams, !!searchParams);
  const buy = useBuyNumber();
  const countries = useNumberCountries(watchedProvider, open);
  const selectedCountry = countries.data?.find((country) => country.code === watchedCountry);
  const providerName = watchedProvider === "TWILIO" ? "Twilio" : "Telnyx";
  const unsupportedCountry = search.error instanceof ApiError && search.error.code === "NUMBER_COUNTRY_NOT_SUPPORTED";

  useEffect(() => {
    if (!open || !search.data?.length) return;
    const nextExpiry = search.data.reduce<number | null>((next, number) => {
      const expiryMs = quoteExpiryMs(number.quoteExpiresAt);
      if (expiryMs === null || expiryMs <= quoteClock) return next;
      return next === null || expiryMs < next ? expiryMs : next;
    }, null);
    if (nextExpiry === null) return;

    const timeout = window.setTimeout(
      () => setQuoteClock(Date.now()),
      Math.max(0, nextExpiry - Date.now() + 25),
    );
    return () => window.clearTimeout(timeout);
  }, [open, quoteClock, search.data]);

  function onSubmit(values: FormValues) {
    if (!selectedCountry || countries.isError) return;
    setQuoteClock(Date.now());
    if (searchParams?.provider === values.provider && searchParams.country === values.country &&
        (searchParams.areaCode ?? "") === (values.areaCode ?? "")) {
      void search.refetch();
      return;
    }
    setSearchParams({
      provider: values.provider,
      country: values.country,
      areaCode: values.areaCode || undefined,
      limit: 12,
    });
  }

  async function onBuy(number: AvailableNumber) {
    if (!searchParams || buyingNumber) return;
    const nowMs = Date.now();
    if (isQuoteExpired(number.quoteExpiresAt, nowMs)) {
      setQuoteClock(nowMs);
      toast.error("报价已过期，请重新搜索获取最新价格。");
      return;
    }
    setBuyingNumber(number.phoneNumber);
    try {
      await buy.mutateAsync({
        provider: searchParams.provider,
        phoneNumber: number.phoneNumber,
        quoteId: number.quoteId,
      });
      setOpen(false);
      form.reset();
      setSearchParams(null);
    } catch {
      // The mutation hook displays the API error; keep the selected number for retry.
    } finally {
      setBuyingNumber(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <Plus /> 购买号码
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:w-[min(94vw,940px)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="shrink-0 border-b px-6 py-5">
          <SheetTitle>购买电话号码</SheetTitle>
          <SheetDescription>
            搜索电话服务商提供的号码，并为此工作区购买。
          </SheetDescription>
        </SheetHeader>

        <div className="shrink-0 border-b bg-muted/20 px-6 py-5">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="grid gap-4 md:grid-cols-[0.8fr_1.4fr_0.7fr_auto] md:items-start"
            >
              <FormField
                control={form.control}
                name="provider"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>服务商</FormLabel>
                    <Select value={field.value} disabled={buy.isPending} onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue("country", "");
                      form.setValue("areaCode", "");
                      setSearchParams(null);
                    }}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="TWILIO">Twilio</SelectItem>
                        <SelectItem value="TELNYX">Telnyx</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>国家/地区</FormLabel>
                    {/* Give the portaled list its own scroll lock inside the modal sheet. */}
                    <Popover modal open={countryOpen} onOpenChange={setCountryOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={countryOpen}
                            disabled={buy.isPending || countries.isPending || countries.isError}
                            className="w-full min-w-0 justify-between font-normal"
                          >
                            <span className="truncate">
                              {countries.isPending ? "正在加载国家列表…" : selectedCountry
                                ? `${selectedCountry.name} (${selectedCountry.code})` : "选择国家"}
                            </span>
                            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-0">
                        <Command>
                          <CommandInput placeholder="搜索国家或代码…" aria-label="搜索国家或代码" />
                          <CommandList>
                            <CommandEmpty className="px-3 py-5 text-left">
                              <p className="font-medium">国家/地区不可用</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                未找到支持的国家。以下服务商并非在所有国家都提供本地号码： {providerName}.
                              </p>
                            </CommandEmpty>
                            {countries.data?.map((country) => (
                              <CommandItem key={country.code} value={`${country.name} ${country.code}`}
                                data-checked={field.value === country.code}
                                onSelect={() => {
                                  field.onChange(country.code);
                                  form.setValue("areaCode", "");
                                  setSearchParams(null);
                                  setCountryOpen(false);
                                }}>
                                <span className="min-w-0 flex-1 truncate">{country.name}</span>
                                <span className="text-xs text-muted-foreground">{country.code}</span>
                              </CommandItem>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormDescription className="text-xs">
                      以下服务商提供本地号码的国家： {providerName}.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="areaCode"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>区号</FormLabel>
                    <FormControl>
                      <Input placeholder="415" {...field} disabled={buy.isPending} onChange={(event) => {
                        field.onChange(event);
                        setSearchParams(null);
                      }} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={search.isFetching || buy.isPending || !selectedCountry || countries.isError}
                className="w-full md:mt-6 lg:w-auto"
              >
                {search.isFetching ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Search />
                )}
                搜索
              </Button>
            </form>
          </Form>
          <p className="mt-3 text-xs text-muted-foreground lg:hidden">
            号码租用使用充值余额，赠送额度不能用于购买或续费。
          </p>
          {countries.isError ? (
            <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span>无法从 {providerName}。请重试。</span>
              <Button type="button" variant="outline" size="sm" disabled={countries.isFetching}
                onClick={() => void countries.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载国家列表</Button>
            </div>
          ) : countries.isSuccess && !countries.data.length ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              以下服务商目前没有提供可用的本地语音号码国家列表： {providerName}。请尝试其他服务商。
            </p>
          ) : countries.isSuccess && watchedCountry && !selectedCountry ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              以下服务商在此国家不提供本地号码： {providerName}。请选择其他国家。
            </p>
          ) : null}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden lg:block border-b bg-muted/10 px-6 py-5 lg:border-r lg:border-b-0">
            <div className="rounded-xl border bg-background p-4 shadow-sm">
              <p className="text-sm font-semibold text-foreground">
                搜索条件
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    服务商
                  </dt>
                  <dd className="mt-1 capitalize text-foreground">
                    {watchedProvider}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    国家/地区
                  </dt>
                  <dd className="mt-1 font-mono text-foreground">
                    {selectedCountry?.name || "请选择国家"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    区号
                  </dt>
                  <dd className="mt-1 font-mono text-foreground">
                    {watchedAreaCode || "Any"}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                电话号码每 30 天 2 美元起。赠送额度不能用于购买或续费，租用费用从充值余额扣除。
              </p>
            </div>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {!searchParams ? (
              <EmptyState
                icon={Phone}
                title="搜索可用号码"
                description="请选择服务商和国家，可以选填区号。"
                className="border-0"
              />
            ) : search.isFetching ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : search.isError ? (
              <EmptyState
                icon={Phone}
                title={unsupportedCountry ? "此国家暂不提供" : "搜索失败"}
                description={unsupportedCountry ? search.error.message : "服务商无法完成此次搜索，请重试。"}
                className="border-0"
              />
            ) : !search.data?.length ? (
              <EmptyState
                icon={Phone}
                title="未找到号码"
                description="暂无符合条件的本地语音号码。请尝试其他区号，或稍后搜索。"
                className="border-0"
              />
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {search.data.map((n) => {
                  const monthlyPrice = formatMonthlyPrice(n.monthlyPriceMicros);
                  const quoteExpired = isQuoteExpired(
                    n.quoteExpiresAt,
                    quoteClock,
                  );
                  return (
                    <div
                      key={n.phoneNumber}
                      className="rounded-xl border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-500/30 hover:shadow-md"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-500">
                          <PhoneCall className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-base font-semibold text-foreground">
                            {n.phoneNumber}
                          </p>
                          <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <MapPin className="size-3" />
                            {[n.locality, n.region, n.isoCountry]
                              .filter(Boolean)
                              .join(" · ") || "暂无地区信息"}
                          </p>
                          <p className="mt-2 text-sm font-semibold text-foreground">
                            {monthlyPrice ?? "购买前确认价格"}
                            {monthlyPrice ? (
                              <span className="font-normal text-muted-foreground">
                                {" "}
                                / 30 天
                              </span>
                            ) : null}
                          </p>
                          {quoteExpired ? (
                            <p
                              className="mt-1 text-xs font-medium text-destructive"
                              role="alert"
                            >
                              报价已过期，请重新搜索
                            </p>
                          ) : n.quoteExpiresAt ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              报价到期时间{" "}
                              {new Date(n.quoteExpiresAt).toLocaleTimeString(
                                [],
                                { hour: "numeric", minute: "2-digit" },
                              )}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => onBuy(n)}
                        disabled={buy.isPending || quoteExpired}
                        className="mt-4 w-full"
                      >
                        {quoteExpired ? (
                          "报价已过期，请重新搜索"
                        ) : buyingNumber === n.phoneNumber ? (
                          <>
                            <Loader2 className="animate-spin" /> 正在购买…
                          </>
                        ) : monthlyPrice ? (
                          `购买价格：${monthlyPrice}`
                        ) : (
                          "购买此号码"
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
