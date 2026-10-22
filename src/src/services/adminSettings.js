const prisma = require("../lib/prisma");

const KEYS = {
  UNLOCK_AMOUNT_KES: "unlockAmountKes",
};

async function getSetting(key, fallback = null) {
  const row = await prisma.adminSetting.findUnique({ where: { key } });
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await prisma.adminSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

/**
 * Current jackpot unlock price in KES. Falls back to
 * INTASEND_UNLOCK_AMOUNT from .env if no admin-panel override has been
 * set yet, so existing deployments keep working unchanged until someone
 * actually opens the admin panel and changes it. Returns 0 for "free".
 */
async function getUnlockAmount() {
  const stored = await getSetting(KEYS.UNLOCK_AMOUNT_KES);
  if (stored !== null) return Number(stored);
  return Number(process.env.INTASEND_UNLOCK_AMOUNT || 49);
}

async function setUnlockAmount(amountKes) {
  const n = Number(amountKes);
  if (!Number.isFinite(n) || n < 0) throw new Error("amount must be a non-negative number");
  await setSetting(KEYS.UNLOCK_AMOUNT_KES, n);
  return n;
}

async function isPaymentsFree() {
  return (await getUnlockAmount()) === 0;
}

/** Returns everything the admin panel's settings page needs in one call. */
async function getAllSettings() {
  return {
    unlockAmountKes: await getUnlockAmount(),
    isFree: await isPaymentsFree(),
  };
}

module.exports = { getSetting, setSetting, getUnlockAmount, setUnlockAmount, isPaymentsFree, getAllSettings, KEYS };
