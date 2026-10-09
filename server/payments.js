import crypto from 'node:crypto';
import { fail } from './util.js';

// Stripe card payments are optional: they switch on when STRIPE_SECRET_KEY is
// set. Without it, members pay through local methods (Click, Payme, Uzcard,
// Humo, bank transfer) and the owner confirms each payment in the dashboard.

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

export const stripeEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

export function minorUnits(amount, currency) {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}

export async function createStripeCheckout({ paymentId, planName, amount, currency, email, baseUrl }) {
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(minorUnits(amount, currency)),
    'line_items[0][price_data][product_data][name]': planName,
    customer_email: email,
    client_reference_id: String(paymentId),
    'metadata[payment_id]': String(paymentId),
    success_url: `${baseUrl}/#/billing?paid=1`,
    cancel_url: `${baseUrl}/#/billing?cancelled=1`,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) fail(502, 'payment_provider_error', data?.error?.message);
  return { id: data.id, url: data.url };
}

// Verifies the Stripe-Signature header (t=...,v1=...) over the raw body.
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const given = String(parts.v1 || '');
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
