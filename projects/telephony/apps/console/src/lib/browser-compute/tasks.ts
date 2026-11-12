/*
 * 中文导读：共享基础能力：tasks.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { unzipSync } from 'fflate';
import { cleanSpreadsheetHeader, isSpreadsheetExampleRow } from '@repo/spreadsheets';
import { normalizeRecipientPhone, parseRecipientText } from '@/src/lib/outbound/recipient-input';
import type { FlowGraph, FlowNode } from '@/src/lib/api/resources/playbook';
import type { Recipient } from '@/src/lib/api/resources/aliyun';
import {routeEdges,type RouteInput} from './route-edges';

export function normalizeHeader(value: string) {
  const key = cleanSpreadsheetHeader(value).toLowerCase().replace(/\s+/g, '_');
  return ({联系电话:'phone_number',电话号码:'phone_number',电话:'phone_number',手机号码:'phone_number',手机号:'phone_number',公司名称:'company_name',企业名称:'company_name',客户名称:'name',回答语言:'language',音色编号:'voice_id',开场白:'first_message',专属提示:'prompt',所在地区:'region',地区:'region',座机区号:'area_code',地址:'address',公司地址:'address',经营业务:'business'} as Record<string,string>)[key] ?? key;
}

export function csvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('表格引号不完整，请检查 CSV 文件。');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(values => values.some(value => value.trim()));
}

export type ImportedRecipients = { recipients: Recipient[]; invalidRows: {rowNumber: number; phoneNumber: string; error: string}[]; duplicates: number };
function recipientsFromRows(rows: string[][]): ImportedRecipients {
  const headers = (rows[0] ?? []).map(normalizeHeader);
  if (!headers.includes('phone_number')) throw new Error('客户名单必须包含联系电话列。');
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error('表格列名需要由系统核对。');
  const data = rows.slice(1).map((row,index) => ({row,rowNumber:index+2})).filter(({row}) => !isSpreadsheetExampleRow(row) && row.some(value => value?.trim()));
  if (data.length > 2000) throw new Error('每个任务最多导入 2000 行，请拆分表格。');
  const recipients: Recipient[] = [], invalidRows: ImportedRecipients['invalidRows'] = [], seen = new Set<string>();
  const special = new Set(['phone_number','language','voice_id','first_message','prompt','system_prompt']);
  let duplicates = 0;
  for (const {row,rowNumber} of data) {
    const raw = Object.fromEntries(headers.filter(Boolean).map(key => [key, String(row[headers.indexOf(key)] ?? '').trim()]));
    const phoneNumber = normalizeRecipientPhone(raw.phone_number ?? '');
    // Existing server rules resolve regional landline prefixes and ambiguous formats.
    if (!/^1[3-9]\d{9}$/.test(phoneNumber) && !/^0\d{9,11}$/.test(phoneNumber)) throw new Error('需要核对座机区号或号码格式。');
    const name = raw.company_name || raw.name || '';
    const variables = Object.fromEntries(Object.entries(raw).filter(([key,value]) => value && !special.has(key)));
    if (name.length > 200 || Object.keys(variables).length > 10 || Object.entries(variables).some(([key,value]) => key.length > 100 || value.length > 1000)) throw new Error('客户字段需要由系统核对。');
    if (seen.has(phoneNumber)) { duplicates++; continue; }
    seen.add(phoneNumber); recipients.push({phoneNumber,name,variables});
  }
  return {recipients,invalidRows,duplicates};
}

type LayoutPosition = { id: string; x: number; y: number; ports: FlowNode["ports"] };

function layout(graph: FlowGraph): LayoutPosition[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, typeof graph.edges>();
  const incoming = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  // The “肯定”/“全部” chain is the conversation spine. Exception branches
  // are deliberately placed beside it, instead of changing the spine's order.
  const primary = (nodeId: string) => {
    const edges = outgoing.get(nodeId) ?? [];
    return (
      edges.find((edge) => edge.branch === "肯定") ??
      edges.find((edge) => edge.branch === "全部") ??
      edges.find((edge) => !["拒绝", "否定", "未识别", "人工跟进"].includes(edge.branch))
    );
  };
  const mainIds: string[] = [];
  const mainSet = new Set<string>();
  let cursor = graph.entry;
  while (byId.has(cursor) && !mainSet.has(cursor)) {
    mainIds.push(cursor);
    mainSet.add(cursor);
    const next = primary(cursor)?.target;
    if (!next || !byId.has(next)) break;
    cursor = next;
  }
  const mainDepth = new Map(mainIds.map((id, index) => [id, index]));
  const top = 80;
  const mainX = 360;
  const rowGap = 340;
  const positions = new Map<string, { x: number; y: number }>();
  mainIds.forEach((id, index) => positions.set(id, { x: mainX, y: top + index * rowGap }));

  // Put branches in two calm side lanes. The target is kept close to the
  // source level so a branch curves outward once and returns to the flow.
  const sideNodes = graph.nodes
    .filter((node) => !mainSet.has(node.id))
    .sort((a, b) => {
      const depth = (id: string) =>
        Math.min(...(incoming.get(id) ?? []).map((edge) => mainDepth.get(edge.source) ?? 0), 0);
      return depth(a.id) - depth(b.id) || a.title.localeCompare(b.title);
    });
  const occupied: Array<{ x: number; y: number }> = [];
  sideNodes.forEach((node, index) => {
    const anchors = (incoming.get(node.id) ?? [])
      .map((edge) => mainDepth.get(edge.source))
      .filter((value): value is number => value !== undefined);
    const depth = anchors.length ? Math.round(anchors.reduce((sum, value) => sum + value, 0) / anchors.length) : 0;
    const column = index % 2;
    const x = mainX + 620 + column * 500;
    let y = top + depth * rowGap + (column ? 120 : -80);
    while (occupied.some((point) => Math.abs(point.x - x) < 380 && Math.abs(point.y - y) < 250)) y += 270;
    occupied.push({ x, y });
    positions.set(node.id, { x, y: Math.max(40, y) });
  });

  // Disconnected nodes still get a predictable home below the flow.
  graph.nodes
    .filter((node) => !positions.has(node.id))
    .forEach((node, index) => positions.set(node.id, {
      x: mainX + 620 + (index % 2) * 500,
      y: top + mainIds.length * rowGap + Math.floor(index / 2) * 270,
    }));

  const sideFor = (from: { x: number; y: number }, to: { x: number; y: number }): "top" | "right" | "bottom" | "left" => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.1) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "bottom" : "top";
  };
  const oppositeSide = (side: ReturnType<typeof sideFor>): ReturnType<typeof sideFor> =>
    side === "top" ? "bottom" : side === "right" ? "left" : side === "bottom" ? "top" : "right";
  const ports = new Map<string, FlowNode["ports"]>();
  const inputGroups = new Map<string, Array<{ edge: (typeof graph.edges)[number]; side: ReturnType<typeof sideFor> }>>();
  for (const edge of graph.edges) {
    const source = positions.get(edge.source)!;
    const target = positions.get(edge.target)!;
    // A connection leaves the source on `side`, but it must enter the target
    // from the opposite side. Reusing the source side put vertical inputs on
    // the target's bottom edge, forcing the route through the card itself.
    const side = oppositeSide(sideFor(source, target));
    const group = inputGroups.get(edge.target);
    if (group) group.push({ edge, side });
    else inputGroups.set(edge.target, [{ edge, side }]);
  }
  for (const node of graph.nodes) {
    const source = positions.get(node.id)!;
    const inputEdges = inputGroups.get(node.id) ?? [];
    const inputSide = inputEdges[0]?.side ?? "top";
    const inputOffset = inputEdges.length > 1 ? 0.5 : 0.5;
    const outputEntries = (outgoing.get(node.id) ?? []).map((edge) => ({
      edge,
      side: sideFor(source, positions.get(edge.target)!),
    }));
    const outputs: NonNullable<FlowNode["ports"]>["outputs"] = {};
    const bySide = new Map<string, typeof outputEntries>();
    for (const entry of outputEntries) {
      const group = bySide.get(entry.side);
      if (group) group.push(entry);
      else bySide.set(entry.side, [entry]);
    }
    for (const [side, group] of bySide) {
      group.forEach((entry, index) => {
        outputs[entry.edge.branch] = {
          side: side as "top" | "right" | "bottom" | "left",
          offset: (index + 1) / (group.length + 1),
        };
      });
    }
    ports.set(node.id, {
      input: { side: inputSide, offset: inputOffset },
      outputs,
    });
  }
  return graph.nodes.map((node) => ({
    id: node.id,
    x: Math.max(-10000, Math.min(10000, positions.get(node.id)?.x ?? mainX)),
    y: Math.max(-10000, Math.min(10000, positions.get(node.id)?.y ?? top)),
    ports: ports.get(node.id),
  }));
}

function encodeWav({pcm,normalize}: {pcm:Float32Array;normalize:boolean}) {
  let gain = 1;
  if (normalize) {
    let sum=0,peak=0;
    for (const value of pcm) { sum+=value*value;peak=Math.max(peak,Math.abs(value)); }
    const rms=Math.sqrt(sum/pcm.length);
    // Do not amplify near-silence or use aggressive gain on noisy recordings.
    if (rms>=0.008&&peak>0) gain=Math.min(2,0.08/rms,0.95/peak);
  }
  const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
  const text = (offset:number,value:string) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  text(0,'RIFF'); view.setUint32(4,buffer.byteLength-8,true); text(8,'WAVEfmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,pcm.length*2,true);
  for (let i=0;i<pcm.length;i++) { const value=Math.max(-1,Math.min(1,pcm[i]!*gain)); view.setInt16(44+i*2,value<0?value*32768:value*32767,true); }
  return buffer;
}

export type TaskInputs = { probe: null; csv: string; numbers: string; recipients: string[][]; unzip: ArrayBuffer; wav: {pcm:Float32Array;normalize:boolean}; layout: FlowGraph; routes:RouteInput };
export type TaskResults = { probe: number; csv: string[][]; numbers: ReturnType<typeof parseRecipientText>; recipients: ImportedRecipients; unzip: Record<string,Uint8Array>; wav: ArrayBuffer; layout: ReturnType<typeof layout>; routes:ReturnType<typeof routeEdges> };
export function executeTask<K extends keyof TaskInputs>(kind: K, input: TaskInputs[K]): TaskResults[K] {
  let result: unknown;
  switch (kind) {
    case 'probe': { const start=performance.now();let value=0;for(let i=0;i<150000;i++) value=(value+Math.sqrt(i))%997; result=performance.now()-start + value*0; break; }
    case 'csv': result=csvRows(input as string); break;
    case 'numbers': result=parseRecipientText(input as string); break;
    case 'recipients': result=recipientsFromRows(input as string[][]); break;
    case 'layout': result=layout(input as FlowGraph); break;
    case 'routes': result=routeEdges(input as RouteInput); break;
    case 'wav': result=encodeWav(input as TaskInputs['wav']); break;
    case 'unzip': {
      let size=0;
      result=unzipSync(new Uint8Array(input as ArrayBuffer),{filter:file => {size+=file.originalSize;if(size>20*1024*1024)throw new Error('Excel 解压大小超出限制。');return /^xl\//.test(file.name);}}); break;
    }
    default: throw new Error('不支持的本机任务。');
  }
  return result as TaskResults[K];
}
