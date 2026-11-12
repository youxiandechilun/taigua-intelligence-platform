/*
 * 中文导读：共享电子表格工具：index.d.ts。供前后端的导入导出代码复用。
 */
export type Sheet = {
  name: string;
  headers: string[];
  rows?: unknown[][];
  widths?: number[];
  kind?: 'data' | 'notes' | 'dictionary' | 'example';
  blankRows?: number;
  freezeColumns?: number;
  validations?: { column: number; values: string[] }[];
  columnHints?: { column: number; text: string }[];
  exampleRow?: unknown[];
};
export function cleanSpreadsheetHeader(value: unknown): string;
export function isSpreadsheetExampleRow(row: unknown[]): boolean;
export function multiSheetWorkbook(sheets: Sheet[]): Uint8Array;
export function exportWorkbook(headers: string[], rows: unknown[][], name?: string, notes?: unknown[][]): Uint8Array;
