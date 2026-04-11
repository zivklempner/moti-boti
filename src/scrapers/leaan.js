/**
 * Leaan scraper — leaan.co.il
 *
 * HOW TO UPDATE SELECTORS:
 *   1. Open https://www.leaan.co.il/events in Chrome
 *   2. Right-click an event → Inspect
 *   3. Update CARD_SEL and field selectors below
 *
 * Run manually: node -e "require('./src/scrapers/leaan').scrapeLeaan().then(r => console.log(r))"
 */

const axios   = require("axios");
const cheerio = require("cheerio");
const { upsertEvent } = require("../services/events");

const BASE_URL = "https://www.leaan.co.il";
const PAGES = ["/events", "/shows", "/"];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "Accept-Language": "he-IL,he;q=0.9",
};

const HE_MONTHS = {
  "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4,
  "מאי": 5,  "יוני": 6,  "יולי": 7, "אוגוסט": 8,
  "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
};

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const dotMatch = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dotMatch) {
    let [, d, m, y] = dotMatch;
    if (y.length === 2) y = "20" + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
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

function parseTime(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[:.h](\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:00` : null;
}

async function scrapePage(path) {
  const url = BASE_URL + path;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);
  const events = [];

  // ── Adjust selectors after inspecting leaan.co.il ────────────────────────
  const CARD_SEL = [
    ".event-card",
    ".show-card",
    "article",
    ".event-item",
    "[class*=event]",
  ].join(", ");

  $(CARD_SEL).each((_, el) => {
    const title = $(el).find("h2, h3, h4, .title, [class*=title]").first().text().trim();
    const dateRaw =
      $(el).attr("data-date") ||
      $(el).find("[class*=date], time").first().text().trim();
    const timeRaw = $(el).find("[class*=time], [class*=hour]").first().text().trim();
    const locationRaw = $(el).find("[class*=location], [class*=venue], [class*=city]").first().text().trim();
    const rawHref = $(el).find("a").first().attr("href") || "";
    const link = rawHref.startsWith("http") ? rawHref : rawHref ? BASE_URL + rawHref : null;

    const date = parseDate(dateRaw);
    if (!title || !date) return;

    events.push({
      title,
      artist: title,
      date,
      time: parseTime(timeRaw),
      city: locationRaw.split(/[,،]/)[0]?.trim() || null,
      location: locationRaw || null,
      source: "leaan",
      link,
    });
  });

  return events;
}

async function scrapeLeaan() {
  let total = 0;
  for (const path of PAGES) {
    try {
      const events = await scrapePage(path);
      console.log(`Leaan ${path}: found ${events.length} events`);
      for (const ev of events) {
        await upsertEvent(ev);
        total++;
      }
    } catch (err) {
      console.error(`Leaan scrape failed (${path}):`, err.message);
    }
  }
  console.log(`Leaan scrape done — ${total} events upserted`);
  return total;
}

module.exports = { scrapeLeaan };
