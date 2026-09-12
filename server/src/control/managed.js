/**
 * The governed fleet, whichever runtime provides it.
 *
 * Docker, Kubernetes and (later) ECS all sit behind the provider id
 * `oya-selfhosted`: the runtime differs, the provider does not. That is what
 * keeps api.js's dispatch, PROVIDER_CHOICES, the SDK's Provider union and the
 * governance gate in service.js unchanged — they ask for a governed browser and
 * this module decides what starts one.
 *
 * Select with OYA_FLEET_RUNTIME=docker|k8s (default docker).
 */

import * as docker from './fleet/docker.js';
import * as k8s from './fleet/k8s.js';

const RUNTIMES = { docker, k8s };

function runtimeFor(name) {
  const chosen = RUNTIMES[name || process.env.OYA_FLEET_RUNTIME || 'docker'];
  if (!chosen) {
    const known = Object.keys(RUNTIMES).join(', ');
    throw Object.assign(new Error(`Unknown OYA_FLEET_RUNTIME "${process.env.OYA_FLEET_RUNTIME}" (known: ${known})`),
      { code: 'runtime_unavailable', status: 422 });
  }
  return chosen;
}

export function managedConfigured() {
  try { return runtimeFor().configured(); } catch { return false; }
}

export function verifyRuntime() {
  return runtimeFor().verifyRuntime();
}

export function createManaged(options) {
  return runtimeFor().create(options);
}

/**
 * Cleanup follows the descriptor that was stored when the session was created,
 * not whatever OYA_FLEET_RUNTIME says now: a browser started on Docker must still
 * be torn down on Docker after the operator moves the fleet to Kubernetes, and
 * a pod started in one namespace must be deleted from that namespace, not from
 * whatever OYA_K8S_NAMESPACE points at today.
 * Descriptors written before runtimes existed carry no `runtime` and are Docker.
 */
export function removeManaged(container, apiKey, browserId, daemonId = null, runtime = 'docker', namespace = null) {
  return runtimeFor(runtime).remove(container, apiKey, browserId, daemonId, namespace);
}
