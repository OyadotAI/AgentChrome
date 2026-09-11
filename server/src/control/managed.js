/** Opt-in Docker runtime. The operator supplies an internal-only network containing the control/egress service. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { control, hash, fault } from './service.js';
const exec = promisify(execFile);
const docker = async args => (await exec('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024 })).stdout;
export function managedConfigured() {
  return !!(process.env.OYA_MANAGED_NETWORK && process.env.OYA_MANAGED_IMAGE && process.env.OYA_MANAGED_CONTROL_URL && process.env.OYA_MANAGED_PROXY_URL);
}
export async function verifyRuntime() {
  if (!managedConfigured()) throw fault('runtime_unavailable', 'Configure the managed Docker runtime before requesting governance', 422);
  const network = JSON.parse(await docker(['network', 'inspect', process.env.OYA_MANAGED_NETWORK]))[0];
  if (!network?.Internal || network.Driver !== 'bridge') throw fault('unsafe_network', 'Managed browsers require an internal Docker bridge network', 422);
  const image = JSON.parse(await docker(['image', 'inspect', process.env.OYA_MANAGED_IMAGE]))[0];
  if (image?.Config?.Labels?.['ai.getoya.governance'] !== '1') throw fault('unsupported_image', 'Managed image must contain the governance browser hooks', 422);
  const daemonId = (await docker(['info', '--format', '{{.ID}}'])).trim();
  return { id: 'docker-local', daemonId, networkId: network.Id, imageId: image.Id, region: process.env.OYA_MANAGED_REGION || 'local', capabilities: ['egress', 'persona', 'terminate', 'takeover'], verifiedAt: Date.now() };
}
export async function createManaged({ apiKey, browserId, persona, name, policies = [] }) {
  const runtime = await verifyRuntime();
  for (const policy of policies) if (policy.region && policy.region !== runtime.region) throw fault('region_unavailable', 'Managed runtime does not match the required region', 422);
  const token = randomBytes(32).toString('base64url');
  const container = `oya-managed-${browserId}`;
  const proxy = new URL(process.env.OYA_MANAGED_PROXY_URL);
  if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password) throw fault('invalid_proxy', 'Managed proxy URL must be HTTP(S) without embedded credentials', 422);
  await control().update(apiKey, browserId, { cleanup: { kind: 'docker', container, daemonId: runtime.daemonId }, runtime, egressHash: hash(token), enrollmentHash: hash(token), policies, managed: true });
  // The container never sees the project key: its credential registers only this session and ends with it.
  const credential = await control().enrollmentCredential(apiKey, browserId);
  const environment = {
    OYA_SERVER_URL: process.env.OYA_MANAGED_CONTROL_URL,
    OYA_API_KEY: credential.token, OYA_BROWSER_ID: browserId, OYA_PERSONA: persona,
    OYA_BROWSER_NAME: name || container, OYA_PROVIDER: 'oya-selfhosted', OYA_AUTO_CONNECT: 'true',
    OYA_ENROLLMENT_TOKEN: token,
    OYA_GOVERNANCE: JSON.stringify({ policies, proxy: { type: proxy.protocol === 'https:' ? 'https' : 'http', host: proxy.hostname, port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)), username: browserId, password: token } }),
  };
  // Credentials go on stdin to docker create via an env file, never command-line arguments.
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'oya-runtime-'));
  try {
    const file = join(dir, 'env');
    if (Object.values(environment).some(v => String(v).includes('\n'))) throw fault('invalid_environment', 'Runtime environment must not contain newlines', 400);
    await writeFile(file, Object.entries(environment).map(([k, v]) => `${k}=${v || ''}`).join('\n'), { mode: 0o600 });
    await docker(['create', '--name', container, '--network', runtime.networkId, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '2g', '--shm-size', '512m', '--label', `oya.session=${browserId}`, '--label', `oya.owner=${hash(apiKey)}`, '--env-file', file, runtime.imageId]);
    await docker(['start', container]);
  } finally { await rm(dir, { recursive: true, force: true }); }
  return { browserId, runtime };
}
export async function removeManaged(container, apiKey, browserId, daemonId = null) {
  if (daemonId && (await docker(['info', '--format', '{{.ID}}'])).trim() !== daemonId) throw fault('runtime_unavailable', 'Cleanup requires the original Docker daemon', 503);
  let info;
  try { info = JSON.parse(await docker(['inspect', container]))[0]; }
  catch (e) { if (/No such (object|container)/.test(e.stderr || '')) return; throw e; }
  if (info.Config?.Labels?.['oya.owner'] !== hash(apiKey) || info.Config?.Labels?.['oya.session'] !== browserId) throw fault('ownership_mismatch', 'Managed container ownership mismatch');
  await docker(['rm', '-f', container]);
}
