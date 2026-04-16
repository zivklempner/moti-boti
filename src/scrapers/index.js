const { scrapeBravo } = require("./bravo");
const { scrapeLeaan } = require("./leaan");
const { CATEGORIES, fetchAndStore } = require("../mevalim");

// Pre-warm the mevalim Firebase cache for all categories.
// maxShows=200 ensures all show pages are fetched (typically 100-170 per category).
// Runs daily at 3AM — well within the 300s Cloud Function timeout.
async function warmMevalimCache() {
  console.log("Warming mevalim cache...");
  const results = await Promise.allSettled(
    CATEGORIES.map(c => fetchAndStore(c.slug, "", 200, `${c.slug}:`))
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") console.log(`  ${CATEGORIES[i].label}: ${r.value.total} shows cached`);
    else console.error(`  ${CATEGORIES[i].label}: ERROR — ${r.reason?.message}`);
  });
  console.log("Mevalim cache warmed.");
}

async function runAllScrapers() {
  console.log("Starting event scrapers...");
  const [b, l, m] = await Promise.allSettled([
    scrapeBravo(),
    scrapeLeaan(),
    warmMevalimCache(),
  ]);
  if (b.status === "rejected") console.error("Bravo scraper error:", b.reason?.message);
  if (l.status === "rejected") console.error("Leaan scraper error:", l.reason?.message);
  if (m.status === "rejected") console.error("Mevalim cache error:", m.reason?.message);
  console.log("Scrapers done.");
}

module.exports = { runAllScrapers };
