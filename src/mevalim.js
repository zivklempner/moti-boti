/**
 * mevalim.js
 * CommonJS wrapper around mevalim.co.il entertainment listings.
 *
 * Strategy:
 *   1. Fetch the category listing page to get individual show detail-page URLs.
 *   2. For each show, fetch its detail page which has JSON-LD with ALL upcoming
 *      dates, real ticket prices, and direct purchase URLs.
 *   3. Cache results in Firebase (survives Cloud Function cold starts).
 *      - Serve fresh cache (< FRESH_TTL) immediately.
 *      - Serve stale cache (< STALE_TTL) immediately AND refresh in background.
 *      - If cache is missing or too old, fetch synchronously then store.
 *
 * Main export:
 *   getEntertainment(category, region, maxShows) → SearchResult
 */

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL   = "https://www.mevalim.co.il";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent":      USER_AGENT,
  Accept:            "text/html,application/xhtml+xml,*/*;q=0.9",
  "Accept-Language": "he,en-US;q=0.9,en;q=0.8",
  Referer:           `${BASE_URL}/`,
};

const CATEGORIES = [
  { slug: "stand-up",   label: "סטנדאפ"     },
  { slug: "concerts",   label: "קונצרטים"    },
  { slug: "theater",    label: "תיאטרון"     },
  { slug: "shows",      label: "הופעות חיות" },
  { slug: "musicals",   label: "מחזמרים"     },
  { slug: "dance",      label: "מחול ובלט"   },
  { slug: "kids-shows", label: "הצגות ילדים" },
  { slug: "lectures",   label: "הרצאות"      },
];

// Hebrew keywords → category slug (for natural language resolution)
const KEYWORD_TO_CATEGORY = {
  "סטנדאפ": "stand-up", "סטנד אפ": "stand-up", "קומדיה": "stand-up",
  "קונצרט": "concerts",  "קונצרטים": "concerts", "מוזיקה": "concerts",
  "הצגה":   "theater",   "תיאטרון": "theater",
  "הופעה":  "shows",     "הופעות":  "shows",
  "מחזמר":  "musicals",  "מחזמרים": "musicals",
  "מחול":   "dance",     "בלט":     "dance",
  "ילדים":  "kids-shows","ילד":      "kids-shows",
  "הרצאה":  "lectures",  "הרצאות":  "lectures",
};

// ---------------------------------------------------------------------------
// Firebase cache
// ---------------------------------------------------------------------------
// Shows change daily, but not minute-to-minute.
// FRESH_TTL:  serve from cache with no background refresh (6 hours)
// STALE_TTL:  serve stale cache but kick off a background refresh (24 hours)
// Beyond STALE_TTL (or missing): fetch synchronously, then store.

const FRESH_TTL_MS  = 6  * 60 * 60 * 1000; //  6 hours
const STALE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours

// In-process layer: avoids a Firebase round-trip within the same warm instance
const _mem = new Map();

function fbRef(cacheKey) {
  const { getDb } = require("./firebase");
  // Sanitise key for Firebase path (no dots, #, $, [, ])
  const safe = cacheKey.replace(/[.#$[\]]/g, "_");
  return getDb().ref(`moti-boti/mevalim-cache/${safe}`);
}

async function cacheRead(cacheKey) {
  // 1. In-process first
  const mem = _mem.get(cacheKey);
  if (mem) return mem;
  // 2. Firebase
  try {
    const snap = await fbRef(cacheKey).once("value");
    const val  = snap.val();
    if (val) {
      _mem.set(cacheKey, val); // warm in-process layer
      return val;
    }
  } catch { /* non-fatal */ }
  return null;
}

async function cacheWrite(cacheKey, result) {
  const entry = { fetchedAt: Date.now(), result };
  _mem.set(cacheKey, entry);
  try { await fbRef(cacheKey).set(entry); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get upcoming entertainment shows from mevalim.co.il.
 *
 * @param {string} category         - Category slug (e.g. "stand-up") OR Hebrew keyword (e.g. "סטנדאפ")
 * @param {string} [region=""]      - Region or city in Hebrew (e.g. "מרכז", "תל אביב")
 * @param {number} [maxShows=8]     - Max number of show detail pages to fetch (each has multiple dates)
 * @returns {Promise<SearchResult>}
 */
async function getEntertainment(category, region = "", maxShows = 8) {
  const slug = resolveCategory(category);
  if (!slug) {
    return {
      notFound: true, category, region, shows: [], total: 0,
      message: `קטגוריה לא מוכרת: "${category}". קטגוריות זמינות: ${CATEGORIES.map(c => c.label).join(", ")}`,
    };
  }

  const cacheKey = `${slug}:${region}`;
  const cached   = await cacheRead(cacheKey);
  const age      = cached ? Date.now() - cached.fetchedAt : Infinity;

  if (age < FRESH_TTL_MS) {
    // Cache is fresh — serve immediately, no refresh needed
    return cached.result;
  }

  if (age < STALE_TTL_MS) {
    // Cache is stale but usable — serve it now, refresh in background
    fetchAndStore(slug, region, maxShows, cacheKey).catch(() => {});
    return cached.result;
  }

  // Cache is missing or too old — fetch synchronously
  return fetchAndStore(slug, region, maxShows, cacheKey);
}

async function fetchAndStore(slug, region, maxShows, cacheKey) {
  // Step 1: get show detail-page URLs + any direct-ticket events from the listing page
  const { detailUrls, directShows } = await getShowUrlsFromListing(slug, region);

  // Step 2: fetch detail pages in parallel (cap at maxShows)
  const toFetch = detailUrls.slice(0, maxShows);
  const results = await Promise.allSettled(toFetch.map(url => fetchShowDetail(url)));
  const shows = [
    ...directShows,
    ...results.filter(r => r.status === "fulfilled").flatMap(r => r.value),
  ];

  if (shows.length === 0) {
    return { notFound: true, category: slug, categoryLabel: CATEGORIES.find(c => c.slug === slug)?.label, region, shows: [], total: 0 };
  }

  // Filter to only future events
  const today = new Date().toISOString().substring(0, 10);
  const future = shows.filter(s => s.date >= today);

  // Sort ascending by date+time and deduplicate
  const seen = new Set();
  const unique = future
    .sort((a, b) => {
      const da = a.date + "T" + (a.time || "00:00");
      const db = b.date + "T" + (b.time || "00:00");
      return da < db ? -1 : da > db ? 1 : 0;
    })
    .filter(s => {
      const key = `${s.ticketUrl}|${s.date}|${s.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const categoryLabel = CATEGORIES.find(c => c.slug === slug)?.label || slug;
  const result = { notFound: unique.length === 0, category: slug, categoryLabel, region, shows: unique, total: unique.length };
  await cacheWrite(cacheKey, result);
  return result;
}

module.exports = { getEntertainment, CATEGORIES, KEYWORD_TO_CATEGORY, getShowUrlsFromListing, fetchAndStore };

// ---------------------------------------------------------------------------
// Step 1: extract show detail-page URLs from the listing page
// ---------------------------------------------------------------------------

function resolveCategory(input) {
  if (!input) return null;
  if (CATEGORIES.find(c => c.slug === input)) return input;
  for (const [kw, slug] of Object.entries(KEYWORD_TO_CATEGORY)) {
    if (input.includes(kw)) return slug;
  }
  const lower = input.toLowerCase();
  const match = CATEGORIES.find(c => c.slug.includes(lower) || lower.includes(c.slug));
  return match ? match.slug : null;
}

function buildListingUrl(category, region, page) {
  let path = `/${category}/`;
  if (region) {
    // mevalim uses Hebrew slugs with hyphens (not %20) between words
    const regionSlug = region.trim().replace(/\s+/g, "-");
    path += `${encodeURIComponent(regionSlug)}/`;
  }
  if (page > 1) path += `page/${page}/`;
  return BASE_URL + path;
}

/**
 * Returns:
 *   detailUrls  — mevalim show-page URLs to fetch for full schedules + prices
 *   directShows — events whose ticket URL is already a direct purchase link
 *                 (these have no separate detail page, so we use them as-is)
 */
async function getShowUrlsFromListing(category, region) {
  const url = buildListingUrl(category, region, 1);
  let html;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return { detailUrls: [], directShows: [] };
    html = await res.text();
    const finalUrl = res.url || url;
    if (!finalUrl.includes(`/${category}/`)) return { detailUrls: [], directShows: [] };
  } catch { return { detailUrls: [], directShows: [] }; }

  const detailUrls = new Set();
  const directShows = [];

  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const offerUrl = item.offers?.url || "";

      if (offerUrl.startsWith("https://tickets.mevalim.co.il/")) {
        // Direct ticket URL — parse event in-place (no detail page exists)
        const show = parseEvent(item);
        if (show) directShows.push(show);
        continue;
      }

      // mevalim show detail page URL — queue for detail fetch
      if (offerUrl.startsWith(BASE_URL + "/")) {
        const path = offerUrl.replace(BASE_URL, "");
        if (path.split("/").filter(Boolean).length >= 2) {
          detailUrls.add(offerUrl);
          continue;
        }
      }

      // Fallback: item.url
      const itemUrl = item.url || "";
      if (itemUrl.startsWith(BASE_URL + "/") && itemUrl !== `${BASE_URL}/${category}/`) {
        const path = itemUrl.replace(BASE_URL, "");
        if (path.split("/").filter(Boolean).length >= 2) {
          detailUrls.add(itemUrl);
        }
      }
    }
  }

  // Also extract ALL show-page hrefs from the HTML (artist/show cards, not just
  // the 9 JSON-LD featured events). Filter out navigation slugs: single-word
  // geographic regions, /events/, /standupists/, etc.
  const NON_SHOW_SLUGS = new Set([
    "events", "standupists", "concerts-list",
    // geographic regions mevalim uses as sub-pages
    "%d7%a6%d7%a4%d7%95%d7%9f",           // צפון
    "%d7%94%d7%a9%d7%a8%d7%95%d7%9f",     // השרון
    "%d7%9e%d7%a8%d7%9b%d7%96",           // מרכז
    "%d7%94%d7%a9%d7%a4%d7%9c%d7%94",     // השפלה
    "%d7%99%d7%a8%d7%95%d7%a9%d7%9c%d7%99%d7%9d-%d7%95%d7%94%d7%a1%d7%91%d7%99%d7%91%d7%94", // ירושלים והסביבה
    "%d7%93%d7%a8%d7%95%d7%9d",           // דרום
    "%d7%aa%d7%9c-%d7%90%d7%91%d7%99%d7%91", // תל אביב
    "%d7%97%d7%99%d7%a4%d7%94",           // חיפה
  ]);

  const hrefRe = new RegExp(
    `href="(${BASE_URL.replace(/\./g, "\\.")}/${category}/([^"#?/][^"#?]*)/)"`,
    "gi"
  );
  let hm;
  while ((hm = hrefRe.exec(html)) !== null) {
    const fullUrl = hm[1];
    const slug    = hm[2].toLowerCase();
    if (NON_SHOW_SLUGS.has(slug)) continue;
    // Skip pure region slugs: encoded single Hebrew words (no hyphen in decoded form)
    try {
      const decoded = decodeURIComponent(slug);
      // Region slugs are short (≤ 20 chars) and contain no hyphen
      if (decoded.length <= 20 && !decoded.includes("-")) continue;
    } catch { /* malformed — skip */ continue; }
    detailUrls.add(fullUrl);
  }

  // Extract events from mevalim's data-mvlm-* thumbnail widgets.
  // These cover shows not in JSON-LD (sold-out, coming-soon, regional picks).
  // Collect each widget tag's attributes, then find venue/city from the
  // structured text content that immediately follows the card's date/time header.
  // link-label can appear before or after link-target, so capture it independently
  const attrRe = /data-mvlm-event-name="([^"]+)"[\s\S]*?data-mvlm-event-date="([^"]+)"[\s\S]*?data-mvlm-event-link-target="([^"]+)"[\s\S]*?(?:data-mvlm-event-link-label="([^"]*)"[\s\S]*?)?>/g;
  const DAYS = new Set(["יום ראשון","יום שני","יום שלישי","יום רביעי","יום חמישי","יום שישי","שבת"]);
  let wm;
  while ((wm = attrRe.exec(html)) !== null) {
    const [fullMatch, name, rawDate, linkTarget, linkLabel = ""] = wm;
    const dp = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2})$/);
    if (!dp) continue;
    const date = `20${dp[3]}-${dp[2]}-${dp[1]}`;
    const time = dp[4];

    // After the closing > of this widget element, the card has:
    // background-img div → short-date div → day div → time div → name div → VENUE div → CITY div → cta div
    // We find the card body by searching for the time string after the tag end.
    const tagEnd = wm.index + fullMatch.length;
    // Find the time token in the card body (appears as plain text in its div)
    const timeIdx = html.indexOf(`>${time}<`, tagEnd);
    let venue = "";
    if (timeIdx !== -1 && timeIdx - tagEnd < 2000) {
      // Grab 300 chars after the time div's close tag to find venue + city
      const afterTime = html.substring(timeIdx + time.length + 2, timeIdx + time.length + 300);
      const tokens = afterTime
        .replace(/<[^>]+>/g, "\n")
        .split("\n")
        .map(t => t.trim())
        .filter(t => t && !DAYS.has(t)
          && !/^\d{2}\.\d{2}$/.test(t) && t !== time
          && !t.includes("₪") && !t.includes("לרכישה") && !t.includes("אזלו")
          && !t.includes(name.split(" ")[0]));
      const raw = tokens.slice(0, 2).join(" ").trim();
      venue = /[<>/]/.test(raw) ? "" : raw; // discard if HTML leaked in
    }

    // Check both the attribute and the surrounding 200-char HTML for sold-out marker
    const surroundingHtml = html.substring(wm.index, wm.index + fullMatch.length + 200);
    const soldOut    = linkLabel.includes("אזלו") || surroundingHtml.includes("הכרטיסים אזלו");
    const comingSoon = linkTarget === "#updates" && !soldOut;
    const ticketUrl  = (soldOut || comingSoon) ? "" : linkTarget.replace(/&amp;/g, "&").split("?")[0];

    directShows.push({ title: name.trim(), date, time, venue, type: "Event", ticketUrl, price: null, soldOut, comingSoon });
  }

  return { detailUrls: [...detailUrls], directShows };
}

// ---------------------------------------------------------------------------
// Step 2: fetch a show's detail page → array of upcoming performances
// ---------------------------------------------------------------------------

async function fetchShowDetail(showPageUrl) {
  let html;
  try {
    const res = await fetch(showPageUrl, { headers: { ...HEADERS, Referer: showPageUrl } });
    if (!res.ok) return [];
    html = await res.text();
  } catch { return []; }

  return extractShows(html);
}

// ---------------------------------------------------------------------------
// JSON-LD extraction (works for both listing and detail pages)
// ---------------------------------------------------------------------------

function extractShows(html) {
  const shows = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const show = parseEvent(item);
      if (show) shows.push(show);
    }
  }
  return shows;
}

const EVENT_TYPES = new Set([
  "ComedyEvent", "MusicEvent", "TheaterEvent", "Event",
  "DanceEvent",  "EducationEvent", "ScreeningEvent", "SocialEvent",
  "ChildrensEvent", "FamilyEvent", "EntertainmentBusiness",
]);

function parseEvent(item) {
  const type = item["@type"] || "";
  if (!EVENT_TYPES.has(type)) return null;

  const name      = (item.name || "").trim();
  const startDate = item.startDate || "";
  if (!name || !startDate) return null;

  const dtMatch = startDate.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  const date    = dtMatch ? dtMatch[1] : startDate.substring(0, 10);
  const time    = dtMatch && dtMatch[2] ? dtMatch[2] : "";

  const loc       = item.location || {};
  const locName   = (loc.name || "").trim();
  const locAddr   = (loc.address || "").trim();
  // Prefer the shorter of name vs address (they're often duplicated like "תאטרון גבעתיים גבעתיים")
  const venue     = locName || locAddr;

  const offers    = item.offers || {};
  // offers.url is the DIRECT ticket purchase link on detail pages
  const ticketUrl = (offers.url || item.url || "").trim();
  const priceRaw  = offers.price;
  const price     = typeof priceRaw === "number" ? priceRaw
                  : typeof priceRaw === "string"  ? (parseFloat(priceRaw) || null)
                  : null;
  const soldOut   = (offers.availability || "").includes("SoldOut");

  return { title: name, date, time, venue, type, ticketUrl, price, soldOut };
}
