/*
 * 中文导读：共享电子表格工具：index.js。供前后端的导入导出代码复用。
 */
import { zipSync, strToU8 } from 'fflate';

const xml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const letters = (n) => n < 26 ? String.fromCharCode(65 + n) : letters(Math.floor(n / 26) - 1) + String.fromCharCode(65 + n % 26);
const visualLength = (value) => [...String(value ?? '')].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
const phoneColumn = (header) => /电话|手机|座机|区号|分机|代码|编号|ID|_id|phone|number/i.test(header);
const longColumn = (header) => /地址|摘要|总结|备注|业务|网址|官网|录音|转写|原因|话术|说明|规则|prompt|message|内容/.test(header);
export const cleanSpreadsheetHeader = (value) => String(value ?? '').replace(/^[\s*＊]+|[\s*＊]+$/g, '');
export const isSpreadsheetExampleRow = (row) => /^【示例】/.test(String(row?.[0] ?? '').trim());
// Excel/WPS edit protection prevents accidental changes; it is not encryption.
function protectionHash() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const password = [...bytes].map(v => String.fromCharCode(33 + v % 90)).join('');
  let hash = 0;
  [...password].forEach((c, i) => { const v = c.charCodeAt(0) << (i + 1); hash ^= (v & 0x7fff) | ((v >> 15) & 0x7fff); });
  return (hash ^ password.length ^ 0xce4b).toString(16).toUpperCase().padStart(4, '0');
}
const styles = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="10.5"/><color rgb="FF25362C"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><sz val="9"/><color rgb="FFB42332"/><name val="SimSun"/></font><font><sz val="9.5"/><color rgb="FF7B8580"/><name val="Microsoft YaHei"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFA42636"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6ED"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F0E3"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F7EF"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFB8C9B4"/></left><right style="thin"><color rgb="FFB8C9B4"/></right><top style="thin"><color rgb="FFB8C9B4"/></top><bottom style="thin"><color rgb="FFB8C9B4"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>
<xf numFmtId="49" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>
<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyProtection="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/><protection locked="0"/></xf>
<xf numFmtId="49" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function sheetXml(sheet) {
  const rows = sheet.exampleRow ? [sheet.exampleRow, ...(sheet.rows ?? [])] : sheet.rows ?? [];
  const widths = sheet.widths ?? sheet.headers.map((h, i) => {
    const base = /区号|分机/.test(h) ? 12 : phoneColumn(h) ? 19 : /地址/.test(h) ? 32 : longColumn(h) ? 30 : /名称|姓名/.test(h) ? 26 : /时间|日期|邮箱/.test(h) ? 24 : 16;
    return Math.min(longColumn(h) ? 38 : 30, Math.max(base, Math.min(26, visualLength(h) + 3), ...rows.slice(0, 200).map(r => Math.min(base + 4, visualLength(r[i]) + 2))));
  });
  const note = ['notes', 'dictionary'].includes(sheet.kind);
  const all = [sheet.headers, ...rows, ...Array.from({ length: sheet.blankRows ?? 0 }, () => sheet.headers.map(() => ''))];
  const data = all.map((row, i) => {
    const height = i === 0 ? 28 : Math.min(409, Math.max(note ? 20 : 22, ...row.map((v, j) => (String(v ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(visualLength(line) / Math.max(8, ((widths[j] ?? 24) - 2) * (note ? 10.5 / 9 : 1)))), 0)) * (note ? 13 : 15) + (note ? 6 : 7))));
    const cells = row.map((v, j) => {
      const numeric = i > 0 && typeof v === 'number' && Number.isFinite(v) && !phoneColumn(sheet.headers[j] ?? '');
      const style = i === 0 ? 1 : note ? 3 : (sheet.exampleRow && i === 1) || sheet.kind === 'example' ? 7 : numeric ? (i % 2 === 0 ? 6 : 4) : i % 2 === 0 ? 2 : 0;
      const ref = `${letters(j)}${i + 1}`;
      return numeric ? `<c r="${ref}" s="${style}"><v>${v}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('');
    return `<row r="${i + 1}" ht="${height}" customHeight="1">${cells}</row>`;
  }).join('');
  const last = letters(sheet.headers.length - 1);
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1" style="${note ? 3 : 0}"/>`).join('');
  const split = sheet.freezeColumns ?? (sheet.kind === 'data' ? 1 : 0);
  const hints = new Map((sheet.columnHints ?? []).map(v => [v.column, v.text]));
  const lists = new Map((sheet.validations ?? []).map(v => [v.column, v.values]));
  const columns = [...new Set([...hints.keys(), ...lists.keys()])];
  const firstDataRow = sheet.exampleRow ? 3 : 2;
  const protection = note || sheet.exampleRow ? `<sheetProtection password="${protectionHash()}" sheet="1" objects="1" scenarios="1" formatCells="1" formatColumns="0" formatRows="0" insertRows="${note ? 1 : 0}" deleteRows="${note ? 1 : 0}" autoFilter="0" sort="0" selectLockedCells="0" selectUnlockedCells="0"/>` : '';
  const validation = columns.map(column => {
    const values = lists.get(column);
    return `<dataValidation ${values ? 'type="list" showErrorMessage="1" errorStyle="stop" errorTitle="填写值不正确" error="请从下拉列表选择" ' : ''}allowBlank="1" showInputMessage="1" promptTitle="${xml(cleanSpreadsheetHeader(sheet.headers[column]).slice(0, 32))}" prompt="${xml((hints.get(column) ?? '请选择，或留空使用默认值').slice(0, 255))}" sqref="${letters(column)}${firstDataRow}:${letters(column)}${firstDataRow + 4999}">${values ? `<formula1>${xml('"' + values.join(',') + '"')}</formula1>` : ''}</dataValidation>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${all.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="1" zoomScale="100"><pane ${split ? `xSplit="${split}" ` : ''}ySplit="${firstDataRow - 1}" topLeftCell="${letters(split)}${firstDataRow}" activePane="${split ? 'bottomRight' : 'bottomLeft'}" state="frozen"/><selection pane="${split ? 'bottomRight' : 'bottomLeft'}" activeCell="${letters(split)}${firstDataRow}" sqref="${letters(split)}${firstDataRow}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${cols}</cols><sheetData>${data}</sheetData>${protection}${sheet.kind === 'data' ? `<autoFilter ref="A1:${last}${all.length}"/>` : ''}${validation ? `<dataValidations count="${columns.length}">${validation}</dataValidations>` : ''}<printOptions gridLines="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="${sheet.headers.length > 12 ? 0 : 1}" fitToHeight="${sheet.blankRows ? 1 : 0}"/></worksheet>`;
}

export function multiSheetWorkbook(sheets) {
  const used=new Set();sheets=sheets.map(sheet=>{const base=(sheet.name.replace(/[\\/:?*\[\]]/g,' ').trim()||'数据表').slice(0,31);let name=base;let n=2;while(used.has(name)){const suffix=' ('+n+++')';name=base.slice(0,31-suffix.length)+suffix;}used.add(name);return {...sheet,name};});
  const files = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((s, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xml("'" + s.name.replace(/'/g, "''") + "'!$1:$" + (s.exampleRow ? 2 : 1))}</definedName>`).join('')}</definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    'xl/styles.xml': styles,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

export function exportWorkbook(headers, rows, name = '数据表', notes = []) {
  return multiSheetWorkbook([{ name, headers, rows, kind: 'data' }, { name: '导出说明', headers: ['说明项', '内容'], rows: [['表格阅读', '浅绿色为文件默认配色；说明采用红色宋体，正式数据采用微软雅黑。已显示网格及完整边框、冻结表头和首列。'], ['数据范围', '内容遵循此下载入口的工作区、权限和筛选范围。'], ['号码格式', '号码、区号和编号均为文本，保留前导0；请勿改成数值或科学计数格式。'], ['操作范围', '可以筛选、排序、调整列宽、添加个人备注；修改下载文件不会直接更新系统。'], ...notes], widths: [18, 64], kind: 'notes' }]);
}
