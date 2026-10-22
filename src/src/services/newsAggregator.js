const Parser = require("rss-parser");
const prisma = require("../lib/prisma");

const parser = new Parser({ timeout: 15000 });

// Public RSS feeds — no API key, no quota. Verify these URLs still
// resolve periodically; publishers occasionally restructure feed paths.
// NOTE: BASKETBALL/HOCKEY/BASEBALL/NFL feeds below are ESPN's general
// per-sport RSS endpoints — I can't independently confirm these exact
// paths are still live from inside this environment (no network access
// to verify), so treat them as a starting point and check they resolve
// before relying on them. No public feed was added for
// HANDBALL/VOLLEYBALL/RUGBY/AFL — I don't have a source I'm confident
// is both real and still active, so those sports simply won't have News
// tab content until a real feed is wired in.
const FEEDS = [
  { source: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml", sport: "FOOTBALL" },
  { source: "Sky Sports", url: "https://www.skysports.com/rss/12040", sport: "FOOTBALL" },
  { source: "ESPN", url: "https://www.espn.com/espn/rss/nba/news", sport: "BASKETBALL" },
  { source: "ESPN", url: "https://www.espn.com/espn/rss/nhl/news", sport: "HOCKEY" },
  { source: "ESPN", url: "https://www.espn.com/espn/rss/mlb/news", sport: "BASEBALL" },
  { source: "ESPN", url: "https://www.espn.com/espn/rss/nfl/news", sport: "NFL" },
];

// Keep the table from growing forever — trending news is inherently
// short-lived content, unlike fixtures/predictions we want to keep.
const RETENTION_DAYS = 14;

async function fetchAndCacheNews() {
  let fetched = 0;
  let stored = 0;
  const errors = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      fetched += parsed.items.length;

      for (const item of parsed.items) {
        if (!item.link || !item.title) continue;

        const result = await prisma.newsArticle.upsert({
          where: { url: item.link },
          update: {}, // articles don't change — first-seen wins, just skip duplicates
          create: {
            title: item.title,
            url: item.link,
            source: feed.source,
            sport: feed.sport,
            summary: stripHtml(item.contentSnippet || item.content || "").slice(0, 280),
            imageUrl: extractImage(item),
            publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
          },
        });
        if (result) stored += 1;
      }
    } catch (err) {
      errors.push(`${feed.source}: ${err.message}`);
      console.error(`[newsAggregator] failed to fetch ${feed.source}:`, err.message);
    }
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.newsArticle.deleteMany({ where: { publishedAt: { lt: cutoff } } });

  return { fetched, stored, errors };
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, "").trim();
}

function extractImage(item) {
  return item.enclosure?.url || item["media:content"]?.$?.url || null;
}

module.exports = { fetchAndCacheNews };
