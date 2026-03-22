/**
 * Shared Supabase client for the oya_browser schema.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

/** Supabase client scoped to oya_browser schema (or null if not configured) */
export const db = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, { db: { schema: 'oya_browser' } })
  : null;

/** Supabase client using default (public) schema — for auth operations */
export const dbAuth = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

if (db) console.log('[db] Supabase connected');
else console.warn('[db] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — running without database');
