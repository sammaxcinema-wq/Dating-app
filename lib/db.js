// lib/db.js
import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

let _migrated = false;
export async function ensureSchema() {
  if (_migrated) return;
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reference TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'KES',
      status TEXT NOT NULL DEFAULT 'pending',
      plan_id TEXT,
      paystack_transaction_id TEXT,
      paid_at TIMESTAMPTZ,
      raw_webhook JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_payments_email ON payments(email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`;
  _migrated = true;
}

export async function createPayment({ reference, email, amount, currency, planId }) {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO payments (reference, email, amount, currency, status, plan_id)
    VALUES (${reference}, ${email}, ${amount}, ${currency}, 'pending', ${planId || null})
    RETURNING id, reference, email, amount, currency, status, created_at
  `;
  return rows[0];
}

export async function getPaymentByReference(reference) {
  const sql = getDb();
  const rows = await sql`SELECT * FROM payments WHERE reference = ${reference} LIMIT 1`;
  return rows[0] || null;
}

export async function markPaymentPaid({ reference, paystackTransactionId, rawWebhook }) {
  const sql = getDb();
  const rows = await sql`
    UPDATE payments
    SET status = 'paid',
        paystack_transaction_id = ${paystackTransactionId || null},
        paid_at = NOW(),
        raw_webhook = ${rawWebhook ? JSON.stringify(rawWebhook) : null}::jsonb,
        updated_at = NOW()
    WHERE reference = ${reference} AND status <> 'paid'
    RETURNING *
  `;
  return rows[0] || null;
}

export async function markPaymentFailed({ reference }) {
  const sql = getDb();
  const rows = await sql`
    UPDATE payments
    SET status = 'failed', updated_at = NOW()
    WHERE reference = ${reference} AND status = 'pending'
    RETURNING *
  `;
  return rows[0] || null;
}
