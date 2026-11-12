/*
 * 中文导读：数字员工与话术的 DynamicVariablesDialog 组件，封装该界面的展示与交互。
 */
"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";

type DynamicVariablesDialogProps = {
    open: boolean;
    variableNames: string[];
    values: Record<string, string>;
    confirmLabel: string;
    isSaving?: boolean;
    onOpenChange: (open: boolean) => void;
    onValuesChange: (values: Record<string, string>) => void;
    onConfirm: () => void | Promise<void>;
};

function variableToken(name: string) {
    return `{{${name}}}`;
}

export function DynamicVariablesDialog({
    open,
    variableNames,
    values,
    confirmLabel,
    isSaving = false,
    onOpenChange,
    onValuesChange,
    onConfirm,
}: DynamicVariablesDialogProps) {
    const missingValues = variableNames.some((name) => !values[name]?.trim());

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>动态变量</DialogTitle>
                    <DialogDescription>
                        为智能体使用的变量设置备用值。
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {variableNames.map((name) => (
                        <div key={name} className="grid gap-2">
                            <Label htmlFor={`dynamic-variable-${name}`}>
                                {variableToken(name)}
                            </Label>
                            <Input
                                id={`dynamic-variable-${name}`}
                                value={values[name] ?? ""}
                                placeholder={`备用值：${variableToken(name)}`}
                                onChange={(event) =>
                                    onValuesChange({
                                        ...values,
                                        [name]: event.target.value,
                                    })
                                }
                            />
                        </div>
                    ))}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSaving}
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        onClick={onConfirm}
                        disabled={isSaving || missingValues}
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="animate-spin" /> 保存中…
                            </>
                        ) : (
                            confirmLabel
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
