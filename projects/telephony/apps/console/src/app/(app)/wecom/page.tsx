/*
 * 中文导读：企业微信的路由页面；由 Next.js 按文件路由约定加载。
 */
import {WecomCenter} from '@/src/components/wecom/WecomCenter';
import {PageHeader} from '@/src/components/common/PageHeader';
export default function Page(){return <div className="space-y-5"><PageHeader title={<span className="flex items-center gap-3"><img src="/brand/wecom/ww-logo.svg" alt="" className="size-7"/>企业微信</span>}/><WecomCenter/></div>;}
