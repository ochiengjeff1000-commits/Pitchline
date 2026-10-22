const axios = require("axios");
const https = require("https");

const PLATFORM = "MOZZART";

const customAgent = new https.Agent({
  ciphers: [
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256"
  ].join(":"),
  honorCipherOrder: true,
  minVersion: "TLSv1.2"
});

/**
 * MOZZART JACKPOT ADAPTER
 * Fetches and processes active jackpot pools from MozzartBet Kenya.
 */
async function fetchCurrentJackpots() {
  const endpoint = process.env.MOZZART_JACKPOT_ENDPOINT;
  if (!endpoint) {
    console.log(`[jackpotSources:${PLATFORM}] MOZZART_JACKPOT_ENDPOINT not set — skipping`);
    return [];
  }

  try {
    console.log(`[jackpotSources:${PLATFORM}] Requesting Mozzart API...`);

    const { data } = await axios.get(endpoint, {
      timeout: 15000,
      httpsAgent: customAgent,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Referer": "https://www.mozzartbet.co.ke/en/jackpot/daily",
        "Origin": "https://www.mozzartbet.co.ke"
      }
    });

    if (data && data.error) {
      console.error(`[jackpotSources:${PLATFORM}] API returned route error: "${data.error}". Verify MOZZART_JACKPOT_ENDPOINT in .env.`);
      return [];
    }

    // Handle single object, array, or nested property responses
    let pools = [];
    if (Array.isArray(data)) {
      pools = data;
    } else if (data && typeof data === "object") {
      pools = data.tickets || data.data || data.items || (data.id ? [data] : []);
    }

    if (!pools.length) {
      console.log(`[jackpotSources:${PLATFORM}] No pools found in response payload.`);
      return [];
    }

    console.log(`[jackpotSources:${PLATFORM}] Successfully retrieved ${pools.length} jackpot pool(s).`);

    return pools.map((pool) => ({
      platform: PLATFORM,
      type: pool.totalRows >= 16 ? "GRAND" : pool.totalRows >= 12 ? "MIDWEEK" : "DAILY",
      label: `Mozzart ${pool.totalRows}-game jackpot (KSh ${pool.fixedPayOutAmount ? pool.fixedPayOutAmount.toLocaleString() : ""})`,
      jackpotId: String(pool.id),
      amount: pool.fixedPayOutAmount,
      games: (pool.matches || []).map((m) => {
        const oddsMap = {};
        if (Array.isArray(m.odds)) {
          m.odds.forEach((o) => {
            oddsMap[o.bettingSubGameName] = parseFloat(o.bettingSubGameOdds);
          });
        }

        return {
          position: m.rowNumber,
          homeTeam: m.home,
          awayTeam: m.visitor,
          kickoff: new Date(m.time).toISOString(),
          externalId: String(m.id),
          competition: m.competition?.name || "",
          odds: {
            home: oddsMap["1"] || null,
            draw: oddsMap["X"] || null,
            away: oddsMap["2"] || null
          }
        };
      })
    }));
  } catch (err) {
    console.error(`[jackpotSources:${PLATFORM}] fetch failed:`, err.message);
    return [];
  }
}

module.exports = { platform: PLATFORM, fetchCurrentJackpots };