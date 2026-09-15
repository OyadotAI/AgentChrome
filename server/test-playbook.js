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

console.log('playbook: ok');
process.exit(0);
