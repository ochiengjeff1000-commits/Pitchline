/**
 * Every jackpot source adapter implements the same contract:
 *
 *   async function fetchCurrentJackpots() {
 *     return [
 *       {
 *         platform: "SPORTPESA",          // must match a JackpotPlatform enum value
 *         type: "MEGA",                    // must match a JackpotType enum value
 *         label: "SportPesa Mega Jackpot - Week 30",  // unique per round; reused on
 *                                           // re-run = update, not duplicate (see ingestJackpot's upsert)
 *         games: [
 *           { position: 1, homeTeam: "Manchester United", awayTeam: "Chelsea" },
 *           // ...
 *         ],
 *       },
 *       // ...one entry per active jackpot type this platform is running right now
 *     ];
 *   }
 *
 * Return an empty array (not null/undefined) if the platform currently has
 * nothing active, or hasn't been wired up yet — jackpotAutoSync.js treats
 * that as "nothing to do this run", not an error.
 *
 * STATUS (2026-07-29): SportPesa's and Betika's pool-metadata endpoints
 * are confirmed and hardcoded (`sportpesaAdapter.js`, `betikaAdapter.js`)
 * — set SPORTPESA_JACKPOT_ENABLED / BETIKA_JACKPOT_ENABLED to "true" to
 * turn each on. Both platforms' games-list (per-leg team names) fetch is
 * still a best-effort guess pending confirmation of the real response
 * shape (see the TODO in each file). Mozzart and Shabiki are still fully
 * unconfirmed stubs.
 *
 * HOW TO ACTUALLY WIRE ONE OF THESE UP:
 * None of these bookmakers publish a documented public API — their
 * jackpot pages are JS apps that call a private internal endpoint after
 * the page loads. To get it:
 *   1. Open the platform's jackpot page in Chrome.
 *   2. Open DevTools (F12) → Network tab → filter to Fetch/XHR.
 *   3. Reload the page and watch for the request that returns the game
 *      list (usually named something like /jackpot, /pool, /games).
 *   4. Copy that request's URL and a sample JSON response.
 *   5. Fill in the matching file below using that shape.
 * Until that's done, each adapter just returns [] and logs a reminder —
 * safe to leave running, it costs nothing and breaks nothing.
 */
const sportpesa = require("./sportpesaAdapter");
const betika = require("./betikaAdapter");
const mozzart = require("./mozzartAdapter");
const shabiki = require("./shabikiAdapter");

const ADAPTERS = [sportpesa, betika, mozzart, shabiki];

module.exports = { ADAPTERS };
