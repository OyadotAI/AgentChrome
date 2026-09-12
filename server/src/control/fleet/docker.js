/**
 * Docker fleet runtime: one container per session, on a Docker daemon this
 * process can reach. The operator supplies an internal-only network containing
 * the control/egress service — nothing here punches a hole in it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareSession, hash, fault } from './common.js';

const exec = promisify(execFile);
const docker = async (args) => (await exec('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024 })).stdout;

export const id = 'docker';

export function configured() {
  return !!(process.env.OYA_MANAGED_NETWORK && process.env.OYA_MANAGED_IMAGE
    && process.env.OYA_MANAGED_CONTROL_URL && process.env.OYA_MANAGED_PROXY_URL);
}

export async function verifyRuntime() {
  if (!configured()) throw fault('runtime_unavailable', 'Configure the managed Docker runtime before requesting governance', 422);
  const network = JSON.parse(await docker(['network', 'inspect', process.env.OYA_MANAGED_NETWORK]))[0];
  if (!network?.Internal || network.Driver !== 'bridge') throw fault('unsafe_network', 'Managed browsers require an internal Docker bridge network', 422);
  const image = JSON.parse(await docker(['image', 'inspect', process.env.OYA_MANAGED_IMAGE]))[0];
  if (image?.Config?.Labels?.['ai.getoya.governance'] !== '1') throw fault('unsupported_image', 'Managed image must contain the governance browser hooks', 422);
  const daemonId = (await docker(['info', '--format', '{{.ID}}'])).trim();
  return {
    id: 'docker-local', daemonId, networkId: network.Id, imageId: image.Id,
    region: process.env.OYA_MANAGED_REGION || 'local',
    capabilities: ['egress', 'persona', 'terminate', 'takeover'], verifiedAt: Date.now(),
  };
}

export async function create({ apiKey, browserId, persona, name, policies = [] }) {
  const runtime = await verifyRuntime();
  const container = `oya-managed-${browserId}`;
  const { environment } = await prepareSession({
    apiKey, browserId, persona, name, policies, runtime, fallbackName: container,
    // `runtime` is carried so cleanup still targets Docker after an operator
    // switches OYA_FLEET_RUNTIME; the kind stays 'docker' so sessions created by
    // earlier versions keep being collected.
    cleanup: { kind: 'docker', runtime: 'docker', container, daemonId: runtime.daemonId },
  });

  // Credentials go to docker create through an env file, never command-line arguments.
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'oya-runtime-'));
  try {
    const file = join(dir, 'env');
    await writeFile(file, Object.entries(environment).map(([k, v]) => `${k}=${v || ''}`).join('\n'), { mode: 0o600 });
    await docker(['create', '--name', container, '--network', runtime.networkId,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256',
      '--memory', '2g', '--shm-size', '512m',
      '--label', `oya.session=${browserId}`, '--label', `oya.owner=${hash(apiKey)}`,
      '--env-file', file, runtime.imageId]);
    await docker(['start', container]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { browserId, runtime };
}

export async function remove(container, apiKey, browserId, daemonId = null) {
  if (daemonId && (await docker(['info', '--format', '{{.ID}}'])).trim() !== daemonId) {
    throw fault('runtime_unavailable', 'Cleanup requires the original Docker daemon', 503);
  }
  let info;
  try { info = JSON.parse(await docker(['inspect', container]))[0]; }
  catch (e) { if (/No such (object|container)/.test(e.stderr || '')) return; throw e; }
  if (info.Config?.Labels?.['oya.owner'] !== hash(apiKey) || info.Config?.Labels?.['oya.session'] !== browserId) {
    throw fault('ownership_mismatch', 'Managed container ownership mismatch');
  }
  await docker(['rm', '-f', container]);
}
