import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { control, instanceId } from '../src/control/service.js';
import { ControlStore } from '../src/control/store.js';
import { router } from '../src/api.js';
import { registry } from '../src/connection-registry.js';
import { handleUpgrade } from '../src/gateway.js';
import { startWorkers, stopWorkers } from '../src/control/worker.js';
import { forwardHttp } from '../src/control/cluster.js';
import { handleMcpRequest } from '../src/mcp-server.js';
await control().store.close();
control().store = new ControlStore({ remote: { async rpc(name, args) { return (await fetch(process.env.OYA_TEST_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) })).json(); } } });
const app = express(); app.use(express.json()); app.use('/api', router);
app.use('/mcp', express.json(), forwardHttp); app.post('/mcp/:browserId', handleMcpRequest);
const server = createServer(app), upstream = new WebSocketServer({ noServer: true });
upstream.on('connection', ws => ws.on('message', raw => { const request = JSON.parse(raw); ws.send(JSON.stringify({ id: request.id, result: { owner: instanceId } })); }));
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/fixture') return upstream.handleUpgrade(req, socket, head, ws => upstream.emit('connection', ws));
  void handleUpgrade(req, socket, head).catch(() => socket.destroy());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
process.env.OYA_INSTANCE_URL = url;
await startWorkers();
process.send({ type: 'ready', url });
process.on('message', async msg => {
  if (msg.type === 'seed') {
    await control().adopt('cluster-owner', { id: msg.id, provider: 'cdp' });
    registry.add(msg.id, { apiKey: 'cluster-owner', name: 'Cluster fixture', clientType: 'cdp', provider: 'cdp', driver: { wsUrl: url.replace('http:', 'ws:') + '/fixture', send: async () => ({ ok: true, data: { owner: instanceId } }), close() {} } });
    process.send({ type: 'seeded' });
  }
});
process.on('SIGTERM', async () => { await stopWorkers(); server.closeAllConnections(); server.close(); process.exit(0); });
