import { control } from './service.js';
import { registry } from '../connection-registry.js';
import { QUOTAS } from '../limits.js';
import * as personas from '../personas.js';
import * as keyConfig from '../key-config.js';

/** Persist a reservation before invoking any external provider. */
export function admission(defaultProvider) {
  return async (req, res, next) => {
    const key = req.headers.authorization.slice(7);
    try {
      if (registry.draining) return res.status(503).json({ error: 'Server is draining', code: 'draining' });
      const provider = req.body?.provider || defaultProvider || keyConfig.providerFor(key);
      const persona = req.path.endsWith('/start') ? personas.resolve(key, req.body?.profile || req.body?.persona) : null;
      const reservation = await control().reserve(key, {
        provider, inheritedPolicies: req.recoveryPolicies || [], persona: persona?.id, personaLimit: persona?.maxConcurrent,
        maxConcurrent: QUOTAS.browsers, hourlyLimit: QUOTAS.sandboxesPerHour,
        request: req.body || {}, idempotencyKey: req.get('Idempotency-Key'),
        managed: provider === 'oya-cloud' || provider === 'oya-selfhosted',
      });
      if (reservation.replay) {
        if (reservation.response) {
          const body = structuredClone(reservation.response.body);
          if (body.cdpUrl) { const url = new URL(body.cdpUrl); url.searchParams.set('ticket', await control().ticket(key, reservation.id, req.authToken || key)); url.searchParams.delete('token'); body.cdpUrl = url.href; }
          return res.status(reservation.response.status).json(body);
        }
        return res.status(202).json({ id: reservation.id, operationId: reservation.id, provider: reservation.provider, persona: reservation.persona, status: 'starting', state: reservation.state });
      }
      if (reservation.state === 'queued') return res.status(202).json({ id: reservation.id, operationId: reservation.id, provider, persona: persona?.id, status: 'starting', state: 'queued' });
      req.controlSession = reservation;
      if (persona) req.body = { ...req.body, persona: persona.id, profile: persona.id };
      const json = res.json.bind(res);
      res.json = body => {
        control().complete(key, reservation.id, res.statusCode, body).then(() => json(body)).catch(() => {
          res.statusCode = 503;
          json({ error: 'Could not persist operation outcome', code: 'storage_unavailable', operationId: reservation.id });
        });
        return res;
      };
      next();
    } catch (err) { res.status(err.status || 503).json({ error: err.message, code: err.code }); }
  };
}
