// api/health.js
import { applyCors, handlePreflight } from '../lib/cors.js';
import { ok } from '../lib/responses.js';
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  let dbOk = false;
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`SELECT 1`;
    dbOk = true;
  } catch (e) {
    console.error('[health] DB failed:', e.message);
  }

  return ok(res, {
    status: 'ok',
    service: 'flamematch-api',
    paystackMode: process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
    database: dbOk ? 'connected' : 'unreachable',
    time: new Date().toISOString()
  });
}
