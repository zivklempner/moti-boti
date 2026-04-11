/**
 * Bravo scraper — bravo.co.il
 *
 * HOW TO UPDATE SELECTORS:
 *   1. Open https://www.bravo.co.il/category/standup/ in Chrome
 *   2. Right-click an event card → Inspect
 *   3. Find the repeating container class and update CARD_SEL below
 *   4. Find title / date / time / location elements and update the selectors
 *
 * Run manually: node -e "require('./src/scrapers/bravo').scrapeBravo().then(r => console.log(JSON.stringify(r,null,2)))"
 */

const axios  = require("axios");
const cheerio = require("cheerio");
const { upsertEvent } = require("../services/events");

const BASE_URL = "https://www.bravo.co.il";
const PAGES = [
  "/category/standup/",
  "/category/theater/",
  "/category/concerts/",
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "Accept-Language": "he-IL,he;q=0.9",
};

// Hebrew month name → month number (1-12)
const HE_MONTHS = {
  "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4,
  "מאי": 5,  "יוני": 6,  "יולי": 7, "אוגוסט": 8,
  "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
};

/**
 * Parse Israeli date strings like:
 *   "15.04.2026"  "15/04/26"  "15 באפריל 2026"  "יום שלישי, 15.4"
 * Returns "YYYY-MM-DD" or null.
 */
function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // dd.mm.yyyy or dd/mm/yyyy or dd.mm.yy
  const dotMatch = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dotMatch) {
    let [, d, m, y] = dotMatch;
    if (y.length === 2) y = "20" + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "15 באפריל 2026" or "15 אפריל"
  const heMatch = s.match(/(\d{1,2})\s+ב?([א-ת]+)\s*(\d{4})?/);
  if (heMatch) {
    const [, d, monthHe, y] = heMatch;
    const m = HE_MONTHS[monthHe];
    if (m) {
      const year = y || new Date().getFullYear();
      return `${year}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  return null;
}

/** Parse "20:30" or "20.30" → "20:30:00", returns null if not found */
function parseTime(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[:.h](\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:00` : null;
}

async function fetchPage(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return cheerio.load(data);
}

/**
 * Scrape one Bravo category page.
 * Adjust CARD_SEL and field selectors if Bravo changes their markup.
 */
async function scrapePage(path) {
  const url = BASE_URL + path;
  const $ = await fetchPage(url);
  const events = [];

  // ── Selector: the repeating event card container ──────────────────────────
  // Try multiple common patterns — first match wins.
  const CARD_SEL = [
    "article.post",
    ".event-item",
    ".show-item",
    ".tribe-event",
    ".post-type-shows",
  ].join(", ");

  $(CARD_SEL).each((_, el) => {
    // Title
    const title =
      $(el).find("h2, h3, .entry-title, .event-title").first().text().trim();

    // Date — look for data attributes first (most reliable), then text
    const dateRaw =
      $(el).attr("data-date") ||
      $(el).find("[class*=date], [class*=Date], time").first().text().trim() ||
      $(el).find(".tribe-event-date-start").first().text().trim();

    // Time
    const timeRaw =
      $(el).find("[class*=time], [class*=Time]").first().text().trim() ||
      $(el).find(".tribe-event-time").first().text().trim();

    // Location / city
    const locationRaw =
      $(el).find("[class*=location], [class*=venue], [class*=city]").first().text().trim() ||
      $(el).find(".tribe-venue").first().text().trim();

    // Link
    const rawHref = $(el).find("a").first().attr("href") || "";
    const link = rawHref.startsWith("http") ? rawHref : rawHref ? BASE_URL + rawHref : null;

    const date = parseDate(dateRaw);
    if (!title || !date) return; // skip unparseable rows

    events.push({
      title,
      artist: title, // Bravo titles are usually artist names
      date,
      time: parseTime(timeRaw),
      city: locationRaw.split(/[,،]/)[1]?.trim() || locationRaw.split(/[,،]/)[0]?.trim() || null,
      location: locationRaw || null,
      source: "bravo",
      link,
    });
  });

  return events;
}

async function scrapeBravo() {
  let total = 0;
  for (const path of PAGES) {
    try {
      const events = await scrapePage(path);
      console.log(`Bravo ${path}: found ${events.length} events`);
      for (const ev of events) {
        await upsertEvent(ev);
        total++;
      }
    } catch (err) {
      console.error(`Bravo scrape failed (${path}):`, err.message);
    }
  }
  console.log(`Bravo scrape done — ${total} events upserted`);
  return total;
}

module.exports = { scrapeBravo };
