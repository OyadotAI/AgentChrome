/**
 * Per-browser MCP server factory — exposes browser tools via Streamable HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { registry } from './connection-registry.js';
import { sendCommand } from './ws-handler.js';

/** @type {Map<string, McpServer>} */
const mcpServers = new Map();

/**
 * Create an MCP server for a browser session.
 */
function createMcpServer(browserId) {
  const browser = registry.get(browserId);
  const serverName = browser ? `Oya Browser — ${browser.name}` : `Oya Browser — ${browserId}`;

  const server = new McpServer({
    name: serverName,
    version: '1.0.0',
  });

  // ── Tools ──

  server.tool(
    'analyze_page',
    `Analyze the current page. Returns structured markdown with all interactive elements numbered as [#id type "label"].
Use element IDs with click/type tools. The output includes:
- Page metadata (URL, title, viewport, scroll position)
- Full page content as markdown with inline element annotations
- Element index with visibility flags (visible = in viewport without scrolling)`,
    {},
    async () => {
      const result = await sendCommand(browserId, 'analyze');
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      const { markdown, elements, scroll, viewport, truncated } = result.data;

      // Build a compact element index grouped by visibility
      const visible = elements.filter((e) => e.visible);
      const offscreen = elements.filter((e) => !e.visible);

      let index = `\n\n## Element Index (${elements.length} total, ${visible.length} visible)\n\n`;

      if (visible.length > 0) {
        index += '### Visible\n';
        index += visible.map((e) => {
          let line = `  [#${e.id}] ${e.type}`;
          if (e.text) line += `: ${e.text}`;
          if (e.href) line += ` → ${e.href}`;
          if (e.value) line += ` value="${e.value}"`;
          if (e.checked) line += ' ✓';
          if (e.disabled) line += ' (disabled)';
          return line;
        }).join('\n');
        index += '\n';
      }

      if (offscreen.length > 0) {
        index += '\n### Off-screen (scroll to reveal)\n';
        index += offscreen.map((e) => {
          let line = `  [#${e.id}] ${e.type}`;
          if (e.text) line += `: ${e.text}`;
          if (e.disabled) line += ' (disabled)';
          return line;
        }).join('\n');
        index += '\n';
      }

      if (truncated) {
        index += '\n⚠ Page content was truncated (very long page). Scroll down and re-analyze to see more.\n';
      }

      return {
        content: [{
          type: 'text',
          text: markdown + index,
        }],
      };
    }
  );

  server.tool(
    'navigate',
    'Navigate the browser to a URL.',
    { url: z.string().describe('The URL to navigate to') },
    async ({ url }) => {
      const result = await sendCommand(browserId, 'navigate', { url }, 90000);
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Navigated to ${url}` }] };
    }
  );

  server.tool(
    'click',
    'Click an interactive element by its ID number (from analyze_page results).',
    { element_id: z.number().describe('The element ID number from analyze_page') },
    async ({ element_id }) => {
      const selector = `[data-ac-id="${element_id}"]`;
      const result = await sendCommand(browserId, 'click', { selector });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Clicked element ${element_id}` }] };
    }
  );

  server.tool(
    'press_key',
    'Press a key (e.g. Enter, Escape, ArrowDown, ArrowUp). Dispatches to the focused element.',
    { key: z.string().describe('Key to press: Enter, Escape, ArrowDown, ArrowUp, Tab, etc.') },
    async ({ key }) => {
      const result = await sendCommand(browserId, 'press_key', { key });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Pressed ${key}` }] };
    }
  );

  server.tool(
    'type',
    'Type text into an input element by its ID number (from analyze_page results). Clears existing content first.',
    {
      element_id: z.number().describe('The element ID number from analyze_page'),
      text: z.string().describe('The text to type'),
    },
    async ({ element_id, text }) => {
      const selector = `[data-ac-id="${element_id}"]`;
      const result = await sendCommand(browserId, 'type', { selector, text });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Typed "${text}" into element ${element_id}` }] };
    }
  );

  server.tool(
    'screenshot',
    'Capture a screenshot of the visible browser tab as a base64 PNG image.',
    {},
    async () => {
      const result = await sendCommand(browserId, 'screenshot');
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      if (result.data?.screenshot) {
        // Strip data:image/png;base64, prefix if present
        const base64 = result.data.screenshot.replace(/^data:image\/png;base64,/, '');
        return {
          content: [{
            type: 'image',
            data: base64,
            mimeType: 'image/png',
          }],
        };
      }
      return { content: [{ type: 'text', text: 'Screenshot captured but no image data returned' }] };
    }
  );

  server.tool(
    'scroll',
    'Scroll the page up or down.',
    {
      direction: z.enum(['up', 'down']).describe('Scroll direction'),
      amount: z.number().optional().describe('Pixels to scroll (default 500)'),
    },
    async ({ direction, amount }) => {
      const result = await sendCommand(browserId, 'scroll', { direction, amount });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Scrolled ${direction} ${amount || 500}px` }] };
    }
  );

  server.tool(
    'wait',
    'Wait for an element matching a CSS selector to appear on the page.',
    {
      selector: z.string().describe('CSS selector to wait for'),
      timeout: z.number().optional().describe('Max wait time in ms (default 10000)'),
    },
    async ({ selector, timeout }) => {
      const result = await sendCommand(browserId, 'wait', { selector, timeout });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Element found: ${selector}` }] };
    }
  );

  server.tool(
    'read_elements',
    'List interactive elements on the page. Lighter than analyze_page — returns element metadata without full page markdown.',
    {
      selector: z.string().optional().describe('CSS selector to scope the search (default: entire page)'),
      limit: z.number().optional().describe('Max elements to return (default 50)'),
    },
    async ({ selector, limit }) => {
      const result = await sendCommand(browserId, 'read_page', { selector, limit });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      const { url, title, elements } = result.data;
      const summary = elements
        .map((e) => `${e.tag}${e.id ? '#' + e.id : ''} — ${e.text || e.aria_label || e.placeholder || '(no text)'}`)
        .join('\n');
      return {
        content: [{
          type: 'text',
          text: `Page: ${title} (${url})\n\nElements (${elements.length}):\n${summary}`,
        }],
      };
    }
  );

  // ── Tab Management Tools ──

  server.tool(
    'list_tabs',
    'List all open tabs in the browser. Returns tab ID, title, URL, and which is active.',
    {},
    async () => {
      const result = await sendCommand(browserId, 'list_tabs');
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      const tabList = (result.data.tabs || [])
        .map(t => `${t.active ? '→ ' : '  '}[tab ${t.id}] ${t.title} — ${t.url}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Tabs:\n${tabList}` }] };
    }
  );

  server.tool(
    'open_tab',
    'Open a new browser tab, optionally navigating to a URL.',
    { url: z.string().optional().describe('URL to open (default: blank tab)') },
    async ({ url }) => {
      const result = await sendCommand(browserId, 'open_tab', { url }, 90000);
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Opened tab ${result.data.tab_id}${url ? ' at ' + url : ''}` }] };
    }
  );

  server.tool(
    'switch_tab',
    'Switch to a different browser tab by its tab ID (from list_tabs).',
    { tab_id: z.number().describe('The tab ID to switch to') },
    async ({ tab_id }) => {
      const result = await sendCommand(browserId, 'switch_tab', { tab_id });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Switched to tab ${tab_id}` }] };
    }
  );

  server.tool(
    'close_tab',
    'Close a browser tab. Closes active tab if no tab_id specified.',
    { tab_id: z.number().optional().describe('Tab ID to close (default: active tab)') },
    async ({ tab_id }) => {
      const result = await sendCommand(browserId, 'close_tab', { tab_id });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Closed tab` }] };
    }
  );

  // ── Resources ──

  server.resource(
    'current-page',
    'browser://current-page',
    { description: 'Current URL and page title of the connected browser' },
    async () => {
      const b = registry.get(browserId);
      return {
        contents: [{
          uri: 'browser://current-page',
          text: b ? `URL: ${b.currentUrl || '(unknown)'}\nBrowser: ${b.name}` : 'Browser not connected',
          mimeType: 'text/plain',
        }],
      };
    }
  );

  return server;
}

/**
 * Express handler for MCP Streamable HTTP endpoint.
 * Each browser gets its own endpoint: POST/GET/DELETE /mcp/:browserId
 */
export async function handleMcpRequest(req, res) {
  const { browserId } = req.params;

  if (!registry.isConnected(browserId)) {
    res.status(404).json({ error: `Browser ${browserId} not connected` });
    return;
  }

  let server = mcpServers.get(browserId);
  if (!server) {
    server = createMcpServer(browserId);
    mcpServers.set(browserId, server);
  }

  // Stateless transport can only handle one request — create fresh transport per request.
  // Must disconnect from previous transport before connecting to new one.
  await server.close?.();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  await server.connect(transport);

  // Pass req.body — express.json() consumes the stream, so transport must use pre-parsed body
  await transport.handleRequest(req, res, req.body);
}

/**
 * Destroy MCP server when browser disconnects.
 */
export function destroyMcpServer(browserId) {
  const server = mcpServers.get(browserId);
  if (server) {
    server.close?.();
    mcpServers.delete(browserId);
  }
}
