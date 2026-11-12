/*
 * 中文导读：数字员工与话术的 DynamicVariableInputs 组件，封装该界面的展示与交互。
 */
"use client";

import { Braces } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";

type DynamicVariableInputsProps = {
    variableNames: string[];
    values: Record<string, string>;
    placeholders?: Record<string, string>;
    title: string;
    description: string;
    disabled?: boolean;
    idPrefix?: string;
    onValuesChange: (values: Record<string, string>) => void;
};

function variableToken(name: string) {
    return `{{${name}}}`;
}

export function DynamicVariableInputs({
    variableNames,
    values,
    placeholders = {},
    title,
    description,
    disabled = false,
    idPrefix = "dynamic-variable",
    onValuesChange,
}: DynamicVariableInputsProps) {
    if (variableNames.length === 0) return null;

    return (
        <section className="border border-dashed bg-muted/20 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <Braces className="size-4 text-muted-foreground" />
                        <p className="text-sm font-medium">{title}</p>
                        <Badge variant="outline">
                            {variableNames.length} 变量
                        </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                {variableNames.map((name) => {
                    const fallback = placeholders[name]?.trim();
                    return (
                        <div key={name} className="grid gap-2">
                            <Label htmlFor={`${idPrefix}-${name}`}>{variableToken(name)}</Label>
                            <Input
                                id={`${idPrefix}-${name}`}
                                value={values[name] ?? ""}
                                placeholder={
                                    fallback
                                        ? `备用值：${fallback}`
                                        : `填写变量值：${variableToken(name)}`
                                }
                                disabled={disabled}
                                onChange={(event) =>
                                    onValuesChange({
                                        ...values,
                                        [name]: event.target.value,
                                    })
                                }
                            />
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
