/*
 * 中文导读：数字员工与话术的 EmployeeCallingAccess 组件，封装该界面的展示与交互。
 */
"use client";

import { Users } from "lucide-react";
import type { DialPolicy } from "@/src/lib/api/resources/aliyun";
import { DEFAULT_POLICY, DialPolicyEditor } from "../aliyun/CloudSettingsControls";
import { Button } from "../ui/button";
import { NativeSelect } from "../ui/native-select";
import styles from "./employee-settings.module.css";

export function EmployeeCallingAccess({ value, onChange, disabled, scopeLabel, onScope, scopeDisabled = false }: {
  value: DialPolicy | null; onChange: (policy: DialPolicy | null) => void; disabled: boolean;
  scopeLabel?: string; onScope?: () => void; scopeDisabled?: boolean;
}) {
  return <section className={styles.access} aria-label="拨打与使用权限">
    <div className={styles.ruleMode}>
      <h3>拨打规则</h3>
      <NativeSelect aria-label="拨打规则方式" disabled={disabled} value={value ? "custom" : "inherit"} className="h-8 text-xs" onChange={e => {
        onChange(e.target.value === "inherit" ? null : { ...DEFAULT_POLICY, days: [...DEFAULT_POLICY.days] });
      }}><option value="inherit">沿用任务所选线路</option><option value="custom">为此员工单独设置</option></NativeSelect>
    </div>
    <p className="mb-4 text-xs leading-6 text-muted-foreground">支持全部已授权线路，新建外呼任务时选择具体线路。{value ? "当前拨打规则将用于此员工的新任务。" : "拨打时间与重拨规则随任务所选线路生效。"}</p>
    {value && <DialPolicyEditor compact disabled={disabled} scope="agent" product="sip" value={value} onChange={onChange} />}
    {onScope && <div className={styles.scope}>
      <div><h3><Users aria-hidden="true"/>员工使用范围</h3><p>{scopeLabel || "尚未设置"}</p></div>
      <Button variant="outline" size="sm" disabled={scopeDisabled} onClick={onScope}>设置使用范围</Button>
    </div>}
  </section>;
}
