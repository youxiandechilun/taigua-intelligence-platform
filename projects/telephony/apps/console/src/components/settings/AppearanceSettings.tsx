/*
 * 中文导读：设置中心的 AppearanceSettings 组件，封装该界面的展示与交互。
 */
"use client";
import { useTheme } from "next-themes";
import { Check, Moon, Sun, Monitor } from "lucide-react";
import {useState} from 'react';
import {Button} from '@/src/components/ui/button';
import {useBrowserCompute} from '@/src/hooks/use-browser-compute';
import {browserComputeProfile,type ComputeProfile} from '@/src/lib/browser-compute/runtime';

const options = [
  { value: "light", label: "亮色", description: "明亮清晰的日间界面", icon: Sun },
  { value: "dark", label: "暗色", description: "适合夜间使用的深色界面", icon: Moon },
  { value: "system", label: "跟随系统", description: "随设备的外观自动切换", icon: Monitor },
];

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const detected=useBrowserCompute();
  const [checked,setChecked]=useState<ComputeProfile|null>(null),[checking,setChecking]=useState(false);
  const compute=checked??detected;
  async function recheck(){setChecking(true);try{setChecked(await browserComputeProfile(true));}finally{setChecking(false);}}
  return <div className="space-y-5"><section className="rounded-xl border bg-card p-5">
    <h2 className="text-sm font-semibold">界面外观</h2>
    <p className="mt-1 text-xs text-muted-foreground">只调整当前浏览器的显示方式。</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {options.map(option => <button key={option.value} type="button" aria-pressed={theme === option.value} onClick={() => setTheme(option.value)} className={"flex items-start gap-3 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (theme === option.value ? "border-primary/40 bg-primary/5" : "hover:border-primary/30")}>
        <option.icon className="mt-0.5 size-5 text-primary" />
        <span className="flex-1"><span className="block text-sm font-medium">{option.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span>
        {theme === option.value && <Check className="size-4 text-primary" />}
      </button>)}
    </div>
  </section>
    <section aria-label="本机性能" className="rounded-xl border bg-card p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">本机性能</h2>
        <Button type="button" size="sm" variant="outline" disabled={!compute||checking} onClick={()=>void recheck()}>{checking?'检测中…':'重新检测'}</Button>
      </header>
      <dl className="mt-4 divide-y text-sm">
        <div className="flex justify-between gap-4 py-3"><dt className="text-muted-foreground">处理方式</dt><dd role="status">{!compute?'检测中…':compute.lowPower?'自动适配 · 轻量模式':'自动适配 · 本机优先'}</dd></div>
        <div className="flex justify-between gap-4 py-3"><dt className="text-muted-foreground">后台计算</dt><dd>{!compute?'—':compute.workers?'已就绪':'兼容处理'}</dd></div>
        <div className="flex justify-between gap-4 py-3"><dt className="text-muted-foreground">录音预处理</dt><dd>{!compute?'—':compute.audio?'可用':'请升级浏览器'}</dd></div>
      </dl>
    </section>
  </div>;
}
