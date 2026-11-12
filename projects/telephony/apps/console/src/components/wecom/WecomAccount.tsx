/*
 * 中文导读：企业微信的 WecomAccount 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { wecomApi, type WecomStatus } from '@/src/lib/api/resources/wecom';

export type LoginResult = { kind: 'loading' | 'success' | 'error'; message: string } | null;

export function WecomAccount({ org, status, result }: {
  org: string; status?: WecomStatus; result: LoginResult;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const bound = !!status?.myWecomUserId;
  const pending = starting || result?.kind === 'loading';

  async function start() {
    setStarting(true);
    setError('');
    try {
      const { url } = await wecomApi.startLogin(org);
      const target = new URL(url);
      if (target.origin !== 'https://login.work.weixin.qq.com' || target.pathname !== '/wwlogin/sso/login') {
        throw new Error('扫码地址暂不可用，请重新打开此页面。');
      }
      window.location.assign(target.toString());
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫码入口暂不可用，请稍后重试。');
      setStarting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <img src="/brand/wecom/ww-logo.svg" alt="企业微信" className="mt-0.5 size-9 shrink-0" />
          <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">我的企业微信</h2></div>
          <span className={'shrink-0 rounded-md px-2 py-1 text-xs '+(bound?'bg-primary/5 text-primary':'bg-muted text-muted-foreground')}>{bound?'已绑定':'未绑定'}</span>
        </div>
        <div className="my-5 border-t" />
        {bound ? <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary"/><div><p className="text-sm font-medium">企微身份已绑定</p></div></div> : <>
          <h3 className="text-sm font-medium">扫码登录并绑定</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">用手机企业微信扫码，确认身份后返回当前页面。</p>
          <div className="mt-4"><button type="button" aria-label="扫码登录企业微信" disabled={!status?.loginReady || pending} onClick={() => void start()} className="relative block h-10 w-[200px] overflow-hidden rounded-sm outline-offset-4 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-55">
            <img src="/brand/wecom/login-blue-middle.png" alt="企业微信登录" width={200} height={40}/>
            {pending ? <span className="absolute inset-0 flex items-center justify-center gap-2 bg-card text-sm"><Loader2 className="size-4 animate-spin"/>正在确认身份…</span>:null}
          </button></div>
          
        </>}
        {result ? <p role="status" className={'mt-4 text-sm leading-6 '+(result.kind==='error'?'text-destructive':result.kind==='success'?'text-primary':'text-muted-foreground')}>{result.message}</p>:null}
        {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>:null}
        
      </section>

    </div>
  );
}
