/**
 * Kubernetes fleet runtime: one pod per session.
 *
 * The Docker runtime proves its image carries the governance hooks by reading the
 * ai.getoya.governance label off a local image. kubectl cannot do that — the image
 * lives in a registry and is resolved by the kubelet, not by us. So this runtime
 * demands the stronger, locally checkable property instead: the image reference
 * must be pinned to a digest. A tag can be moved under you between verification
 * and scheduling; a digest cannot.
 *
 * Isolation is a NetworkPolicy the operator supplies, standing in for Docker's
 * internal bridge: we require it to exist and to actually select these pods,
 * because a policy that matches nothing is indistinguishable from no policy.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepareSession, hash, fault } from './common.js';

export const id = 'k8s';

const namespace = () => process.env.OYA_K8S_NAMESPACE || 'oya-browsers';
const POD_LABEL = 'oya-managed-browser';

/**
 * Manifests go in on stdin, so no credential ever appears in argv (where `ps`
 * would show it). execFile cannot write stdin, hence spawn.
 */
function kubectl(args, stdin = null) {
  const base = process.env.OYA_K8S_CONTEXT ? ['--context', process.env.OYA_K8S_CONTEXT] : [];
  return new Promise((resolve, reject) => {
    const child = spawn('kubectl', [...base, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(Object.assign(e, { stderr: err })));
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Object.assign(new Error('kubectl timed out'), { stderr: err })); }, 30000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(Object.assign(new Error(err.trim() || `kubectl exited ${code}`), { stderr: err, code }));
    });
    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/** Pod names are DNS-1123 labels: lowercase alphanumeric and '-', at most 63 chars. */
export function podName(browserId) {
  const slug = String(browserId).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  const candidate = `oya-managed-${slug}`;
  if (candidate.length <= 63) return candidate;
  // Truncating alone could collide, so the tail is a digest of the real id.
  const digest = createHash('sha256').update(String(browserId)).digest('hex').slice(0, 12);
  return `${candidate.slice(0, 50)}-${digest}`;
}

export function configured() {
  return !!(process.env.OYA_MANAGED_NETWORK && process.env.OYA_MANAGED_IMAGE
    && process.env.OYA_MANAGED_CONTROL_URL && process.env.OYA_MANAGED_PROXY_URL);
}

export async function verifyRuntime() {
  if (!configured()) throw fault('runtime_unavailable', 'Configure the managed Kubernetes runtime before requesting governance', 422);
  const image = process.env.OYA_MANAGED_IMAGE;
  if (!/@sha256:[0-9a-f]{64}$/.test(image)) {
    throw fault('unsupported_image', 'On Kubernetes OYA_MANAGED_IMAGE must be pinned to a digest (image@sha256:…), so the governed image cannot be swapped after verification', 422);
  }

  const ns = namespace();
  try { await kubectl(['get', 'namespace', ns, '-o', 'name']); }
  catch (e) { throw fault('runtime_unavailable', `Namespace ${ns} is not reachable: ${e.message}`, 422); }

  // The NetworkPolicy is the only thing keeping a governed browser off the rest
  // of the cluster, so an absent or non-selecting policy is a hard failure.
  let policy;
  try { policy = JSON.parse(await kubectl(['get', 'networkpolicy', process.env.OYA_MANAGED_NETWORK, '-n', ns, '-o', 'json'])); }
  catch { throw fault('unsafe_network', `NetworkPolicy ${process.env.OYA_MANAGED_NETWORK} not found in ${ns}; managed browsers require egress restriction`, 422); }
  const selector = policy?.spec?.podSelector?.matchLabels || {};
  const selectsAll = Object.keys(selector).length === 0;
  if (!selectsAll && selector.app !== POD_LABEL) {
    throw fault('unsafe_network', `NetworkPolicy ${process.env.OYA_MANAGED_NETWORK} does not select app=${POD_LABEL} pods`, 422);
  }
  if (!(policy.spec.policyTypes || []).includes('Egress')) {
    throw fault('unsafe_network', `NetworkPolicy ${process.env.OYA_MANAGED_NETWORK} must restrict Egress`, 422);
  }

  // The cluster's identity, so cleanup cannot be aimed at a different cluster
  // that happens to have a pod of the same name. kube-system's UID is stable.
  const clusterId = (await kubectl(['get', 'namespace', 'kube-system', '-o', 'jsonpath={.metadata.uid}'])).trim();
  return {
    id: 'k8s', daemonId: clusterId, networkId: process.env.OYA_MANAGED_NETWORK, imageId: image,
    region: process.env.OYA_MANAGED_REGION || ns,
    capabilities: ['egress', 'persona', 'terminate', 'takeover'], verifiedAt: Date.now(),
  };
}

/** Secret carries the credentials; the pod only references it. */
function manifests({ pod, ns, image, apiKey, browserId, environment }) {
  const owner = hash(apiKey);
  const common = {
    namespace: ns,
    labels: {
      app: POD_LABEL,
      // Label values cap at 63 characters and the owner hash is 64, so the label
      // is for selection only; ownership is verified against the annotation.
      'oya.owner': owner.slice(0, 63),
      'oya.session': podName(browserId).slice(0, 63),
    },
    annotations: { 'ai.getoya.owner': owner, 'ai.getoya.session': String(browserId) },
  };
  return [
    {
      apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
      metadata: { name: `${pod}-enroll`, ...common },
      stringData: Object.fromEntries(Object.entries(environment).map(([k, v]) => [k, String(v ?? '')])),
    },
    {
      apiVersion: 'v1', kind: 'Pod',
      metadata: { name: pod, ...common },
      spec: {
        // A spent enrollment token cannot enrol twice, so a restart would just
        // produce a pod that never connects.
        restartPolicy: 'Never',
        // A browser has no business holding a Kubernetes API token.
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        volumes: [{ name: 'dev-shm', emptyDir: { medium: 'Memory', sizeLimit: '512Mi' } }],
        containers: [{
          name: 'browser',
          image,
          envFrom: [{ secretRef: { name: `${pod}-enroll` } }],
          volumeMounts: [{ name: 'dev-shm', mountPath: '/dev/shm' }],
          resources: { requests: { memory: '512Mi', cpu: '250m' }, limits: { memory: '2Gi' } },
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'] },
            seccompProfile: { type: 'RuntimeDefault' },
          },
        }],
      },
    },
  ];
}

export async function create({ apiKey, browserId, persona, name, policies = [] }) {
  const runtime = await verifyRuntime();
  const ns = namespace();
  const pod = podName(browserId);
  const { environment } = await prepareSession({
    apiKey, browserId, persona, name, policies, runtime, fallbackName: pod,
    cleanup: { kind: 'docker', runtime: 'k8s', container: pod, namespace: ns, daemonId: runtime.daemonId },
  });

  const docs = manifests({ pod, ns, image: runtime.imageId, apiKey, browserId, environment });
  await kubectl(['apply', '-n', ns, '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'List', items: docs }));
  return { browserId, runtime };
}

export async function remove(pod, apiKey, browserId, clusterId = null) {
  const ns = namespace();
  if (clusterId) {
    const current = (await kubectl(['get', 'namespace', 'kube-system', '-o', 'jsonpath={.metadata.uid}'])).trim();
    if (current !== clusterId) throw fault('runtime_unavailable', 'Cleanup requires the original Kubernetes cluster', 503);
  }
  let info;
  try { info = JSON.parse(await kubectl(['get', 'pod', pod, '-n', ns, '-o', 'json'])); }
  catch (e) {
    if (/NotFound|not found/i.test(e.stderr || e.message)) {
      // The pod is gone; its Secret must not outlive it.
      await kubectl(['delete', 'secret', `${pod}-enroll`, '-n', ns, '--ignore-not-found']).catch(() => {});
      return;
    }
    throw e;
  }
  const annotations = info?.metadata?.annotations || {};
  if (annotations['ai.getoya.owner'] !== hash(apiKey) || annotations['ai.getoya.session'] !== String(browserId)) {
    throw fault('ownership_mismatch', 'Managed pod ownership mismatch');
  }
  await kubectl(['delete', 'pod', pod, 'secret', `${pod}-enroll`, '-n', ns, '--ignore-not-found', '--wait=false']);
}
