/*
 * 中文导读：凭据管理的 SecretSelect 组件，封装该界面的展示与交互。
 */
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { useSecrets } from "@/src/hooks/queries/secrets";

export function SecretSelect({
  value,
  onValueChange,
  disabled,
  placeholder = "选择密钥",
}: {
  value?: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { data: secrets = [], isLoading } = useSecrets();

  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled || isLoading || secrets.length === 0}
    >
      <SelectTrigger className="h-9">
        <SelectValue
          placeholder={
            isLoading
              ? "正在加载密钥…"
              : secrets.length === 0
                ? "尚未保存密钥"
                : placeholder
          }
        />
      </SelectTrigger>
      <SelectContent>
        {secrets.map((secret) => (
          <SelectItem key={secret.secretId} value={secret.reference}>
            {secret.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
