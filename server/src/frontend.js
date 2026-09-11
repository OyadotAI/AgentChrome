/** Run the standard Next.js server behind the API's single public port. */
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export function startFrontend() {
  const mode = process.env.OYA_UI_MODE;
  if (!mode) return null; // API-only deployments and integration tests
  if (!['development', 'production'].includes(mode)) throw new Error('OYA_UI_MODE must be development or production');
  const uiDir = fileURLToPath(new URL('../../ui/', import.meta.url));
  const port = Number(process.env.OYA_UI_PORT || Number(process.env.PORT || 3100) + 1);
  const entry = mode === 'development'
    ? join(uiDir, 'node_modules/next/dist/bin/next')
    : join(uiDir, '.next/standalone/server.js');
  if (!existsSync(entry)) throw new Error('Next.js is missing. Run npm run setup, then npm run build for production.');
  const child = spawn(process.execPath, [entry, ...(mode === 'development' ? ['dev', uiDir, '--hostname', '127.0.0.1', '--port', String(port)] : [])], {
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: mode },
    stdio: 'inherit',
  });
  let stopping = false;
  const stop = () => { stopping = true; child.kill('SIGTERM'); };
  process.once('exit', stop);
  child.once('error', (err) => { console.error('[next]', err.message); process.kill(process.pid, 'SIGTERM'); });
  child.once('exit', () => {
    if (!stopping) { console.error('[next] Frontend exited; shutting down'); process.exitCode = 1; process.kill(process.pid, 'SIGTERM'); }
  });
  return {
    stop,
    handle(req, res) {
      const upstream = request({ hostname: '127.0.0.1', port, path: req.originalUrl, method: req.method, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
        response.on('error', () => res.destroy());
      });
      upstream.on('error', () => {
        if (res.headersSent) return res.destroy();
        res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '2' });
        res.end('Oya is starting. Please retry in a moment.\n');
      });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream); // Preserve streaming, RSC headers and Server Action bodies.
    },
    upgrade(req, socket, head) {
      if (!req.url.startsWith('/_next/')) return false;
      const upstream = connect(port, '127.0.0.1', () => {
        upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
        for (let i = 0; i < req.rawHeaders.length; i += 2) upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
        upstream.write('\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
      return true;
    },
  };
}
