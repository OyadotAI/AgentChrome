#!/usr/bin/env node

/**
 * Oya Browser MCP Bridge — Local server that bridges MCP ↔ Chrome Extension.
 *
 * Architecture:
 *   MCP Client (Cursor/CC) ──HTTP POST /mcp──▶ This Bridge ──WS──▶ Chrome Extension
 *
 * Run: npx oya-browser-mcp
 *      node server.js
 *      node server.js --port 9222
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || process.env.PORT || '9333', 10);

// ─── Extension Connection ───

let extensionWs = null;
const pendingCommands = new Map();

function sendCommand(action, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Extension not connected'));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`Command ${action} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    pendingCommands.set(id, { resolve, reject, timer });
    extensionWs.send(JSON.stringify({ type: 'cmd', id, action, params: params || {} }));
  });
}

// ─── MCP Server Factory ───

function createMcp() {
  const server = new McpServer({ name: 'Oya Browser', version: '1.0.0' });

  server.tool(
    'analyze_page',
    `Analyze the current page. Returns structured markdown with all interactive elements numbered as [#id type "label"].
Use element IDs with click/type tools. Includes page metadata, content as markdown, and element index with visibility flags.`,
    {},
    async () => {
      const result = await sendCommand('analyze');
      if (!result.ok) return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      const { markdown, elements, truncated } = result.data;
      const visible = elements.filter(e => e.visible);
      const offscreen = elements.filter(e => !e.visible);
      let index = `\n\n## Element Index (${elements.length} total, ${visible.length} visible)\n\n`;
      if (visible.length) {
        index += '### Visible\n' + visible.map(e => {
          let l = `  [#${e.id}] ${e.type}`; if (e.text) l += `: ${e.text}`; if (e.href) l += ` → ${e.href}`; if (e.value) l += ` value="${e.value}"`; if (e.checked) l += ' ✓'; if (e.disabled) l += ' (disabled)'; return l;
        }).join('\n') + '\n';
      }
      if (offscreen.length) {
        index += '\n### Off-screen (scroll to reveal)\n' + offscreen.map(e => {
          let l = `  [#${e.id}] ${e.type}`; if (e.text) l += `: ${e.text}`; if (e.disabled) l += ' (disabled)'; return l;
        }).join('\n') + '\n';
      }
      if (truncated) index += '\n⚠ Page content was truncated. Scroll down and re-analyze to see more.\n';
      return { content: [{ type: 'text', text: markdown + index }] };
    }
  );

  server.tool('navigate', 'Navigate the browser to a URL.',
    { url: z.string().describe('The URL to navigate to') },
    async ({ url }) => {
      const r = await sendCommand('navigate', { url }, 90000);
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Navigated to ${url}` }] };
    }
  );

  server.tool('click', 'Click an interactive element by its ID number (from analyze_page).',
    { element_id: z.number().describe('Element ID from analyze_page') },
    async ({ element_id }) => {
      const r = await sendCommand('click', { element_id });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Clicked element ${element_id}` }] };
    }
  );

  server.tool('type', 'Type text into an input element by its ID number. Clears existing content first.',
    { element_id: z.number().describe('Element ID'), text: z.string().describe('Text to type') },
    async ({ element_id, text }) => {
      const r = await sendCommand('type', { element_id, text });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Typed "${text}" into element ${element_id}` }] };
    }
  );

  server.tool('screenshot', 'Capture a screenshot of the visible browser tab as PNG.',
    {},
    async () => {
      const r = await sendCommand('screenshot');
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      if (r.data?.screenshot) {
        const base64 = r.data.screenshot.replace(/^data:image\/png;base64,/, '');
        return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] };
      }
      return { content: [{ type: 'text', text: 'No image data' }] };
    }
  );

  server.tool('save_screenshot', 'Capture a screenshot and save it as a PNG file to disk.',
    { path: z.string().describe('Absolute file path to save the PNG') },
    async ({ path }) => {
      const r = await sendCommand('screenshot');
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      if (r.data?.screenshot) {
        const base64 = r.data.screenshot.replace(/^data:image\/png;base64,/, '');
        const { writeFileSync } = await import('node:fs');
        writeFileSync(path, Buffer.from(base64, 'base64'));
        return { content: [{ type: 'text', text: `Screenshot saved to ${path}` }] };
      }
      return { content: [{ type: 'text', text: 'No image data' }] };
    }
  );

  server.tool('press_key', 'Press a keyboard key.',
    { key: z.enum(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Space', 'Home', 'End', 'PageUp', 'PageDown']).describe('Key to press') },
    async ({ key }) => {
      const r = await sendCommand('press_key', { key });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Pressed ${key}` }] };
    }
  );

  server.tool('scroll', 'Scroll the page up or down.',
    { direction: z.enum(['up', 'down']).describe('Scroll direction'), amount: z.number().optional().describe('Pixels to scroll (default 500)') },
    async ({ direction, amount }) => {
      const r = await sendCommand('scroll', { direction, amount: amount || 500 }, 15000);
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Scrolled ${direction} ${amount || 500}px` }] };
    }
  );

  server.tool('wait', 'Wait for a CSS selector to appear on the page.',
    { selector: z.string().describe('CSS selector'), timeout: z.number().optional().describe('Max wait ms (default 10000)') },
    async ({ selector, timeout }) => {
      const r = await sendCommand('wait', { selector, timeout });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Element found: ${selector}` }] };
    }
  );

  server.tool('click_coordinates', 'Click at x,y pixel coordinates.',
    { x: z.number().describe('X pixels from left'), y: z.number().describe('Y pixels from top') },
    async ({ x, y }) => {
      const r = await sendCommand('click_coordinates', { x, y });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Clicked at (${x}, ${y})` }] };
    }
  );

  server.tool('mouse_move', 'Move mouse to x,y coordinates (hover). Useful for tooltips and dropdowns.',
    { x: z.number().describe('X pixels'), y: z.number().describe('Y pixels') },
    async ({ x, y }) => {
      const r = await sendCommand('mouse_move', { x, y });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Mouse moved to (${x}, ${y})` }] };
    }
  );

  server.tool('double_click', 'Double-click an element by ID or at coordinates.',
    { element_id: z.number().optional().describe('Element ID'), x: z.number().optional(), y: z.number().optional() },
    async ({ element_id, x, y }) => {
      const params = element_id !== undefined ? { element_id } : { x, y };
      const r = await sendCommand('double_click', params);
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: element_id ? `Double-clicked element ${element_id}` : `Double-clicked (${x}, ${y})` }] };
    }
  );

  server.tool('keyboard_type', 'Type text into whatever is currently focused.',
    { text: z.string().describe('Text to type') },
    async ({ text }) => {
      const r = await sendCommand('keyboard_type', { text });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Typed "${text}"` }] };
    }
  );

  server.tool('drag', 'Drag from one point to another.',
    { from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number() },
    async ({ from_x, from_y, to_x, to_y }) => {
      const r = await sendCommand('drag', { from_x, from_y, to_x, to_y });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Dragged (${from_x},${from_y}) → (${to_x},${to_y})` }] };
    }
  );

  server.tool('list_tabs', 'List all open browser tabs.',
    {},
    async () => {
      const r = await sendCommand('list_tabs');
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      const list = (r.data.tabs || []).map(t => `${t.active ? '→ ' : '  '}[tab ${t.id}] ${t.title} — ${t.url}`).join('\n');
      return { content: [{ type: 'text', text: `Tabs:\n${list}` }] };
    }
  );

  server.tool('open_tab', 'Open a new tab.',
    { url: z.string().optional().describe('URL to open') },
    async ({ url }) => {
      const r = await sendCommand('open_tab', { url }, 90000);
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Opened tab${url ? ' at ' + url : ''}` }] };
    }
  );

  server.tool('switch_tab', 'Switch to a tab by ID.',
    { tab_id: z.number().describe('Tab ID from list_tabs') },
    async ({ tab_id }) => {
      const r = await sendCommand('switch_tab', { tab_id });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: `Switched to tab ${tab_id}` }] };
    }
  );

  server.tool('close_tab', 'Close a tab.',
    { tab_id: z.number().optional().describe('Tab ID (default: active tab)') },
    async ({ tab_id }) => {
      const r = await sendCommand('close_tab', { tab_id });
      if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      return { content: [{ type: 'text', text: 'Closed tab' }] };
    }
  );

  return server;
}

// ─── HTTP + WebSocket Server ───

const httpServer = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', extension: !!extensionWs }));
    return;
  }

  // MCP endpoint
  if (url.pathname === '/mcp') {
    if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Chrome extension not connected. Open Chrome with the Oya Browser extension installed.' }));
      return;
    }

    try {
      // Collect body
      let body = '';
      for await (const chunk of req) body += chunk;
      if (body) {
        try { req.body = JSON.parse(body); } catch { req.body = body; }
      }

      const server = createMcp();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found. MCP endpoint is at /mcp' }));
});

// ─── WebSocket Server (for extension connection) ───

const wss = new WebSocketServer({ server: httpServer, path: '/ext' });
let pingTimer = null;

wss.on('connection', (socket) => {
  if (extensionWs) {
    try { extensionWs.close(); } catch {}
  }
  extensionWs = socket;
  console.log('[bridge] Extension connected');

  // Ping to keep alive
  clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping' }));
    }
  }, 15000);

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'pong') return;

    // Route command results back to pending promises
    if (msg.type === 'result' && msg.id) {
      const pending = pendingCommands.get(msg.id);
      if (pending) {
        pendingCommands.delete(msg.id);
        clearTimeout(pending.timer);
        pending.resolve(msg);
      }
    }
  });

  socket.on('close', () => {
    if (extensionWs === socket) extensionWs = null;
    clearInterval(pingTimer);
    console.log('[bridge] Extension disconnected');
    // Reject all pending commands
    for (const [id, p] of pendingCommands) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    pendingCommands.clear();
  });
});

// ─── Start ───

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  \x1b[1m\x1b[31m✕\x1b[0m Port ${PORT} is already in use.`);
    console.error('');
    console.error(`  Either stop the other process:  \x1b[36mlsof -ti:${PORT} | xargs kill\x1b[0m`);
    console.error(`  Or use a different port:        \x1b[36mnode server.js --port ${PORT + 1}\x1b[0m`);
    console.error('');
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  \x1b[1m\x1b[32m●\x1b[0m \x1b[1mOya Browser MCP Bridge\x1b[0m');
  console.log('');
  console.log(`  MCP endpoint:  \x1b[36mhttp://localhost:${PORT}/mcp\x1b[0m`);
  console.log(`  Extension WS:  \x1b[36mws://localhost:${PORT}/ext\x1b[0m`);
  console.log('');
  console.log('  Add to your AI tool config:');
  console.log('');
  console.log(`  \x1b[2m{\x1b[0m`);
  console.log(`    \x1b[36m"mcpServers"\x1b[0m: {`);
  console.log(`      \x1b[36m"oya-browser"\x1b[0m: {`);
  console.log(`        \x1b[36m"url"\x1b[0m: \x1b[33m"http://localhost:${PORT}/mcp"\x1b[0m`);
  console.log(`      }`);
  console.log(`    }`);
  console.log(`  \x1b[2m}\x1b[0m`);
  console.log('');
  console.log('  Waiting for Chrome extension to connect...');
  console.log('');
});
