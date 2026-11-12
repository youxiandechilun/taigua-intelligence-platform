/*
 * 中文导读：应用外壳与导航的 Breadcrumbs 组件，封装该界面的展示与交互。
 */
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, Suspense } from "react";
import {useCompanyContext} from "@/src/lib/api/resources/company";
import { useAgent } from "@/src/hooks/queries/agents";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/src/components/ui/breadcrumb";

// Agent details follow the same personal or company scope as the editor.
const SEGMENT_LABELS: Record<string, string> = {
  wecom: "企业微信",
  crm: "客户库",
  companies: "意向客户",
  contacts: "联系人",
  leads: "线索池",
  tasks: "跟进任务",
  trash: "客户回收站",
  tools: "业务工具",
  automation: "自动化",
  editor: "流程编辑器",
  aliyun: "阿里云线路",
  telephony: "线路管理",
  connection: "好客呼接入",
  rules: "通话规则",
  regions: "省份线路",
  seats: "员工接听",
  departments: "组织架构",
  announcements: "公告管理",
  appearance: "界面外观",
  credentials: "集成凭据",
  models: "大模型配置",
  voices: "声音库",
  recognition: "识别与拦截",
  dashboard: "仪表盘",
  agents: "数字员工",
  "recording-learning": "录音学习",
  numbers: "线路管理",
  outbound: "外呼",
  calls: "通话记录",
  kb: "知识库",
  settings: "设置中心",
  profile: "个人资料",
  organization: "公司设置",
  accounts: "平台管理",
  platform: "公共登录页",
  members: "组织与人员",
  billing: "用量与费用",
  secrets: "集成凭据",
  "api-keys": "系统 API 密钥",
  roles: "角色权限",
  danger: "危险区域",
  orgs: "工作区",
  new: "新建",
  create: "创建",
};

function labelForSegment(seg: string) {
  return SEGMENT_LABELS[seg] ?? seg;
}

export function Breadcrumbs() {
  return <Suspense fallback={null}><BreadcrumbTrail /></Suspense>;
}

function BreadcrumbTrail() {
  const pathname = usePathname();
  const params = useSearchParams();
  const company=useCompanyContext();
  const segments = pathname.split("/").filter(Boolean);
  const agentId =
    segments[0] === "agents" && segments[1] && !SEGMENT_LABELS[segments[1]]
      ? segments[1]
      : "";
  const { data: agent } = useAgent(agentId);
  const agentName = params.get("scope") === "company"
    ? agent?.name
    : agent?.personal?.name || agent?.name;

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const isLast = i === segments.length - 1;
    const label =
      agentId && i === 1
        ? agentName?.trim() || "数字员工详情"
        : segments[0] === "calls" && i === 1
        ? "通话详情"
        : pathname.startsWith("/crm/companies/") && i === 2
        ? "客户详情"
        : href === "/settings/tools"
          ? "工具与服务连接"
          : (i===0?company.data?.navigation?.items.find(item=>item.id===seg)?.label:undefined)||labelForSegment(seg);
    return { href, label, isLast };
  });

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((c, i) => (
          <Fragment key={c.href}>
            <BreadcrumbItem className={i === 0 ? "hidden shrink-0 md:block" : "min-w-0"}>
              {c.isLast ? (
                <BreadcrumbPage className="max-w-[40vw] truncate md:max-w-sm" title={c.label}>
                  {c.label}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={c.href} className="truncate" title={c.label}>
                    {c.label}
                  </Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {!c.isLast ? (
              <BreadcrumbSeparator
                className={i === 0 ? "hidden md:block" : ""}
              />
            ) : null}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
