/** Restartable ownership migration. Existing encrypted profile contexts remain unchanged. */
import { mkdir, readdir, copyFile, cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { control } from './service.js';
import { knownKeys, getKeyOwner } from '../auth.js';
import { db } from '../db.js';
export async function migrateLegacy() {
  const service = control();
  if ((await service.store.get('meta', 'migrations'))?.legacyOwnership === 1) return;
  const directory = process.env.OYA_DATA_DIR || new URL('../../data/', import.meta.url).pathname;
  const backup = join(directory, 'migration-backup-v1');
  await mkdir(backup, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('control.sqlite') || entry.name.startsWith('migration-') || entry.name === 'recordings') continue;
    const source = join(directory, entry.name), destination = join(backup, entry.name);
    if (entry.isDirectory()) await cp(source, destination, { recursive: true, force: false });
    else if (entry.isFile()) await copyFile(source, destination, 1).catch(e => { if (e.code !== 'EEXIST') throw e; });
  }
  const mapping = [];
  // Env keys and the fleet token are the only ones this process holds in the
  // clear; a database key is reached through the project id stored beside its
  // digest, because api_keys no longer keeps the key itself.
  for (const key of knownKeys()) {
    const project = await service.project(key), owner = await getKeyOwner(key);
    if (owner) await service.store.transact(async tx => { (await tx.get('project', project.id)).ownerUser = owner; });
    mapping.push({ project: project.id, legacyOwner: project.legacyOwner });
  }
  if (db) {
    const { data } = await db.from('api_keys').select('project, user_id');
    for (const row of data || []) {
      if (!row.project || !row.user_id) continue;
      await service.store.transact(async tx => {
        const p = await tx.get('project', row.project);
        if (p && !p.ownerUser) p.ownerUser = row.user_id;
      });
      mapping.push({ project: row.project });
    }
  }
  if (db) {
    const { data, error } = await db.from('browsers').select('id, api_key, name');
    if (error) throw new Error('Could not read legacy browser inventory; migration was not marked complete');
    for (const row of data || []) {
      if (!row.api_key || !row.id) continue;
      const project = await service.project(row.api_key);
      await service.store.transact(async tx => {
        if (!(await tx.get('session', row.id))) tx.put('session', row.id, { id: row.id, project: project.id, provider: 'legacy', name: row.name, state: 'disconnected', managed: false, createdAt: Date.now(), updatedAt: Date.now(), costUsd: 0, control: { mode: 'agent' }, fence: 0, leaseUntil: 0, recoveryNote: 'Imported inventory; reconnect or inspect the provider before cleanup' });
      });
    }
  }
  await writeFile(join(backup, 'ownership.json'), JSON.stringify(mapping, null, 2), { mode: 0o600 });
  await service.store.transact(async tx => {
    const migrations = await tx.get('meta', 'migrations');
    tx.put('meta', 'migrations', { ...migrations, id: 'migrations', legacyOwnership: 1 });
  });
}
