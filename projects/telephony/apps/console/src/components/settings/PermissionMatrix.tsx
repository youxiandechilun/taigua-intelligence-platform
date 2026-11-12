/*
 * 中文导读：设置中心的 PermissionMatrix 组件，封装该界面的展示与交互。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import { Checkbox } from "@/src/components/ui/checkbox";
import { cn } from "@/src/lib/utils";
import { RESOURCES, type Permissions, type ResourceId } from "@/src/lib/permissions";

export function PermissionMatrix({
 value,
 onChange,
 disabled,
}: {
 value: Permissions;
 onChange: (next: Permissions) => void;
 disabled?: boolean;
}) {
 function toggle(resource: ResourceId, action: string, checked: boolean) {
 const current = new Set(value[resource] ?? []);
 if (checked) current.add(action);
 else current.delete(action);
 const nextActions = Array.from(current);
 const next: Permissions = { ...value };
 if (nextActions.length === 0) delete next[resource];
 else next[resource] = nextActions;
 onChange(next);
 }

 return (
 <div className="overflow-x-auto border">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b bg-muted/30">
 <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
 资源
 </th>
 {["create", "read", "update", "delete"].map((a) => (
 <th
 key={uiLabel(a)}
 className="w-20 px-2 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
 >
 {uiLabel(a)}
 </th>
 ))}
 </tr>
 </thead>
 <tbody>
 {RESOURCES.map((r) => (
 <tr key={r.id} className="border-b last:border-b-0">
 <td className="px-4 py-3 font-medium">{r.label}</td>
 {["create", "read", "update", "delete"].map((a) => {
 const supported = (r.actions as readonly string[]).includes(a);
 const checked = !!value[r.id]?.includes(a);
 return (
 <td
 key={uiLabel(a)}
 className={cn(
 "px-2 py-3 text-center",
 !supported && "bg-muted/20"
 )}
 >
 {supported ? (
 <Checkbox
 checked={checked}
 onCheckedChange={(v) => toggle(r.id, a, v === true)}
 disabled={disabled}
 aria-label={`允许${r.label} ${uiLabel(a)}`}
 />
 ) : (
 <span className="text-muted-foreground/50">—</span>
 )}
 </td>
 );
 })}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 );
}
