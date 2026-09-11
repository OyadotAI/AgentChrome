/**
 * CDP front door for automation harnesses (OYA_REMOTE_DEBUGGING_PORT).
 *
 * Electron's own debug endpoint is not something an agent can use as-is: it
 * lists this browser's UI as a page an agent will happily drive, and
 * Target.createTarget answers "Not supported". This proxies Chromium's endpoint
 * (one port up, loopback only), hides the UI, and opens tabs through createTab
 * so every page an agent gets has taken the protected path — fingerprint,
 * proxy and persona partition included.
 */

const http = require('http');
const WebSocket = require('ws');

const isUi = (info) => info?.type === 'page' && /^file:.*\/renderer\/index\.html/.test(info.url || '');

function start({ port, upstream, host, tabs, createTab, closeTab }) {
  const up = `127.0.0.1:${upstream}`;
  const hidden = new Set();

  const refreshHidden = async () => {
    const list = await (await fetch(`http://${up}/json/list`)).json();
    for (const t of list) if (isUi(t)) hidden.add(t.id);
    return list;
  };

  // A tab's targetId, asked of its own debugger (setupTabCDP attaches it).
  const targetIdOf = async (tab) => {
    if (!tab.targetId) {
      const { targetInfo } = await tab.view.webContents.debugger.sendCommand('Target.getTargetInfo');
      tab.targetId = targetInfo.targetId;
    }
    return tab.targetId;
  };

  const openTab = async (url) => {
    const id = createTab(url || 'about:blank', true);
    const tab = tabs().find((t) => t.id === id);
    await Promise.race([tab.ready?.catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
    return targetIdOf(tab);
  };

  const server = http.createServer(async (req, res) => {
    const reqHost = req.headers.host || `127.0.0.1:${port}`;
    const rewrite = (text) => text.split(up).join(reqHost).split(`localhost:${upstream}`).join(reqHost);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      const path = req.url.split('?')[0].replace(/\/$/, '');
      if (path === '/json/new') {
        const url = decodeURIComponent(req.url.split('?')[1] || '') || 'about:blank';
        const targetId = await openTab(url);
        const target = (await refreshHidden()).find((t) => t.id === targetId);
        return send(200, rewrite(JSON.stringify(target || { id: targetId })));
      }
      if (path === '/json' || path === '/json/list') {
        const list = await refreshHidden();
        return send(200, rewrite(JSON.stringify(list.filter((t) => !hidden.has(t.id)))));
      }
      const upRes = await fetch(`http://${up}${req.url}`, { method: req.method });
      send(upRes.status, rewrite(await upRes.text()));
    } catch (e) {
      send(502, { error: e.message });
    }
  });

  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    const m = req.url.match(/^\/devtools\/(browser|page)\/([^/?]+)/);
    try { await refreshHidden(); } catch { return socket.destroy(); }
    if (!m || hidden.has(m[2])) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (client) => bridge(client, `ws://${up}${req.url}`, m[1] === 'browser'));
  });

  function bridge(client, url, isBrowser) {
    const upstreamWs = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const queued = [];
    const hiddenSessions = new Set();
    const filterReplies = new Set();
    const toUpstream = (text) => (upstreamWs.readyState === WebSocket.OPEN ? upstreamWs.send(text) : queued.push(text));
    const reply = (id, result) => client.send(JSON.stringify({ id, result }));
    const fail = (id, message) => client.send(JSON.stringify({ id, error: { code: -32000, message } }));

    upstreamWs.on('open', () => { for (const text of queued.splice(0)) upstreamWs.send(text); });
    upstreamWs.on('close', () => client.close());
    upstreamWs.on('error', () => client.close());
    client.on('close', () => upstreamWs.close());

    client.on('message', (data) => {
      const text = data.toString();
      if (!isBrowser) return toUpstream(text);
      let msg;
      try { msg = JSON.parse(text); } catch { return toUpstream(text); }
      if (!msg.sessionId && msg.method === 'Target.createTarget') {
        openTab(msg.params?.url).then((targetId) => reply(msg.id, { targetId }), (e) => fail(msg.id, e.message));
        return;
      }
      if (!msg.sessionId && msg.method === 'Target.closeTarget') {
        const tab = tabs().find((t) => t.targetId === msg.params?.targetId);
        if (tab) { closeTab(tab.id, { keepOne: false }); return reply(msg.id, { success: true }); }
      }
      if (!msg.sessionId && msg.method === 'Target.getTargets') filterReplies.add(msg.id);
      toUpstream(text);
    });

    upstreamWs.on('message', (data) => {
      const text = data.toString();
      if (!isBrowser) return client.send(text);
      let msg;
      try { msg = JSON.parse(text); } catch { return client.send(text); }
      if (msg.sessionId && hiddenSessions.has(msg.sessionId)) return;
      const info = msg.params?.targetInfo;
      if (info && (hidden.has(info.targetId) || isUi(info))) {
        hidden.add(info.targetId);
        if (msg.method === 'Target.attachedToTarget') hiddenSessions.add(msg.params.sessionId);
        return;
      }
      if (filterReplies.delete(msg.id) && msg.result?.targetInfos) {
        msg.result.targetInfos = msg.result.targetInfos.filter((t) => !hidden.has(t.targetId) && !isUi(t));
        return client.send(JSON.stringify(msg));
      }
      client.send(text);
    });
  }

  server.listen(port, host, () => console.log(`[cdp] front door on ${host}:${port} → ${up}`));
  return server;
}

module.exports = { start, isUi };
