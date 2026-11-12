/*
 * 中文导读：既有验证代码：script-design.test 的输入、输出及边界场景。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedPlaybook, playbookSchema, compilePlaybook, playbookOpening, playbookVariables, normalizeScript, releasePlaybook } from '../../src/modules/agent/agent.playbook.js';
import { unifiedScript, patchScript, flowText } from '../../../console/src/components/agents/studio/flow-model.js';

const legacy = () => seedPlaybook('您好，我是原文字稿里的商务助手。', '仅使用已确认资料。');

test('text-only scripts become a graph without losing original text, FAQ or constraints', () => {
  const original = legacy(), before = structuredClone(original);
  const draft = unifiedScript(original);
  assert.deepEqual(original, before);
  assert.equal(draft.canvas?.nodes.find(n => n.id === draft.canvas?.entry)?.text, original.opening);
  assert.deepEqual(draft.legacyScript, { opening: original.opening, flow: original.flow });
  assert.deepEqual(draft.faq, original.faq);
  assert.equal(draft.baseInstructions, original.baseInstructions);
  assert.ok(original.flow.every(step => draft.canvas?.nodes.some(n => n.text === step.instruction)));
  assert.equal(playbookSchema.safeParse(draft).success, true);
});

test('an existing graph wins over a divergent old text and retains all branches and the old published flow', () => {
  const original = legacy(), graph = unifiedScript(original).canvas!;
  graph.nodes[0]!.text = '您好，{{客户姓名}}，这是画布中的开场白。';
  graph.edges[0]!.condition = '客户明确愿意了解业务';
  const published = structuredClone(graph); published.nodes[0]!.text = '原正式流程的开场白';
  const draft = unifiedScript({ ...original, canvas: graph, publishedFlow: published });
  assert.deepEqual(draft.canvas, graph);
  assert.deepEqual(draft.publishedFlow, published);
  assert.equal(draft.legacyScript?.opening, original.opening);
  assert.equal(draft.opening, graph.nodes[0]!.text);
  assert.deepEqual(unifiedScript(draft), draft);
});

test('recording suggestions update the same opening used by overview, export, preview and variables', () => {
  const draft = unifiedScript(legacy());
  const next = patchScript(draft, { opening: '您好，{{客户姓名}}，我是{{公司名称}}的 AI 助手。' });
  const parsed = playbookSchema.parse(normalizeScript(next));
  assert.equal(parsed.opening, playbookOpening(parsed));
  assert.ok(flowText(next.canvas!).includes(next.opening));
  assert.ok(compilePlaybook(parsed).includes(next.opening));
  assert.deepEqual(playbookVariables(parsed, {}).firstMessage, ['客户姓名', '公司名称']);
  assert.equal(draft.opening, legacy().opening);
});

test('incomplete canvas saves as a draft and is blocked at the formal publication boundary', () => {
  const draft = unifiedScript(legacy());
  const next = patchScript(draft, { opening: '' });
  assert.equal(playbookSchema.safeParse(next).success, true);
  assert.equal(playbookOpening(next), '');
  assert.throws(() => releasePlaybook(next));
  assert.equal(playbookSchema.safeParse({ ...legacy(), opening: '' }).success, false);
});

test('a release takes the unified graph while later draft edits cannot change the snapshot', () => {
  const draft = unifiedScript(legacy());
  const release = structuredClone(releasePlaybook(playbookSchema.parse(draft)));
  const before = JSON.stringify(release);
  const changed = patchScript(draft, { opening: '您好，这是尚未发布的新开场白。' });
  assert.equal(JSON.stringify(release), before);
  assert.notEqual(playbookOpening(release), playbookOpening(changed));
  assert.deepEqual(release.publishedFlow, release.canvas);
});

test('legacy formal flows still compile and register the actual opening variables', () => {
  const original = legacy(), flow = unifiedScript(original).canvas!;
  flow.nodes[0]!.text = '您好，{{正式客户}}，现在方便沟通吗？';
  const old = { ...original, opening: '旧稿里的{{旧变量}}', publishedFlow: flow };
  assert.deepEqual(playbookVariables(old, {}).firstMessage, ['正式客户']);
  assert.ok(compilePlaybook(old).includes(flow.nodes[0]!.text));
  assert.ok(!compilePlaybook(old).includes('{{旧变量}}'));
});
