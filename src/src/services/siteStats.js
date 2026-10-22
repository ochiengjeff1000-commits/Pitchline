const prisma = require("../lib/prisma");

async function recomputeSiteStats() {
  const settled = await prisma.prediction.findMany({
    where: { isCorrect: { not: null } },
    select: { isCorrect: true, bttsCorrect: true },
  });

  const totalSettled = settled.length;
  const correct1x2 = settled.filter((p) => p.isCorrect).length;
  const bttsSettled = settled.filter((p) => p.bttsCorrect !== null);
  const correctBtts = bttsSettled.filter((p) => p.bttsCorrect).length;

  const winRate1x2 = totalSettled ? correct1x2 / totalSettled : 0;
  const winRateBtts = bttsSettled.length ? correctBtts / bttsSettled.length : 0;

  await Promise.all([
    upsertStat("win_rate_1x2", round(winRate1x2 * 100)),
    upsertStat("win_rate_btts", round(winRateBtts * 100)),
    upsertStat("total_settled", totalSettled),
  ]);

  return { winRate1x2, winRateBtts, totalSettled };
}

function upsertStat(key, value) {
  return prisma.siteStat.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

function round(n) {
  return Math.round(n * 10) / 10;
}

module.exports = { recomputeSiteStats };