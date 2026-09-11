/**
 * Chat service — LLM + MCP-style tool execution for browser control.
 */

import { sendCommand } from './ws-handler.js';
import { BROWSER_TOOLS } from './chat-tools.js';
import * as keyConfig from './key-config.js';
import { metrics } from './metrics.js';
import * as usage from './usage.js';
import { checkHourly } from './limits.js';

const SYSTEM_PROMPT = `You control a real browser via tools. The browser belongs to the user — it has their cookies, logins, and sessions.

CRITICAL RULES — follow these exactly:
1. ALWAYS call analyze_page BEFORE click or type. Element IDs only exist after analysis. Never guess IDs.
2. Element IDs reset on EVERY analyze_page call. Never reuse IDs from a previous analysis.
3. After navigate or any click that changes the page, call analyze_page again — old IDs are gone.
4. If you get "Element not found", call analyze_page and retry with the new IDs.
5. To submit a search/form after typing, use press_key(key="Enter").
6. When done, give a brief summary and stop. Don't keep calling tools.

AUTOCOMPLETE / SUGGESTIONS:
- After type() returns, it tells you if suggestions are visible. If "AUTOCOMPLETE SUGGESTIONS ARE VISIBLE" appears in the response, you MUST call analyze_page to see and click a suggestion — do NOT press Enter blindly.
- To select a suggestion: analyze_page → find the suggestion element → click(element_id).
- Only press Enter if no suggestions appeared or you want to submit the typed text as-is.

KEYBOARD SAFETY:
- Only use press_key with: Enter, Escape, Tab, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Backspace, Delete, Space, Home, End, PageUp, PageDown.
- NEVER press: F-keys, Meta, Control, Alt, Shift alone, or any key combos. These can zoom the page, open emoji pickers, or trigger OS shortcuts.
- For form navigation: Tab to move between fields, Enter to submit, Escape to close dropdowns/modals.

Workflow: analyze_page → read element IDs → act (click/type/press_key) → if page changed → analyze_page again → continue.`;

/**
 * Execute a tool by name and return the result as a string for the LLM.
 */
async function executeTool(browserId, name, args) {
  try {
    switch (name) {
      case 'analyze_page': {
        const r = await sendCommand(browserId, 'analyze');
        if (!r.ok) return `Error: ${r.error}`;
        const { markdown, elements, scroll, viewport, truncated } = r.data;
        const visible = elements.filter((e) => e.visible);
        const offscreen = elements.filter((e) => !e.visible);
        let index = `\n\n## Element Index (${elements.length} total, ${visible.length} visible)\n\n`;
        if (visible.length) {
          index += '### Visible\n' + visible.map((e) => {
            let line = `  [#${e.id}] ${e.type}`;
            if (e.text) line += `: ${e.text}`;
            if (e.href) line += ` → ${e.href}`;
            if (e.value) line += ` value="${e.value}"`;
            if (e.checked) line += ' ✓';
            if (e.disabled) line += ' (disabled)';
            return line;
          }).join('\n') + '\n';
        }
        if (offscreen.length) {
          index += '\n### Off-screen\n' + offscreen.slice(0, 30).map((e) => `  [#${e.id}] ${e.type}: ${e.text || ''}`).join('\n') + '\n';
          if (offscreen.length > 30) index += `  ... and ${offscreen.length - 30} more off-screen elements\n`;
        }
        if (truncated) index += '\n⚠ Page content was truncated.\n';
        // Cap total output to avoid blowing context window
        const result = markdown + index;
        if (result.length > 30000) return result.slice(0, 30000) + '\n\n⚠ Output truncated to fit context window.';
        return result;
      }
      case 'navigate': {
        const r = await sendCommand(browserId, 'navigate', { url: args.url }, 90000);
        return r.ok ? `Navigated to ${args.url}` : `Error: ${r.error}`;
      }
      case 'click': {
        const r = await sendCommand(browserId, 'click', { selector: `[data-ac-id="${args.element_id}"]` });
        return r.ok ? `Clicked element ${args.element_id}` : `Error: ${r.error}`;
      }
      case 'press_key': {
        const r = await sendCommand(browserId, 'press_key', { key: args.key });
        return r.ok ? `Pressed ${args.key}` : `Error: ${r.error}`;
      }
      case 'type': {
        const r = await sendCommand(browserId, 'type', { selector: `[data-ac-id="${args.element_id}"]`, text: args.text });
        if (!r.ok) return `Error: ${r.error}`;
        if (r.data?.suggestions_visible) {
          return `Typed "${args.text}" into element ${args.element_id}. AUTOCOMPLETE SUGGESTIONS ARE VISIBLE — call analyze_page now to see and click a suggestion, or press Enter to submit as-is.`;
        }
        return `Typed "${args.text}" into element ${args.element_id}`;
      }
      case 'screenshot': {
        const r = await sendCommand(browserId, 'screenshot');
        if (!r.ok) return `Error: ${r.error}`;
        if (r.data?.screenshot) return `Screenshot captured (base64 image data available)`;
        return 'Screenshot captured';
      }
      case 'scroll': {
        const r = await sendCommand(browserId, 'scroll', { direction: args.direction, amount: args.amount });
        return r.ok ? `Scrolled ${args.direction}` : `Error: ${r.error}`;
      }
      case 'wait': {
        const r = await sendCommand(browserId, 'wait', { selector: args.selector, timeout: args.timeout });
        return r.ok ? `Element found: ${args.selector}` : `Error: ${r.error}`;
      }
      case 'read_elements': {
        const r = await sendCommand(browserId, 'read_page', { selector: args.selector, limit: args.limit });
        if (!r.ok) return `Error: ${r.error}`;
        const { url, title, elements } = r.data;
        const summary = elements.map((e) => `${e.tag}#${e.id || '?'} — ${e.text || e.aria_label || '(no text)'}`).join('\n');
        return `Page: ${title} (${url})\n\nElements (${elements.length}):\n${summary}`;
      }
      case 'list_tabs': {
        const r = await sendCommand(browserId, 'list_tabs');
        if (!r.ok) return `Error: ${r.error}`;
        const list = (r.data.tabs || []).map((t) => `${t.active ? '→ ' : '  '}[tab ${t.id}] ${t.title} — ${t.url}`).join('\n');
        return `Tabs:\n${list}`;
      }
      case 'open_tab': {
        const r = await sendCommand(browserId, 'open_tab', { url: args.url }, 90000);
        return r.ok ? `Opened tab ${r.data?.tab_id || ''}${args.url ? ' at ' + args.url : ''}` : `Error: ${r.error}`;
      }
      case 'switch_tab': {
        const r = await sendCommand(browserId, 'switch_tab', { tab_id: args.tab_id });
        return r.ok ? `Switched to tab ${args.tab_id}` : `Error: ${r.error}`;
      }
      case 'close_tab': {
        const r = await sendCommand(browserId, 'close_tab', { tab_id: args.tab_id });
        return r.ok ? `Closed tab` : `Error: ${r.error}`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

/**
 * Run the agentic loop: LLM → tool calls → execute → feed back → repeat until done.
 * Streams the final text response.
 */
export async function runChat(browserId, messages, { apiKey, onToolCall, onText } = {}) {
  // A runaway agent loop is the most expensive thing this control plane can do
  // on someone else's behalf, so the ceiling is checked before the first call.
  const budget = checkHourly('chatTokensPerHour', apiKey);
  if (!budget.allowed) {
    metrics.chatRequests.inc({ outcome: 'quota' });
    throw Object.assign(
      new Error(`Chat token quota reached for this hour (${budget.current}/${budget.quota})`),
      { status: 429 },
    );
  }

  // Settings belong to the calling API key; a key that has set none falls
  // back to the deployment-wide values.
  const { openaiKey, baseUrl, model } = keyConfig.resolve(apiKey);
  if (!openaiKey) {
    throw new Error('No LLM key configured for this API key. Add one in Settings, run `oya init`, or POST /api/config.');
  }
  const OPENAI_BASE = baseUrl;
  const MODEL = model;

  const allMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  let iterations = 0;
  const maxIterations = parseInt(process.env.CHAT_MAX_ITERATIONS || '200', 10);

  while (iterations < maxIterations) {
    iterations++;

    // Trim old tool results if context is getting too large (~4 chars per token)
    let totalChars = allMessages.reduce((sum, m) => sum + (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length, 0);
    while (totalChars > 400000 && allMessages.length > 3) {
      // Find the oldest tool result and truncate it
      const toolIdx = allMessages.findIndex((m, i) => i > 0 && m.role === 'tool');
      if (toolIdx === -1) break;
      // Also remove the assistant message with tool_calls right before it
      const prevIdx = toolIdx - 1;
      if (prevIdx > 0 && allMessages[prevIdx].role === 'assistant' && allMessages[prevIdx].tool_calls) {
        // Count how many tool results follow this assistant message
        let endIdx = toolIdx;
        while (endIdx < allMessages.length && allMessages[endIdx].role === 'tool') endIdx++;
        allMessages.splice(prevIdx, endIdx - prevIdx);
      } else {
        allMessages.splice(toolIdx, 1);
      }
      totalChars = allMessages.reduce((sum, m) => sum + (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length, 0);
    }

    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      redirect: 'error', // a 30x into an internal address would bypass validateBaseUrl
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: allMessages,
        tools: BROWSER_TOOLS,
        tool_choice: 'auto',
        stream: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error: ${res.status} — ${err}`);
    }

    const data = await res.json();

    // Every iteration of the agentic loop bills, so account per iteration
    // rather than once per request.
    const input = data.usage?.prompt_tokens || 0;
    const output = data.usage?.completion_tokens || 0;
    if (input) { metrics.chatTokens.inc({ direction: 'input' }, input); usage.record(apiKey, 'chat_input_tokens', input); }
    if (output) { metrics.chatTokens.inc({ direction: 'output' }, output); usage.record(apiKey, 'chat_output_tokens', output); }

    const choice = data.choices?.[0];
    if (!choice) throw new Error('No completion in response');

    const msg = choice.message;

    if (msg.tool_calls?.length) {
      const toolCalls = msg.tool_calls.filter((tc) => tc && tc.id);
      if (toolCalls.length !== msg.tool_calls.length) {
        console.warn('[chat] Skipped tool calls without id');
      }
      const toolResults = [];
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args = {};
        try {
          if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
        } catch {}
        onToolCall?.({ name, args });
        let result;
        try {
          result = await executeTool(browserId, name, args);
        } catch (err) {
          result = `Error: ${err.message}`;
        }
        toolResults.push({ tool_call_id: tc.id, content: result });
      }
      allMessages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function?.name, arguments: tc.function?.arguments ?? '{}' },
        })),
      });
      for (const tr of toolResults) {
        allMessages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content });
      }
      continue;
    }

    const text = msg.content?.trim();
    if (text) {
      onText?.(text);
      return { text, toolCalls: [] };
    }
  }

  return { text: 'Reached iteration limit.', toolCalls: [] };
}
