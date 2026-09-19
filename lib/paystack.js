// lib/paystack.js
import crypto from 'crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !key.startsWith('sk_')) {
    throw new Error('PAYSTACK_SECRET_KEY missing or invalid');
  }
  return key;
}

async function paystackRequest(path, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    let data = null;
    try { data = await res.json(); } catch { }
    if (!res.ok) throw new Error(data?.message || `Paystack ${res.status}`);
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function initializeTransaction({ email, amountSmallest, reference, currency, metadata }) {
  return paystackRequest('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: amountSmallest,
      reference,
      currency,
      metadata,
      callback_url: metadata?.callback_url
    })
  });
}

export async function verifyTransaction(reference) {
  return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
}

export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const hash = crypto.createHmac('sha512', getSecretKey()).update(rawBody).digest('hex');
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
