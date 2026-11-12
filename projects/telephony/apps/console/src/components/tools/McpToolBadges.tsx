/*
 * 中文导读：工具管理的 McpToolBadges 组件，封装该界面的展示与交互。
 */
import { Badge } from "@/src/components/ui/badge";
import type { McpToolDescriptor } from "@/src/lib/api/types";

export function McpToolBadges({ tools }: { tools: McpToolDescriptor[] | null }) {
  if (!tools?.length) return null;

  return (
    <div className="mt-3 space-y-2">
      <ul aria-label="MCP 工具权限" className="flex flex-wrap gap-1.5">
        {tools.slice(0, 8).map((tool) => (
          <li key={tool.name} className="min-w-0 max-w-full">
            <Badge variant="secondary" className="h-auto max-w-full whitespace-normal text-xs">
              <span className="min-w-0 break-all">{tool.name}</span>
              <span>· {tool.requiresConfirmation === false ? "只读" : "需要确认"}</span>
            </Badge>
          </li>
        ))}
        {tools.length > 8 && (
          <li><Badge variant="outline" className="text-xs">+{tools.length - 8} 个其他工具</Badge></li>
        )}
      </ul>
      {tools.some((tool) => tool.requiresConfirmation !== false) && (
        <p className="text-xs text-muted-foreground">
          需要确认的工具无法在智能体通话中自动执行。未标明只读属性的工具也需要确认；请刷新连接获取最新属性。
        </p>
      )}
    </div>
  );
}
