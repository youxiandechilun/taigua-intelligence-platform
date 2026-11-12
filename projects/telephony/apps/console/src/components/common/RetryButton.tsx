/*
 * 中文导读：通用组件的 RetryButton 组件，封装该界面的展示与交互。
 */
import type { ComponentProps } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/src/components/ui/button";

type RetryButtonProps = ComponentProps<typeof Button> & {
  isRetrying?: boolean;
};

export function RetryButton({
  children = "重试",
  disabled = false,
  isRetrying = false,
  type = "button",
  variant = "outline",
  ...props
}: RetryButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      disabled={disabled || isRetrying}
      aria-disabled={disabled || isRetrying}
      {...props}
    >
      {isRetrying ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw aria-hidden="true" />
      )}
      {isRetrying ? "正在重试" : children}
    </Button>
  );
}
