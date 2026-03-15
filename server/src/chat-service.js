/**
 * Chat service — LLM + MCP-style tool execution for browser control.
 */

import { sendCommand } from './ws-handler.js';
import { BROWSER_TOOLS } from './chat-tools.js';
import { runtimeConfig } from './runtime-config.js';

const SYSTEM_PROMPT = `You control a real browser via tools. The browser belongs to the user — it has their cookies, logins, and sessions.

CRITICAL RULES — follow these exactly:
1. ALWAYS call analyze_page BEFORE click or type. Element IDs only exist after analysis. Never guess IDs.
2. Element IDs reset on EVERY analyze_page call. Never reuse IDs from a previous analysis.
3. After navigate or any click that changes the page, call analyze_page again — old IDs are gone.
4. If you get "Element not found", call analyze_page and retry with the new IDs.
5. To submit a search/form after typing, use press_key(key="Enter").
6. When done, give a brief summary and stop. Don't keep calling tools.

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
          index += '\n### Off-screen\n' + offscreen.map((e) => `  [#${e.id}] ${e.type}: ${e.text || ''}`).join('\n') + '\n';
        }
        if (truncated) index += '\n⚠ Page content was truncated.\n';
        return markdown + index;
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
        return r.ok ? `Typed into element ${args.element_id}` : `Error: ${r.error}`;
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
export async function runChat(browserId, messages, { onToolCall, onText } = {}) {
  const openaiKey = runtimeConfig.getOpenAIKey();
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured. Go to Settings on the landing page or set OPENAI_API_KEY env var.');
  }
  const OPENAI_BASE = runtimeConfig.getOpenAIBase();
  const MODEL = runtimeConfig.getChatModel();

  const allMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  let iterations = 0;
  const maxIterations = parseInt(process.env.CHAT_MAX_ITERATIONS || '200', 10);

  while (iterations < maxIterations) {
    iterations++;

    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
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
