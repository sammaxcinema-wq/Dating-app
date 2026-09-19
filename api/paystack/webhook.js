// api/paystack/webhook.js
import { verifyWebhookSignature } from '../../lib/paystack.js';
import { ensureSchema, getPaymentByReference, markPaymentPaid } from '../../lib/db.js';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['x-paystack-signature'];

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn('[webhook] Invalid signature rejected');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); }
    catch { return res.status(400).json({ success: false, message: 'Invalid JSON' }); }

    if (event.event !== 'charge.success') {
      return res.status(200).json({ success: true, message: 'Ignored' });
    }

    const tx = event.data;
    if (!tx?.reference) {
      return res.status(200).json({ success: true, message: 'No reference' });
    }

    await ensureSchema();

    const payment = await getPaymentByReference(tx.reference);
    if (!payment) return res.status(200).json({ success: true, message: 'Payment not found' });

    if (payment.status === 'paid') {
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    if (tx.currency !== payment.currency) {
      return res.status(200).json({ success: true, message: 'Currency mismatch' });
    }

    const expectedSmallest = Math.round(payment.amount * 100);
    if (Number(tx.amount) !== expectedSmallest) {
      return res.status(200).json({ success: true, message: 'Amount mismatch' });
    }

    await markPaymentPaid({
      reference: tx.reference,
      paystackTransactionId: String(tx.id),
      rawWebhook: tx
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[webhook]', e.message);
    return res.status(200).json({ success: false });
  }
}
