import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { userAuthMiddleware } from '../auth.js';
import { control, hash, fault, projectId } from './service.js';
import { openText } from '../secrets.js';
export const projectAccountRouter = Router();
projectAccountRouter.use(userAuthMiddleware);
const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
projectAccountRouter.get('/', wrap(async (req, res) => {
  // Projects index their owner and memberships index their user, so this never scans other tenants.
  const [owned, joined] = await control().store.load([{ kind: 'project', states: [req.user.id] }, { kind: 'membership', states: [req.user.id] }]);
  const ownedIds = new Set(owned.map(r => r.id)), memberships = joined.map(r => r.body).filter(m => !ownedIds.has(m.project));
  const names = new Map((await control().store.load(memberships.map(m => ({ kind: 'project', id: m.project })))).flat().map(r => [r.id, r.body.name]));
  res.json([
    ...owned.map(r => ({ id: r.id, name: r.body.name, role: 'administrator' })),
    ...memberships.filter(m => names.has(m.project)).map(m => ({ id: m.project, name: names.get(m.project), role: m.role })),
  ]);
}));
projectAccountRouter.post('/join', wrap(async (req, res) => {
  const digest = hash(String(req.body?.code || ''));
  const membership = await control().store.transact(async tx => {
    const invite = await tx.get('invite', digest);
    if (!invite || invite.expiresAt < Date.now()) throw fault('invalid_invite', 'Invitation expired or already used', 404);
    await tx.delete('invite', digest);
    const id = `${invite.project}:${req.user.id}`;
    await tx.get('membership', id);
    const membership = tx.put('membership', id, { id, project: invite.project, userId: req.user.id, role: invite.role });
    tx.emit(invite.project, 'member.joined', null, { userId: req.user.id, role: invite.role });
    return membership;
  });
  res.json(membership);
}));
projectAccountRouter.post('/:id/access', wrap(async (req, res) => {
  const [[p], [m]] = await control().store.load([{ kind: 'project', id: req.params.id }, { kind: 'membership', id: `${req.params.id}:${req.user.id}` }]);
  const role = p?.body.ownerUser === req.user.id ? 'administrator' : m?.body.role;
  if (!p || !role) throw fault('not_found', 'Project not found', 404);
  const key = openText(`control:${p.id}`, p.body.key);
  res.json(await control().credential(key, { role, label: 'Console access', expiresAt: Date.now() + 3600000 }, req.user.id));
}));
projectAccountRouter.use((e, req, res, next) => res.status(e.status || 503).json({ error: e.message }));
export async function inviteMember(key, role) {
  if (!['viewer', 'operator', 'administrator'].includes(role)) throw fault('invalid_role', 'Unknown role', 400);
  const code = randomBytes(24).toString('base64url');
  await control().store.transact(async tx => {
    tx.put('invite', hash(code), { project: projectId(key), role, expiresAt: Date.now() + 7 * 86400000 });
    tx.emit(projectId(key), 'member.invited', null, { role });
  });
  return { code, expiresIn: 604800 };
}
export async function removeMember(key, userId) {
  await control().store.transact(async tx => {
    const project = projectId(key), id = `${project}:${userId}`;
    if ((await tx.get('project', project))?.ownerUser === userId) throw fault('owner_required', 'The project owner cannot be removed');
    if (await tx.get('membership', id)) await tx.delete('membership', id);
    for (const c of await tx.list('credential', { project })) if (c.memberUser === userId && !c.revokedAt) c.revokedAt = Date.now();
    tx.emit(project, 'member.removed', null, { userId });
  });
  return { ok: true };
}
