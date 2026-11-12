/*
 * 中文导读：数字员工与话术的 AgentOffice 组件，封装该界面的展示与交互。
 */
"use client";
import { useState } from "react";
import Link from "next/link";
import { Pause, Play, Settings2, ChevronDown } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { Button } from "@/src/components/ui/button";
import { AgentIdentity, AgentAvatar } from "./AgentIdentity";
import { AgentsTable } from "./AgentsTable";
import type { Agent } from "@/src/lib/api/types";
import styles from "./AgentOffice.module.css";
const outfits = [
  "#52786d",
  "#546e91",
  "#987456",
  "#79678e",
  "#b07778",
  "#4d7e88",
];
function seedFor(id: string) {
  let seed = 0;
  for (const c of id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return seed;
}
function Workstation({ agent, moving }: { agent: Agent; moving: boolean }) {
  const seed = seedFor(agent.agentId),
    shirt = outfits[seed % outfits.length],
    longHair = seed % 2 === 0;
  return (
    <svg
      viewBox="0 0 320 270"
      aria-hidden="true"
      className={moving ? styles.moving : undefined}
    >
      <ellipse cx="165" cy="244" rx="126" ry="18" fill="#526367" opacity=".1" />
      <path
        d="M150 203v32m0 0-27 12m27-12 29 12m-29-12v18"
        stroke="#687776"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x="115" y="115" width="76" height="93" rx="25" fill="#344c4d" />
      <rect x="124" y="120" width="58" height="62" rx="18" fill="#496568" />
      <path
        d="m134 177-11 57m40-57 20 57"
        stroke="#334951"
        strokeWidth="17"
        strokeLinecap="round"
      />
      <path
        d="M109 233h27m37 0h22"
        stroke="#263b43"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <g className={styles.person}>
        {longHair && <path d="M124 62q24-31 50 1l7 56h-65z" fill="#493d36" />}
        <path d="M116 162v-41q0-20 35-20t36 20v41z" fill={shirt} />
        <path d="M143 96v13q8 8 16 0V96" fill="#e9b18e" />
        <ellipse cx="151" cy="76" rx="24" ry="29" fill="#f0c19e" />
        <path
          d={
            longHair
              ? "M126 76q-5-38 24-38 32 0 27 42-10-7-12-29-9 18-39 25"
              : "M125 72q-5-34 27-34t24 31l-9-13q-15 9-35 3z"
          }
          fill={longHair ? "#493d36" : "#303b42"}
        />
        <path
          d="M142 78h2m16 0h2"
          stroke="#57453d"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M148 89q5 4 10-1"
          stroke="#bc7c64"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M126 76q-4-37 26-37t25 38"
          stroke="#273e48"
          strokeWidth="5"
          fill="none"
        />
        <rect x="122" y="71" width="8" height="19" rx="4" fill="#273e48" />
        <rect x="172" y="71" width="8" height="19" rx="4" fill="#273e48" />
        <path
          d="m176 86-8 11-11 0"
          stroke="#273e48"
          strokeWidth="3"
          fill="none"
        />
        <path
          d="m121 126-16 26 32 15"
          stroke={shirt}
          strokeWidth="16"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="m137 167 17 3"
          stroke="#f0c19e"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <g className={styles.callArm}>
          <path
            d="m179 128 20-19-18-24"
            stroke={shirt}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="m181 85-4-8"
            stroke="#f0c19e"
            strokeWidth="11"
            strokeLinecap="round"
          />
          <rect
            x="178"
            y="64"
            width="10"
            height="26"
            rx="3"
            fill="#32484e"
            transform="rotate(-12 183 77)"
          />
        </g>
      </g>
      <path d="m39 175 176-19 70 36-177 27z" fill="#dcc0a0" />
      <path d="m39 175 69 35 177-18v11l-177 28-69-36z" fill="#bc9672" />
      <path
        d="M50 195v48m59-15v29m162-51v40"
        stroke="#5d7271"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path d="m172 125 63-8v49l-63 9z" fill="#344b53" />
      <path d="m177 131 53-7v36l-53 8z" fill="#c1dfdf" />
      <path
        d="m182 139 37-5m-37 12 29-4m-29 11 33-4"
        stroke="#75a4a9"
        strokeWidth="3"
      />
      <path d="m202 171 0 10-20 4 38-4-11-4v-7" fill="#5b727a" />
      <path d="m133 187 39-5 20 9-40 5z" fill="#f3f5f1" stroke="#a9b9b6" />
      <path d="m225 186 10-2 6 3-10 2z" fill="#f3f5f1" />
      <path d="M67 161h18l-2 21H70z" fill="#f6f5ef" />
      <path
        d="M85 165q11-2 5 11h-6"
        stroke="#f6f5ef"
        strokeWidth="3"
        fill="none"
      />
    </svg>
  );
}
export function AgentOffice({ agents }: { agents: Agent[] }) {
  const { data: workspace } = authClient.useActiveOrganization();
  const [demo, setDemo] = useState(true),
    [management, setManagement] = useState(false);
  return (
    <>
      <div className={styles.layout}>
        <section className={styles.office} aria-label="智能体办公室">
          <div className={styles.wall}>
            <div className={styles.window} aria-hidden="true">
              <div className={styles.skyline} />
              <span />
              <span />
              <span />
            </div>
            <div className={styles.companySign}>
              <span className={styles.signMark} aria-hidden="true">
                ✦
              </span>
              <h2>{workspace?.name || "正在加载工作区…"}</h2>
              <p>智能体办公区</p>
            </div>
            <div className={styles.wallPlant} aria-hidden="true">
              <i />
              <i />
              <i />
              <span />
            </div>
          </div>
          <div className={styles.officeToolbar}>
            <p>点击人物，编辑智能体</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDemo(!demo)}
              aria-pressed={demo}
            >
              {demo ? (
                <Pause className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              {demo ? "暂停人物演示" : "播放人物演示"}
            </Button>
          </div>
          <div className={styles.floor}>
            <div className={styles.stations}>
              {agents.map((agent, index) => (
                <article className={styles.station} key={agent.agentId}>
                  <div className={styles.seatNumber}>
                    工位 {String(index + 1).padStart(2, "0")}
                  </div>
                  <Link
                    className={styles.characterLink}
                    href={`/agents/${agent.agentId}?tab=behavior`}
                    aria-label={`编辑${agent.name}`}
                  >
                    <Workstation
                      agent={agent}
                      moving={demo && agent.isActive}
                    />
                    <span className={styles.editHint}>
                      <Settings2 className="size-3.5" />
                      编辑智能体
                    </span>
                  </Link>
                  <div className={styles.identity}>
                    <AgentIdentity agent={agent} />
                  </div>
                  <p className={styles.status}>
                    <span
                      className={
                        agent.isActive ? styles.enabled : styles.paused
                      }
                    />
                    {agent.isActive ? "本系统已启用" : "本系统已暂停"}
                  </p>
                  <p className={styles.metrics}>
                    累计通话 {agent.callLogsCount} 次
                    <span>启用知识 {agent.knowledgeSourcesCount} 条</span>
                  </p>
                </article>
              ))}
              {agents.length === 0 && (
                <div className={styles.emptyOffice}>
                  办公室还没有智能体，请点击右上角“新建智能体”安排第一个工位。
                </div>
              )}
              {agents.length < 3 && (
                <div className={styles.lounge} aria-hidden="true">
                  <svg viewBox="0 0 300 270">
                    <ellipse
                      cx="154"
                      cy="221"
                      rx="115"
                      ry="25"
                      fill="#d8e3dc"
                    />
                    <rect
                      x="54"
                      y="124"
                      width="165"
                      height="60"
                      rx="15"
                      fill="#98b5a5"
                    />
                    <rect
                      x="46"
                      y="151"
                      width="181"
                      height="54"
                      rx="13"
                      fill="#adc6b7"
                    />
                    <rect
                      x="47"
                      y="149"
                      width="23"
                      height="45"
                      rx="8"
                      fill="#84a894"
                    />
                    <rect
                      x="204"
                      y="149"
                      width="23"
                      height="45"
                      rx="8"
                      fill="#84a894"
                    />
                    <path
                      d="M66 204v14m141-14v14"
                      stroke="#6a8078"
                      strokeWidth="5"
                    />
                    <rect
                      x="84"
                      y="145"
                      width="32"
                      height="24"
                      rx="5"
                      fill="#d9e4d8"
                      transform="rotate(-12 100 157)"
                    />
                    <path
                      d="M113 208v25m67-25v25"
                      stroke="#7f8f85"
                      strokeWidth="5"
                    />
                    <ellipse cx="147" cy="205" rx="48" ry="14" fill="#cab597" />
                    <path d="M146 173h10l-1 21h-8z" fill="#e7ece4" />
                    <path
                      d="M151 175v-14m0 6-9-6m9 2 8-9"
                      stroke="#73967c"
                      strokeWidth="3"
                    />
                    <path
                      d="M248 99v107m-16 4h33"
                      stroke="#8b9c93"
                      strokeWidth="4"
                    />
                    <path d="m227 102 10-38h23l10 38z" fill="#e4cfab" />
                  </svg>
                  <p>共享洽谈区</p>
                </div>
              )}
            </div>
          </div>
          <div className={styles.footnote}>
            人物为动作演示，实际通话请查看通话记录。
          </div>
        </section>
        <aside className={styles.roster} aria-label="智能体快捷列表">
          <header>
            <h3>智能体列表</h3>
            <span>{agents.length} 位</span>
          </header>
          <div className={styles.rosterItems}>
            {agents.map((agent) => (
              <Link
                key={agent.agentId}
                href={`/agents/${agent.agentId}?tab=behavior`}
                className={styles.rosterItem}
              >
                <AgentAvatar agent={agent} />
                <div>
                  <p>{agent.name}</p>
                  <small>
                    {agent.isActive ? "本系统已启用" : "已暂停"} ·{" "}
                    {agent.isConfigured ? "已保存草稿" : "待配置"}
                  </small>
                </div>
              </Link>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setManagement(!management)}
            aria-expanded={management}
            className="w-full"
          >
            <ChevronDown className="size-3.5" />
            {management ? "收起列表管理" : "展开列表管理"}
          </Button>
        </aside>
      </div>
      {management && (
        <section aria-label="智能体列表管理">
          <AgentsTable agents={agents} isLoading={false} />
        </section>
      )}
    </>
  );
}
