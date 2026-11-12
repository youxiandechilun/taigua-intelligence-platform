/*
 * 中文导读：数字员工与话术的 ScriptOverview 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { ArrowRight, CircleHelp, Copy, Download, Flag, List, MessageCircle, PencilLine, Settings2 } from "lucide-react";
import type { ConversationPlaybook } from "@/src/lib/api/resources/playbook";
import { Button } from "@/src/components/ui/button";
import { download, handoffText } from "../employee-editor-model";
import { responseLabel, scenarioItems, scenarioOutcomes, type ScenarioGroup } from "./scenario-model";
import styles from "./script-overview.module.css";

const sections = [
  { id: "steps", label: "通话顺序", description: "按主要沟通顺序阅读，实际下一步由客户回应决定。", Icon: List },
  { id: "faq", label: "常见问题", description: "客户随时可能问到的问题，以及对应的参考回答。", Icon: CircleHelp },
  { id: "objections", label: "异议应对", description: "针对客户的顾虑和拒绝，选择适合的回应。", Icon: MessageCircle },
  { id: "endings", label: "结束处理", description: "不同结束方式的参考话术及通话结果。", Icon: Flag },
  { id: "rules", label: "全局规则", description: "适用于整通电话的业务身份、目标和表达要求。", Icon: Settings2 },
] as const;

export function ScriptOverview({ playbook: p, onLocate, onGlobals, onCopy, onExport }: {
  playbook: ConversationPlaybook; onLocate: (id: string) => void; onGlobals: () => void; onCopy: () => void; onExport: () => void;
}) {
  const [section, setSection] = useState<ScenarioGroup | "rules">("steps");
  const all = scenarioItems(p), current = sections.find(s => s.id === section)!;
  const items = all.filter(item => item.group === section);
  const graph = p.canvas, nodes = new Map(graph?.nodes.map(n => [n.id, n]));
  return <section className={styles.overview} aria-label="话术文字总览">
    <nav className={styles.directory} aria-label="文字总览分类">
      <span className={styles.directoryTitle}>阅读目录</span>
      {sections.map(({ id, label, Icon }) => <button type="button" key={id} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon size={15} /><span>{label}</span>{id !== "rules" && <small>{all.filter(item => item.group === id).length}</small>}</button>)}
    </nav>
    <div className={styles.document}>
      <header className={styles.heading}><div><h2>{current.label}</h2><p>{current.description}</p></div><div className={styles.actions}><Button size="sm" variant="ghost" onClick={onCopy}><Copy className="size-3.5" />复制全文</Button><Button size="sm" variant="ghost" onClick={onExport}><Download className="size-3.5" />导出</Button></div></header>
      {section === "rules" ? <div className={styles.rules}>
        <div className={styles.ruleHeading}><h3>身份与目标</h3><Button size="sm" variant="outline" onClick={onGlobals}><PencilLine className="size-3.5" />编辑全局规则</Button></div>
        <dl><div><dt>业务身份</dt><dd>{p.identity || "尚未填写"}</dd></div><div><dt>通话目标</dt><dd>{p.purpose || "尚未填写"}</dd></div><div><dt>补充要求</dt><dd>{p.baseInstructions || "尚未添加补充要求"}</dd></div><div><dt>人工接管</dt><dd>{handoffText(p)}</dd></div></dl>
        {p.legacyScript && <details className={styles.backup}><summary>原文字稿备份</summary><p>当前话术以场景内容和全局规则为准。</p><pre>{p.legacyScript.opening}{"\n\n"}{p.legacyScript.flow.map(n => n.title + "\n" + n.instruction).join("\n\n")}</pre><Button size="sm" variant="outline" onClick={() => download("原文字稿备份.txt", p.legacyScript!.opening + "\n\n" + p.legacyScript!.flow.map(n => n.title + "\n" + n.instruction).join("\n\n"))}><Download className="size-3.5" />导出原稿</Button></details>}
      </div> : <div className={styles.entries}>
        {items.map(item => {
          const node = item.source === "step" ? nodes.get(item.id) : undefined;
          const edges = graph?.edges.filter(e => e.source === item.id) || [];
          return <article key={item.key} className={styles.entry}>
            <div className={styles.entryHeading}>{section === "steps" && <span className={styles.number}>{String(item.order).padStart(2, "0")}</span>}<h3>{item.title || "未命名场景"}</h3>{item.entry && <span className={styles.badge}>从这里开始</span>}{section === "endings" && node && <span className={styles.badge}>{scenarioOutcomes[node.outcome]}</span>}<Button size="xs" variant="ghost" onClick={() => onLocate(item.key)} aria-label={`编辑场景：${item.title}`}><PencilLine className="size-3" />编辑</Button></div>
            <p className={styles.content}>{item.text || (node?.kind === "jump" ? "直接进入下一步" : "尚未填写内容")}</p>
            {node?.field && <p className={styles.field}>记录信息：{node.field}</p>}
            {!!edges.length && <div className={styles.branches}>{edges.map(edge => <div key={edge.id}><span>{responseLabel(edge.branch)}</span><ArrowRight size={12} /><button type="button" onClick={() => onLocate(edge.target)} disabled={!nodes.has(edge.target)}>{nodes.get(edge.target)?.title || "目标已移除"}</button>{edge.condition && <small>{edge.condition}</small>}</div>)}</div>}
          </article>;
        })}
        {!items.length && <p className={styles.empty}>此分类尚未添加内容，可在“场景卡片”中新建。</p>}
      </div>}
    </div>
  </section>;
}
