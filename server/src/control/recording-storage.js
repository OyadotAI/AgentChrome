/** Private object storage for recordings, with a durable local spool on upload failure. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dbAuth } from '../db.js';
import { control } from './service.js';
const bucket = () => process.env.OYA_RECORDING_BUCKET;
export const sharedRecordings = () => !!(dbAuth && bucket());
const safe = value => /^[0-9a-f-]{36}$/i.test(value);
export async function archiveRecording(manifest, directory) {
  if (!sharedRecordings()) return;
  const { data: info, error: bucketError } = await dbAuth.storage.getBucket(bucket());
  if (bucketError || info.public) throw new Error('Recording archive requires an existing private bucket');
  const prefix = `${manifest.owner}/${manifest.sessionId}`;
  for (const name of await readdir(directory)) {
    if (!/^\d{6}\.jpg$/.test(name) && name !== 'manifest.json') continue;
    const { error } = await dbAuth.storage.from(bucket()).upload(`${prefix}/${name}`, await readFile(join(directory, name)), { upsert: true, contentType: name.endsWith('.jpg') ? 'image/jpeg' : 'application/json' });
    if (error) throw new Error('Recording archive upload failed');
  }
  await control().store.transact(async tx => {
    await tx.get('recording', manifest.sessionId);
    tx.put('recording', manifest.sessionId, { ...manifest, frames: undefined, archived: true });
  });
}
export async function archivedManifest(id, owner) {
  if (!safe(id)) return null;
  const m = await control().store.get('recording', id);
  if (!m || (owner && m.owner !== owner)) return null;
  if (!sharedRecordings()) throw new Error('Recording archive storage unavailable');
  const { data, error } = await dbAuth.storage.from(bucket()).download(`${m.owner}/${id}/manifest.json`);
  if (error) throw new Error('Recording manifest unavailable');
  return JSON.parse(await data.text());
}
export async function archivedFrame(id, index, owner) {
  const m = await archivedManifest(id, owner);
  if (!m || !sharedRecordings()) return null;
  const { data, error } = await dbAuth.storage.from(bucket()).download(`${m.owner}/${id}/${String(index).padStart(6, '0')}.jpg`);
  return error ? null : Buffer.from(await data.arrayBuffer());
}
export async function removeArchive(id, owner) {
  const entry = await control().store.get('recording', id);
  if (!entry || (owner && entry.owner !== owner)) return;
  if (!sharedRecordings()) throw new Error('Recording archive storage unavailable');
  let paths = entry.deletePaths;
  if (!paths) {
    const m = await archivedManifest(id, owner);
    if (!m) return;
    paths = m.frames.map(f => `${m.owner}/${id}/${String(f.i).padStart(6, '0')}.jpg`);
    // Persist the deletion plan before deleting the manifest so a crash can resume.
    await control().store.transact(async tx => { const r = await tx.get('recording', id); if (r) r.deletePaths = paths; });
  }
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await dbAuth.storage.from(bucket()).remove(paths.slice(i, i + 100));
    if (error) throw new Error('Recording archive deletion failed');
  }
  const { error } = await dbAuth.storage.from(bucket()).remove([`${entry.owner}/${id}/manifest.json`]);
  if (error) throw new Error('Recording manifest deletion failed');
  await control().store.transact(async tx => { if (await tx.get('recording', id)) await tx.delete('recording', id); });
}
