/*
 * 中文导读：设置中心的 IntegrationCredentials 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { AddSecretDialog } from "@/src/components/secrets/AddSecretDialog";
import { SecretsTable } from "@/src/components/secrets/SecretsTable";

export function IntegrationCredentials() {
  const [createOpen, setCreateOpen] = useState(false);

  const addButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
      添加集成凭据
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">集成凭据</h2>{addButton}</div>

      <SecretsTable onCreate={() => setCreateOpen(true)} />
      <AddSecretDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
