/*
 * 中文导读：外呼任务的 CSVPreview 组件，封装该界面的展示与交互。
 */
"use client";

import { isSpreadsheetExampleRow } from '@repo/spreadsheets';
import { normalizeSpreadsheetHeader } from "@/src/lib/import-excel";
import { readTableRows } from "@/src/lib/browser-compute/import-recipients";
import { userMessage } from "@/src/lib/locale";

import { FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Eye, Table } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";

interface CSVPreviewProps {
  file: File | null;
  maxRows?: number;
  autoPreview?: boolean;
}

interface ParsedCSV {
  headers: string[];
  rows: string[][];
  totalRows: number;
  errors: string[];
  warnings: string[];
}

function previewRows(rows: string[][], maxRows: number): ParsedCSV {
  const errors: string[] = [], warnings: string[] = [];
  const nonEmptyRows = rows.filter((entry) => entry.some((value) => value.length > 0) && !isSpreadsheetExampleRow(entry));

  if (nonEmptyRows.length === 0) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      errors: ["文件似乎为空"],
      warnings: [],
    };
  }

  const headers = nonEmptyRows[0]!.map((h) => normalizeSpreadsheetHeader(h));
  
  // Validate required columns
  if (!headers.includes("phone_number")) {
    errors.push("缺少必需列：联系电话");
  }
  
  // Check for potential issues
  const displayRows = nonEmptyRows.slice(1, 1 + maxRows);
  
  // Check for missing phone numbers
  const phoneIndex = headers.indexOf("phone_number");
  if (phoneIndex >= 0) {
    let missingPhones = 0;
    displayRows.forEach((row) => {
      if (!row[phoneIndex]?.trim()) missingPhones += 1;
    });
    if (missingPhones > 0) {
      warnings.push(`${missingPhones}行缺少电话号码`);
    }
  }
  
  return {
    headers,
    rows: displayRows,
    totalRows: nonEmptyRows.length - 1, // Exclude header row
    errors,
    warnings,
  };
}

export function CSVPreview({
  file,
  maxRows = 10,
  autoPreview = true,
}: CSVPreviewProps) {
  const requestRef = useRef(0);
  useEffect(() => () => { requestRef.current++; }, []);
  const [parsed, setParsed] = useState<ParsedCSV | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(autoPreview);

  const handleParseFile = useCallback(async () => {
    const request = ++requestRef.current;
    if (!file) {
      setParsed(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = previewRows(await readTableRows(file), maxRows);
      if (request !== requestRef.current) return;
      setParsed(result);
      setShowPreview(true);
    } catch (err) {
      if (request !== requestRef.current) return;
      setError(err instanceof Error ? userMessage(err.message) : "解析文件失败");
      setParsed(null);
    } finally {
      if (request === requestRef.current) setIsLoading(false);
    }
  }, [file, maxRows]);

  // Auto-parse when file changes
  useEffect(() => {
    if (autoPreview && file) {
      handleParseFile();
    } else if (!file) {
      requestRef.current++;
      setIsLoading(false);
      setParsed(null);
      setError(null);
      setShowPreview(false);
    }
  }, [file, autoPreview, handleParseFile]);

  if (!file) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4 flex items-center justify-center gap-3">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">正在解析表格…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="size-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">解析错误</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleParseFile}
        >
          <Eye className="size-4" />
          预览
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Table className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">CSV 预览</p>
            <p className="text-xs text-muted-foreground">
              {parsed.totalRows} 行数据 • 当前显示 {Math.min(parsed.rows.length, maxRows)} 行
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? "收起" : "展开"}
        </Button>
      </div>

      {parsed.errors.length > 0 && (
        <div className="p-3 border-b bg-destructive/5">
          {parsed.errors.map((err, index) => (
            <div key={index} className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {err}
            </div>
          ))}
        </div>
      )}

      {parsed.warnings.length > 0 && (
        <div className="p-3 border-b bg-amber-50">
          {parsed.warnings.map((warning, index) => (
            <div key={index} className="flex items-center gap-2 text-sm text-amber-700">
              <AlertCircle className="size-4 shrink-0" />
              {warning}
            </div>
          ))}
        </div>
      )}

      {showPreview && parsed.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  #
                </th>
                {parsed.headers.map((header, index) => (
                  <th
                    key={index}
                    className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {header}
                    {header === "phone_number" && (
                      <Badge variant="outline" className="ml-1.5 text-xs">
                        必填
                      </Badge>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {parsed.rows.slice(0, maxRows).map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-muted/30">
                  <td className="px-3 py-2 text-muted-foreground">
                    {rowIndex + 2}
                  </td>
                  {parsed.headers.map((_, colIndex) => (
                    <td key={colIndex} className="px-3 py-2 max-w-[200px] truncate">
                      {row[colIndex] || (
                        <span className="text-muted-foreground italic">为空</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPreview && parsed.rows.length === 0 && (
        <div className="p-8 text-center">
          <FileSpreadsheet className="size-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            此文件中未找到数据行
          </p>
        </div>
      )}

      {parsed.errors.length === 0 && parsed.warnings.length === 0 && (
        <div className="p-3 border-t bg-emerald-50 flex items-center gap-2">
          <CheckCircle2 className="size-4 text-emerald-600" />
          <span className="text-sm text-emerald-700">
            文件检查通过，可以用于外呼任务。
          </span>
        </div>
      )}
    </div>
  );
}
