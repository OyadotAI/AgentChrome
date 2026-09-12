/**
 * What every fleet runtime has to get right, in one place.
 *
 * A governed browser is handed a session-scoped credential, an enrollment token
 * and egress proxy credentials, and it must never see the project API key. That
 * reasoning is identical whether the container is started by Docker, Kubernetes
 * or ECS, so it lives here rather than being re-derived per runtime — a second
 * copy is a second place for the credential handling to go subtly wrong.
 */

import { randomBytes } from 'node:crypto';
import { control, hash, fault } from '../service.js';

/** The egress proxy the browser is forced through. Credentials are per session. */
export function egressProxy(browserId, token) {
  const proxy = new URL(process.env.OYA_MANAGED_PROXY_URL);
  if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password) {
    throw fault('invalid_proxy', 'Managed proxy URL must be HTTP(S) without embedded credentials', 422);
  }
  return {
    type: proxy.protocol === 'https:' ? 'https' : 'http',
    host: proxy.hostname,
    port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
    username: browserId,
    password: token,
  };
}

/**
 * Claim the session, mint its credential, and return the environment the
 * container gets. The cleanup descriptor is supplied by the runtime because only
 * it knows what has to be torn down, but it is persisted *before* anything is
 * created — a crash between create and start must still leave something
 * deletable.
 */
export async function prepareSession({ apiKey, browserId, persona, name, policies = [], runtime, cleanup, fallbackName }) {
  for (const policy of policies) {
    if (policy.region && policy.region !== runtime.region) {
      throw fault('region_unavailable', 'Managed runtime does not match the required region', 422);
    }
  }
  const token = randomBytes(32).toString('base64url');
  const proxy = egressProxy(browserId, token);

  await control().update(apiKey, browserId, {
    cleanup, runtime, egressHash: hash(token), enrollmentHash: hash(token), policies, managed: true,
  });

  // The container never sees the project key: its credential registers only this
  // session and ends with it.
  const credential = await control().enrollmentCredential(apiKey, browserId);

  const environment = {
    OYA_SERVER_URL: process.env.OYA_MANAGED_CONTROL_URL,
    OYA_API_KEY: credential.token,
    OYA_BROWSER_ID: browserId,
    OYA_PERSONA: persona,
    OYA_BROWSER_NAME: name || fallbackName,
    OYA_PROVIDER: 'oya-selfhosted',
    OYA_AUTO_CONNECT: 'true',
    OYA_ENROLLMENT_TOKEN: token,
    OYA_GOVERNANCE: JSON.stringify({ policies, proxy }),
  };
  // A newline would let a value forge an extra entry in an env file.
  if (Object.values(environment).some((v) => String(v).includes('\n'))) {
    throw fault('invalid_environment', 'Runtime environment must not contain newlines', 400);
  }
  return { token, environment };
}

export { hash, fault };
