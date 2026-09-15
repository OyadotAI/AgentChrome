#!/usr/bin/env node
/**
 * Playbooks replay by stable element metadata with data as placeholders, the
 * Playwright export runs, and a run parks on a person until they respond.
 *
 * Usage: node test-playbook.js
 */

import assert from 'node:assert/strict';
import { matchElement, renderPlaywright, variablesOf, missingVariables } from './src/playbook.js';
import { fill, redact } from './src/chat-service.js';
import * as runs from './src/runs.js';

const page = [
  { id: 1, type: 'link', tag: 'a', text: 'Exam or Specialty Procedure', visible: true },
  { id: 2, type: 'input', tag: 'input', text: 'Member ID', domId: 'txtMember', visible: true },
  { id: 3, type: 'option', tag: 'li', text: 'Blue Shield of California', visible: true },
  { id: 4, type: 'option', tag: 'li', text: 'Aetna', visible: true },
];

assert.equal(matchElement({ tag: 'input', domId: 'txtMember', text: 'renamed label' }, page).id, 2, 'DOM id beats text');
assert.equal(matchElement({ type: 'link', tag: 'a', text: 'Exam or Specialty Procedure' }, page).id, 1);
assert.equal(matchElement({ type: 'option', tag: 'li', text: '{{insurer}}' }, page, 'aetna').id, 4, 'data-driven click picks by value');
assert.equal(matchElement({ tag: 'button', domId: 'gone' }, page), null);
assert.equal(matchElement({}, page), null, 'an unrecorded element never matches');

// Data pass-through: the model reads placeholders, the page gets values.
const data = { memberId: 'XED910973336', patient: 'Jill Dyck', sex: 'F' };
assert.equal(redact('value="XED910973336" for Jill Dyck, sex F', data), 'value="{{memberId}}" for {{patient}}, sex F');
assert.equal(fill('{{memberId}} / {{unknown}}', data), 'XED910973336 / {{unknown}}');

const steps = [
  { action: 'navigate', url: 'https://example.com/"q"', start: true },
  { action: 'click', el: page[0] },
  { action: 'type', el: page[1], text: '{{memberId}}' },
  { action: 'type', el: page[1], text: 'a`b${c}{{memberId}}' },
  { action: 'click', el: { ...page[2], text: '{{insurer}}' } },
  { action: 'press_key', key: 'Enter' },
  { action: 'scroll', direction: 'down', amount: 400 },
];
assert.deepEqual(variablesOf(steps), ['memberId', 'insurer']);
assert.deepEqual(missingVariables({ steps, defaults: { insurer: 'Aetna' } }, {}), ['memberId']);

const code = renderPlaywright({ name: 'radmd', steps });
assert.ok(!code.includes('XED910973336'), 'values stay out of the generated code');

// Run the export against a fake page to prove it parses and calls what it should.
const calls = [];
const loc = (desc) => ({ first: () => ({ click: async () => calls.push(['click', desc]), fill: async (v) => calls.push(['fill', desc, v]) }) });
const fake = {
  goto: async (u) => calls.push(['goto', u]),
  getByText: loc, getByTestId: loc, getByLabel: loc, getByPlaceholder: loc, locator: loc,
  keyboard: { press: async (k) => calls.push(['press', k]) },
  mouse: { wheel: async (_, y) => calls.push(['wheel', y]) },
};
await new Function(code.replace('export default ', 'return '))()(fake, { memberId: 'NEW1', insurer: 'Aetna' });
assert.deepEqual(calls, [
  ['goto', 'https://example.com/"q"'],
  ['click', 'Exam or Specialty Procedure'],
  ['fill', '[id="txtMember"]', 'NEW1'],
  ['fill', '[id="txtMember"]', 'a`b${c}NEW1'],
  ['click', 'Aetna'],
  ['press', 'Enter'],
  ['wheel', 400],
]);

// Human attention: the run parks, only its owner can see and answer it, then it finishes.
const run = runs.start('owner', 'b1', async ({ requestHuman }) => ({ text: await requestHuman({ reason: 'agent', message: 'Which plan?' }) }));
assert.equal(runs.get('owner', run.id).status, 'needs_attention');
assert.equal(runs.get('owner', run.id).attention.message, 'Which plan?');
assert.equal(runs.get('intruder', run.id), null);
assert.equal(runs.respond('intruder', run.id, 'x'), false);
assert.equal(runs.respond('owner', run.id, 'Gold'), true);
assert.equal(runs.respond('owner', run.id, 'again'), false, 'one answer per request');
await new Promise((r) => setImmediate(r));
assert.equal(runs.get('owner', run.id).status, 'succeeded');
assert.deepEqual(runs.get('owner', run.id).result, { text: 'Gold' });

const failing = runs.start('owner', 'b1', async () => { throw new Error('form rejected'); });
await new Promise((r) => setImmediate(r));
assert.equal(runs.get('owner', failing.id).status, 'failed');
assert.equal(runs.get('owner', failing.id).error, 'form rejected');

// The real agent loop: data reaches the page through placeholders, never reaches the model
// (not even read back from the page), and is recorded as placeholders.
const { runChat, lastRun } = await import('./src/chat-service.js');
const { registry } = await import('./src/connection-registry.js');
const { createServer } = await import('node:http');

const secrets = { name: 'Ada Lovelace', phone: '555-0100' };
const turns = [
  { tool: 'analyze_page', args: {} },
  { tool: 'type', args: { element_id: 1, text: '{{name}}' } },
  { tool: 'keyboard_type', args: { text: '{{phone}}' } },
  { tool: 'analyze_page', args: {} },
  { text: 'DONE: filled the form' },
];
const llmBodies = [];
const llm = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    llmBodies.push(body);
    const next = turns[llmBodies.length - 1];
    const message = next.text
      ? { role: 'assistant', content: next.text }
      : { role: 'assistant', content: null, tool_calls: [{ id: `call_${llmBodies.length}`, type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
});
await new Promise((r) => llm.listen(0, '127.0.0.1', r));
process.env.OPENAI_API_KEY = 'sk-test';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${llm.address().port}/v1`;

const typed = [];
let fieldValue = '';
registry.add('loop-browser', {
  ws: null, apiKey: 'loop-key', name: 'loop', clientType: 'cdp',
  driver: {
    send: async (action, params) => {
      if (action === 'list_tabs') return { ok: true, data: { tabs: [{ id: 't1', url: 'https://example.com/form', title: 'Form', active: true }] } };
      if (action === 'analyze') {
        return { ok: true, data: { markdown: `[#1 input "Customer name"] value="${fieldValue}"`, elements: [{ id: 1, type: 'input', tag: 'input', text: 'Customer name', domId: 'custname', value: fieldValue, visible: true }] } };
      }
      if (action === 'type' || action === 'keyboard_type') {
        typed.push([action, params.text]);
        if (action === 'type') fieldValue = params.text;
      }
      return { ok: true, data: {} };
    },
  },
});

const chat = await runChat('loop-browser', [{ role: 'user', content: 'Fill the form for {{name}}, phone {{phone}}.' }], { apiKey: 'loop-key', data: secrets });
llm.close();
assert.equal(chat.text, 'DONE: filled the form');
assert.deepEqual(typed, [['type', 'Ada Lovelace'], ['keyboard_type', '555-0100']], 'the page gets the real values');
assert.equal(llmBodies.length, turns.length);
assert.ok(llmBodies.every((b) => !b.includes('Ada Lovelace') && !b.includes('555-0100')), 'the model never sees the values, even read back from the page');
assert.ok(JSON.parse(llmBodies[0]).messages[0].content.startsWith('You are a web automation agent'), 'the automation system prompt is sent');
const recorded = lastRun('loop-browser').steps;
assert.deepEqual(recorded.map((s) => s.action), ['navigate', 'type'], 'the start page and the replayable type; keyboard_type is not recorded');
assert.equal(recorded[1].text, '{{name}}');
assert.equal(recorded[1].el.domId, 'custname');

console.log('playbook: ok');
process.exit(0);
