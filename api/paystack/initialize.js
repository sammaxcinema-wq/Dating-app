// api/paystack/initialize.js
import { applyCors, handlePreflight } from '../../lib/cors.js';
import { ok, bad, serverError } from '../../lib/responses.js';
import { initializeTransaction } from '../../lib/paystack.js';
import { ensureSchema, createPayment } from '../../lib/db.js';
import { randomUUID } from 'crypto';

const PLANS = {
  silver:   { id: 'silver',   name: 'Silver',   amount: 299, currency: 'KES' },
  gold:     { id: 'gold',     name: 'Gold',     amount: 499, currency: 'KES' },
  platinum: { id: 'platinum', name: 'Platinum', amount: 999, currency: 'KES' }
};

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== 'POST') return bad(res, 'Method not allowed', 405);

  try {
    await ensureSchema();

    const { email, planId, amount, reference: clientRef, callbackUrl, name, age, country } = req.body || {};

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return bad(res, 'Valid email required');
    }

    let finalAmount, currency, planName;
    if (planId) {
      const plan = PLANS[planId];
      if (!plan) return bad(res, 'Invalid plan');
      finalAmount = plan.amount;
      currency = plan.currency;
      planName = plan.name;
    } else if (typeof amount === 'number' && amount > 0) {
      finalAmount = Math.round(amount);
      currency = 'KES';
      planName = 'Custom';
    } else {
      return bad(res, 'planId or valid amount required');
    }

    const reference = clientRef || `FM-${planId || 'custom'}-${randomUUID()}`;
    const amountSmallest = Math.round(finalAmount * 100);

    await createPayment({
      reference,
      email: email.toLowerCase(),
      amount: finalAmount,
      currency,
      planId: planId || null
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const paystackRes = await initializeTransaction({
      email: email.toLowerCase(),
      amountSmallest,
      reference,
      currency,
      metadata: {
        planId: planId || null,
        planName,
        customerName: name || null,
        customerAge: age || null,
        customerCountry: country || null,
        callback_url: callbackUrl || appUrl
      }
    });

    if (!paystackRes?.status || !paystackRes?.data?.authorization_url) {
      return serverError(res, 'Unable to initialize payment');
    }

    return ok(res, {
      reference,
      authorization_url: paystackRes.data.authorization_url,
      access_code: paystackRes.data.access_code,
      plan: { id: planId || 'custom', name: planName, amount: finalAmount, currency }
    });
  } catch (e) {
    console.error('[paystack/initialize]', e.message);
    return serverError(res, 'Unable to initialize payment');
  }
}
