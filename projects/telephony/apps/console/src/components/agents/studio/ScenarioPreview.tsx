/*
 * 中文导读：数字员工与话术的 ScenarioPreview 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { ConversationPlaybook } from "@/src/lib/api/resources/playbook";
import { Button } from "@/src/components/ui/button";
import { previewBranch } from "./flow-model";
import { responseLabel, scenarioOutcomes, type ScenarioItem } from "./scenario-model";
import styles from "./scenario-editor.module.css";

export function ScenarioPreview({ playbook, item }: { playbook: ConversationPlaybook; item: ScenarioItem }) {
  const graph = playbook.canvas!;
  const [path, setPath] = useState<Array<{ id: string; response?: string }>>([{ id: item.id }]);
  const [error, setError] = useState("");
  const current = graph.nodes.find(n => n.id === path.at(-1)?.id);
  const edges = graph.edges.filter(e => e.source === current?.id);
  const reset = (id: string) => { setPath([{ id }]); setError(""); };

  if (item.source !== "step") return <div className={styles.preview} aria-label="场景对话预览">
    <p className={styles.help}>预览当前场景的客户提问与参考回答。</p>
    <div className={styles.customerBubble}><small>客户</small><p>{item.title || "尚未填写客户回应"}</p></div>
    <div className={styles.employeeBubble}><small>参考回答</small><p>{item.text || "尚未填写回答"}</p></div>
    <p className={styles.help}>回答后继续原来的沟通步骤；若客户明确拒绝，按结束规则处理。</p>
  </div>;

  return <div className={styles.preview} aria-label="场景对话预览">
    <div className={styles.previewHeading}><p className={styles.help}>选择客户回应，预览已配置的话术走向。</p><Button variant="ghost" size="icon-sm" aria-label="重新预览当前场景" onClick={() => reset(item.id)}><RotateCcw className="size-3.5" /></Button></div>
    {item.id !== graph.entry && <button type="button" className={styles.textButton} onClick={() => reset(graph.entry)}>从开场白开始预览 <ArrowRight size={13} /></button>}
    {path.map((step, index) => {
      const node = graph.nodes.find(n => n.id === step.id);
      if (!node) return <p key={index} role="alert" className={styles.error}>这个场景已被移除，请重新选择。</p>;
      const ending = ["end", "handoff"].includes(node.kind);
      return <div key={index} className={styles.previewStep}>
        {step.response && <div className={styles.customerBubble}><small>客户回应</small><p>{responseLabel(step.response)}</p></div>}
        <div className={styles.employeeBubble}><small>{node.id === graph.entry ? "开场白" : ending ? "结束话术" : node.kind === "jump" ? "自动进入下一步" : "沟通内容 / 表达要求"}<span>{node.title}</span></small><p>{node.text || (node.kind === "jump" ? "此步骤不播报，直接进入下一步。" : "尚未填写")}</p>{ending && <div className={styles.previewResult}>{scenarioOutcomes[node.outcome]}</div>}</div>
      </div>;
    })}
    {error && <p role="status" className={styles.error}>{error}</p>}
    {current && !["end", "handoff"].includes(current.kind) && <div className={styles.previewChoices}><p className={styles.caption}>客户如何回应？</p>{edges.length ? edges.map(edge => <button type="button" key={edge.id} title={edge.condition || undefined} onClick={() => {
      if (path.length >= 30) { setError("已预览 30 个步骤，可重新开始查看其他走向。"); return; }
      const next = previewBranch(graph, current.id, edge.branch);
      if (next.error) { setError(next.error.replaceAll("节点", "场景").replaceAll("连线", "分支")); return; }
      setError(""); setPath(p => [...p, { id: next.nodeId, response: edge.branch }]);
    }}>{responseLabel(edge.branch)}<ArrowRight size={13} /></button>) : <p className={styles.help}>此场景尚未设置下一步，可回到“编辑内容”补充。</p>}</div>}
    {current && ["end", "handoff"].includes(current.kind) && <div className={styles.previewEnd}>本次走向已结束<Button variant="ghost" size="sm" onClick={() => reset(graph.entry)}><RotateCcw className="size-3.5" />重新开始</Button></div>}
  </div>;
}
