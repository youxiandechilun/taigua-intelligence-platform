/*
 * 中文导读：知识库：knowledge-files.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { BadRequestError } from '../../common/errors/badRequest.js';

const run = promisify(execFile);
export function checkedKnowledgeText(text: string) {
  const content = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!content || content.length > 60000) throw new BadRequestError('资料需有有效正文，且不超过6万字。');
  if (/[\u0000\uFFFD]/.test(content)) throw new BadRequestError('文件编码或内容无法读取，请另存为 UTF-8 文本后上传。');
  return content;
}
export async function extractKnowledgeFile(name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new BadRequestError('文件最大8MB。');
  const ext = name.toLowerCase().split('.').pop();
  if (['txt','md','csv'].includes(ext || '')) return checkedKnowledgeText(bytes.toString('utf8'));
  if (ext === 'pdf') {
    if (bytes.subarray(0,5).toString() !== '%PDF-') throw new BadRequestError('PDF 文件格式不正确。');
    const folder = await mkdtemp(join(tmpdir(), 'taigua-kb-'));
    try {
      const file = join(folder, 'source.pdf'); await writeFile(file, bytes, { mode: 0o600 });
      const { stdout } = await run('pdftotext', ['-enc','UTF-8','-layout',file,'-'], { timeout: 20000, maxBuffer: 1024*1024 });
      if (!stdout.trim()) throw new BadRequestError('此 PDF 没有可读取文字，请先进行文字识别或上传文字版。');
      return checkedKnowledgeText(stdout);
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
      if (e && typeof e === 'object' && (e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new BadRequestError('服务器的 PDF 解析组件尚未安装，请联系管理员修复后重试，或先上传 Word、TXT 文字版。');
      throw new BadRequestError('PDF 无法读取，请检查文件是否加密，或上传文字版。');
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  if (!['docx','xlsx'].includes(ext||'')) throw new BadRequestError('支持 PDF、Word DOCX、Excel XLSX、TXT、Markdown 和 CSV。');
  let unpacked = 0;
  let xml: string;
  try {
    const files = unzipSync(bytes, { filter: f => {
      unpacked += f.originalSize;
      if (unpacked > 20*1024*1024) throw new Error('large archive');
      return ext==='xlsx'?/^xl\/(?:worksheets\/[^/]+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml.rels)$/.test(f.name):f.name === 'word/document.xml';
    } });
    if(ext==='xlsx') {
      const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
      const parse=(value:Uint8Array)=>{const text=strFromU8(value);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('xml declaration');return parser.parse(text);};
      const list=(v:unknown):any[]=>v===undefined?[]:Array.isArray(v)?v:[v];
      const string=(v:any):string=>typeof v==='string'?v:typeof v==='number'?String(v):v&&typeof v==='object'?string(v['#text']??v.t??''):'';
      const shared=list(files['xl/sharedStrings.xml']?parse(files['xl/sharedStrings.xml']).sst?.si:[]).map(si=>si.t!==undefined?string(si.t):list(si.r).map(r=>string(r.t)).join(''));
      const rows:string[]=[];
      const relationships=list(files['xl/_rels/workbook.xml.rels']?parse(files['xl/_rels/workbook.xml.rels']).Relationships?.Relationship:[]);
      const sheets=list(files['xl/workbook.xml']?parse(files['xl/workbook.xml']).workbook?.sheets?.sheet:[]);
      const selected=sheets.filter(sheet=>!['填写说明','导入说明','使用说明','示例','数据字典'].includes(String(sheet['@_name']||''))).map(sheet=>{
        const relation=relationships.find(r=>r['@_Id']===sheet['@_r:id']);
        const target=String(relation?.['@_Target']||'');
        const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
        return /^xl\/worksheets\/[^/]+\.xml$/.test(path)&&files[path]?{name:String(sheet['@_name']||''),path}:null;
      }).filter((sheet):sheet is {name:string;path:string}=>!!sheet);
      const worksheets=sheets.length?selected:Object.keys(files).filter(p=>/^xl\/worksheets\//.test(p)).sort().map(path=>({name:'',path}));
      for(const {name,path:key} of worksheets){
        if(name)rows.push('【'+name+'】');
        for(const row of list(parse(files[key]!).worksheet?.sheetData?.row)){
          const cells: string[] = [];
          let nextColumn = 0;
          for (const c of list(row.c)) {            
if (c.f !== undefined) throw new Error('formula'); const reference = String(c['@_r'] || '');
            const match = /^([a-z]{1,3})[1-9]\d*$/i.exec(reference);
            if (reference && !match)
              throw new Error('cell reference');
            let column = nextColumn;
            if (match) {
              column = 0;
              for (const letter of match[1]!.toUpperCase())
                column = column * 26 + letter.charCodeAt(0) - 64;
              column--;
            }
            if (column < nextColumn || column >= 16384)
              throw new Error('cell order');
            cells[column] = c['@_t'] === 's' ? shared[Number(c.v)] || '' : c['@_t'] === 'inlineStr' ? string(c.is?.t) : string(c.v); nextColumn = column + 1;
          }  
          if(cells.some(c=>c.trim()))rows.push(cells.join('\t'));
        }
      }
      return checkedKnowledgeText(rows.join('\n'));
    }
    if (!files['word/document.xml']) throw new Error('missing document');
    xml = strFromU8(files['word/document.xml']);
  } catch(e) { if(e instanceof BadRequestError)throw e;throw new BadRequestError(ext==='xlsx'?'Excel 文件无法读取，请使用 XLSX 格式并移除公式。':'Word 文件无法读取，请重新保存为 DOCX 后上传。'); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BadRequestError('Word 文件包含不支持的声明。');
  // Keep paragraph and table-cell boundaries, instead of flattening all text together.
  const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false }).parse(xml);
  const collect = (nodes: Record<string,unknown>[]): string => nodes.map(node => Object.entries(node).map(([key,value]) => {
    if (key === '#text') return String(value);
    if (key === ':@') return '';
    const text = Array.isArray(value) ? collect(value) : '';
    return text + (['w:p','w:tr'].includes(key) ? '\n' : key === 'w:tc' ? '\t' : key === 'w:tab' ? '\t' : key === 'w:br' ? '\n' : '');
  }).join('')).join('');
  return checkedKnowledgeText(collect(tree));
}
