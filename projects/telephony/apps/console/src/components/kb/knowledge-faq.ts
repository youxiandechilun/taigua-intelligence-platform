/*
 * 中文导读：知识库的 knowledge-faq 组件，封装该界面的展示与交互。
 */
// Extra FAQ fields live in the existing versioned knowledge body. This keeps
// retrieval, exports and restores on the same source of truth without a migration.
const start = '\n\n<!-- taigua-faq-v1:仅供内部检索与应答参考 -->\n';
const end = '\n<!-- /taigua-faq-v1 -->';
export type FaqContent = {answer:string;similarQuestions:string[];boundary:string};

export function readFaq(content = ''):FaqContent {
 const plain = {answer:content,similarQuestions:[],boundary:''};
 const at = content.lastIndexOf(start);
 if(at < 0 || !content.endsWith(end))return plain;
 try {
  const data:unknown = JSON.parse(content.slice(at + start.length,-end.length));
  if(!data || typeof data !== 'object' || Array.isArray(data))return plain;
  const fields = data as Record<string,unknown>;
  if(Object.keys(fields).some(k=>!['相似问法','回答边界'].includes(k)) ||
   !Array.isArray(fields['相似问法']) || !fields['相似问法'].every(v=>typeof v === 'string') ||
   typeof fields['回答边界'] !== 'string')return plain;
  return {answer:content.slice(0,at),similarQuestions:fields['相似问法'] as string[],boundary:fields['回答边界']};
 } catch {return plain;}
}

export function writeFaq({answer,similarQuestions,boundary}:FaqContent) {
 const questions = [...new Set(similarQuestions.map(v=>v.trim()).filter(Boolean))];
 return answer.trim() + (questions.length || boundary.trim()
  ? start + JSON.stringify({'相似问法':questions,'回答边界':boundary.trim()},null,2) + end : '');
}

export function faqPreview(content = '') {
 return content.split('<!-- taigua-faq-v1:')[0]?.trim() || '';
}
