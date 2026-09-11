/** Route attachments to their leased owner. Forwarded requests keep the original credential and scope. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { control, instanceId, projectId, fault, terminal } from './service.js';
import { authenticateToken } from '../auth.js';
const bridge = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
function signature(timestamp, method, path) {
  if (!process.env.OYA_CLUSTER_SECRET) throw fault('cluster_unconfigured', 'Cross-replica routing requires OYA_CLUSTER_SECRET', 503);
  return createHmac('sha256', process.env.OYA_CLUSTER_SECRET).update(`${timestamp}:${method}:${path}`).digest('hex');
}
function verifyHop(req) {
  const hop = req.headers['x-oya-hop'];
  if (!hop) return;
  const [timestamp, supplied] = String(hop).split('.');
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 30000) throw fault('invalid_hop', 'Expired cluster request', 403);
  const expected = signature(timestamp, req.method, req.originalUrl || req.url);
  const a = Buffer.from(supplied || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw fault('invalid_hop', 'Invalid cluster request', 403);
}
/** This replica's routable origin, or null when it runs alone. */
export function clusterOrigin() {
  if (!process.env.OYA_INSTANCE_URL) return null;
  const url = new URL(process.env.OYA_INSTANCE_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !process.env.OYA_CLUSTER_SECRET) throw new Error('Instance routing requires an HTTP(S) URL and cluster secret');
  return url.origin;
}
export async function ownerFor(id, key) {
  const [[session], [attachment]] = await control().store.load([{ kind: 'session', id }, { kind: 'attachment', id }]);
  const s = session?.body || attachment?.body;
  // Terminal or orphaned sessions (for example, owned by a replaced process) are served from durable state wherever the request lands.
  if (!s || s.project !== projectId(key) || s.instance === instanceId || terminal.has(s.state) || s.leaseUntil < Date.now()) return null;
  const owner = await control().store.get('instance', s.instance);
  return owner?.url && owner.leaseUntil >= Date.now() ? owner : null;
}
// Targets that live in one replica's memory: connected browsers, live streams, gateway sessions, and per-browser MCP.
const OWNED = /^\/(?:api\/(?:browsers|live|control\/sessions|gateway\/sessions)|mcp)\/([a-zA-Z0-9-]+)(?:\/|$)/;
const COLLECTIONS = ['start', 'stop', 'connect', 'provision', 'disconnect-all', 'pool'];
// MCP streamable HTTP carries its session and resumption state in headers, in both directions.
const FORWARD_HEADERS = ['accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
const RETURN_HEADERS = ['content-type', 'cache-control', 'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'mcp-session-id'];
export async function forwardHttp(req, res, next) {
  const match = (req.baseUrl + req.path).match(OWNED);
  if (!match || COLLECTIONS.includes(match[1])) return next();
  try {
    verifyHop(req);
    let token = req.authToken || req.headers.authorization?.slice(7) || req.query.key;
    if (!token && req.query.ticket) { token = await control().redeem(String(req.query.ticket), match[1]); req.authToken = token; }
    // A lone replica owns everything; skip the ownership lookup.
    if (!process.env.OYA_INSTANCE_URL) return next();
    const principal = await authenticateToken(token);
    const owner = await ownerFor(match[1], principal.key);
    if (!owner) return next();
    if (req.headers['x-oya-hop']) throw fault('owner_changed', 'Session ownership changed; retry the request', 503);
    const path = req.originalUrl || req.url, timestamp = String(Date.now());
    const target = new URL(owner.url); const parsed = new URL(path, 'http://local'); target.pathname = parsed.pathname; target.search = parsed.search;
    target.searchParams.delete('key'); target.searchParams.delete('ticket');
    const targetPath = target.pathname + target.search;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Oya-Hop': `${timestamp}.${signature(timestamp, req.method, targetPath)}` };
    for (const name of FORWARD_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
    // Bound the wait for the owner's response headers, not the life of a stream such as SSE.
    const abort = new AbortController(), headerTimeout = setTimeout(() => abort.abort(), 180000);
    res.on('close', () => abort.abort());
    const response = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}), redirect: 'error', signal: abort.signal }).finally(() => clearTimeout(headerTimeout));
    res.status(response.status);
    for (const header of RETURN_HEADERS) if (response.headers.has(header)) res.set(header, response.headers.get(header));
    res.flushHeaders();
    if (response.body) Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res); else res.end();
  } catch (e) { if (!res.headersSent) res.status(e.status || 503).json({ error: e.message, code: e.code || 'owner_unavailable' }); else res.destroy(); }
}
export async function forwardGateway(req, socket, head, token, key, id) {
  if (!process.env.OYA_INSTANCE_URL) return false;
  verifyHop(req);
  const owner = await ownerFor(id, key);
  if (!owner) return false;
  if (req.headers['x-oya-hop']) throw fault('owner_changed', 'Session ownership changed', 503);
  const target = new URL(owner.url); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  const requested = new URL(req.url, 'http://local'); target.pathname = requested.pathname; target.search = requested.search;
  target.searchParams.delete('ticket'); target.searchParams.delete('token');
  const timestamp = String(Date.now()), path = target.pathname + target.search;
  const upstream = new WebSocket(target, { headers: { Authorization: `Bearer ${token}`, 'X-Oya-Hop': `${timestamp}.${signature(timestamp, 'GET', path)}` }, handshakeTimeout: 10000, maxPayload: 256 * 1024 * 1024 });
  socket.once('close', () => upstream.terminate());
  upstream.once('error', () => { if (!socket.destroyed) socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); });
  upstream.once('open', () => bridge.handleUpgrade(req, socket, head, client => {
    upstream.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
    client.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
    client.on('close', () => upstream.close()); upstream.on('close', () => client.close(1001, 'Session connection ended'));
    client.on('error', () => upstream.terminate());
  }));
  return true;
}
/** Advertise this replica's origin. Renews well before expiry so idle heartbeats write nothing; maintenance forgets processes gone a day. */
export async function heartbeatInstance(tx) {
  const origin = clusterOrigin();
  if (!origin) return;
  const now = Date.now(), current = await tx.get('instance', instanceId);
  if (current?.url !== origin || current.leaseUntil < now + 20000) tx.put('instance', instanceId, { id: instanceId, url: origin, leaseUntil: now + 30000 });
}
