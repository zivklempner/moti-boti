const { scrapeBravo } = require("./bravo");
const { scrapeLeaan } = require("./leaan");

async function runAllScrapers() {
  console.log("Starting event scrapers...");
  const [b, l] = await Promise.allSettled([scrapeBravo(), scrapeLeaan()]);
  if (b.status === "rejected") console.error("Bravo scraper error:", b.reason?.message);
  if (l.status === "rejected") console.error("Leaan scraper error:", l.reason?.message);
  console.log("Scrapers done.");
}

module.exports = { runAllScrapers };
