const IntaSend = require("intasend-node");
const prisma = require("../lib/prisma");
const adminSettings = require("./adminSettings");

const intasend = new IntaSend(
  process.env.INTASEND_PUBLISHABLE_KEY,
  process.env.INTASEND_SECRET_KEY,
  process.env.INTASEND_ENV !== "production" // true = sandbox/test mode
);

/**
 * Kicks off an M-Pesa STK push via IntaSend for the current unlock price
 * (set via the admin panel — see adminSettings.js). If the admin has set
 * the price to 0 ("free"), this skips IntaSend entirely and just records
 * an already-successful $0 payment, since there's nothing to charge.
 * @param {number} jackpotId
 * @param {string} phoneNumber - format 2547XXXXXXXX
 */
async function initiateStkPush(jackpotId, phoneNumber) {
  const amount = await adminSettings.getUnlockAmount();
  const apiRef = `JACKPOT-${jackpotId}-${Date.now()}`;

  if (amount === 0) {
    await prisma.payment.create({
      data: { jackpotId, phoneNumber, amount: 0, apiRef, status: "SUCCESS", providerState: "FREE" },
    });
    const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    await prisma.jackpotUnlock.upsert({
      where: { jackpotId_phoneNumber: { jackpotId, phoneNumber } },
      update: { expiresAt },
      create: { jackpotId, phoneNumber, expiresAt },
    });
    return { apiRef, invoiceId: null, free: true };
  }

  const payment = await prisma.payment.create({
    data: {
      jackpotId,
      phoneNumber,
      amount,
      apiRef,
      status: "PENDING",
    },
  });

  const collection = intasend.collection();
  const response = await collection.mpesaStkPush({
    first_name: "VIP",
    last_name: "Unlock",
    email: process.env.INTASEND_FALLBACK_EMAIL || "vip-unlock@no-reply.local",
    host: process.env.APP_HOST,
    amount,
    phone_number: phoneNumber,
    api_ref: apiRef,
  });

  const invoiceId = response?.invoice?.invoice_id || null;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { invoiceId, providerState: response?.invoice?.state || "PENDING" },
  });

  return { apiRef, invoiceId, raw: response };
}

/**
 * Handles IntaSend's payment collection webhook. Fires every time an
 * invoice's `state` changes (PENDING -> PROCESSING -> COMPLETE/FAILED).
 * IntaSend doesn't sign payloads with HMAC — the `challenge` string you
 * set up in their dashboard is the authenticity check, so we verify that
 * first and reject anything that doesn't match.
 */
async function handleWebhook(payload) {
  const expectedChallenge = process.env.INTASEND_WEBHOOK_CHALLENGE;
  if (expectedChallenge && payload.challenge !== expectedChallenge) {
    throw new Error("invalid webhook challenge");
  }

  const { invoice_id: invoiceId, api_ref: apiRef, state } = payload;

  const payment = await prisma.payment.findFirst({
    where: invoiceId ? { invoiceId } : { apiRef },
  });

  if (!payment) {
    console.warn(`[intasend] webhook for unknown invoice/api_ref: ${invoiceId}/${apiRef}`);
    return;
  }

  const success = state === "COMPLETE";
  const failed = state === "FAILED";

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: success ? "SUCCESS" : failed ? "FAILED" : "PENDING",
      providerState: state,
      invoiceId: invoiceId || payment.invoiceId,
    },
  });

  if (!success) return;

  // Unlock covers through a typical jackpot's full settlement window
  // rather than a short session TTL — they paid for the whole slip.
  const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  await prisma.jackpotUnlock.upsert({
    where: {
      jackpotId_phoneNumber: { jackpotId: payment.jackpotId, phoneNumber: payment.phoneNumber },
    },
    update: { expiresAt },
    create: { jackpotId: payment.jackpotId, phoneNumber: payment.phoneNumber, expiresAt },
  });
}

async function isUnlocked(jackpotId, phoneNumber) {
  if (await adminSettings.isPaymentsFree()) return true;
  if (!phoneNumber) return false;
  const unlock = await prisma.jackpotUnlock.findUnique({
    where: { jackpotId_phoneNumber: { jackpotId, phoneNumber } },
  });
  return Boolean(unlock && unlock.expiresAt > new Date());
}

module.exports = { initiateStkPush, handleWebhook, isUnlocked };
