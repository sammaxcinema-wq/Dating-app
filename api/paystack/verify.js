// api/paystack/verify.js
import { applyCors, handlePreflight } from '../../lib/cors.js';
import { ok, bad, serverError } from '../../lib/responses.js';
import { verifyTransaction } from '../../lib/paystack.js';
import { ensureSchema, getPaymentByReference, markPaymentPaid, markPaymentFailed } from '../../lib/db.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  let reference;
  if (req.method === 'GET') {
    reference = (req.query.reference || '').toString();
  } else if (req.method === 'POST') {
    reference = (req.body?.reference || '').toString();
  } else {
    return bad(res, 'Method not allowed', 405);
  }

  if (!reference) return bad(res, 'Missing reference');

  try {
    await ensureSchema();

    const payment = await getPaymentByReference(reference);
    if (!payment) return bad(res, 'Payment not found', 404);

    if (payment.status === 'paid') {
      return ok(res, {
        status: 'success',
        message: 'Payment already verified',
        reference,
        plan: payment.plan_id,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paid_at
      });
    }

    const paystackRes = await verifyTransaction(reference);
    const tx = paystackRes?.data;
    if (!tx) return bad(res, 'Transaction not found at Paystack', 404);

    if (tx.status !== 'success') {
      await markPaymentFailed({ reference });
      return bad(res, `Payment not successful (status: ${tx.status})`);
    }

    if (tx.currency !== payment.currency) return bad(res, 'Currency mismatch');

    const expectedSmallest = Math.round(payment.amount * 100);
    if (Number(tx.amount) !== expectedSmallest) return bad(res, 'Amount mismatch — possible tampering');

    const updated = await markPaymentPaid({
      reference,
      paystackTransactionId: String(tx.id),
      rawWebhook: tx
    });

    return ok(res, {
      status: 'success',
      message: 'Payment verified and recorded',
      reference,
      plan: payment.plan_id,
      amount: payment.amount,
      currency: payment.currency,
      paidAt: updated?.paid_at || new Date().toISOString()
    });
  } catch (e) {
    console.error('[paystack/verify]', e.message);
    return serverError(res, 'Verification failed');
  }
}
