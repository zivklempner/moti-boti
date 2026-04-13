/**
 * Seeds a handful of fake events into Firebase so you can test
 * the find_events bot flow without waiting for scrapers.
 *
 * Run: node scripts/seed-events.js
 */
require("dotenv").config();
const { initFirebase } = require("../src/firebase");
const { upsertEvent } = require("../src/services/events");

initFirebase();

const TEST_EVENTS = [
  {
    title: "שחר חסון — סטנדאפ",
    artist: "שחר חסון",
    date: "2026-04-22",   // Tuesday
    time: "21:00:00",
    city: "תל אביב",
    location: "זאפה תל אביב",
    source: "seed",
    link: "https://example.com/1",
  },
  {
    title: "מתן פרץ — הופעה",
    artist: "מתן פרץ",
    date: "2026-04-29",   // Tuesday
    time: "20:30:00",
    city: "חולון",
    location: "קאנטרי חולון",
    source: "seed",
    link: "https://example.com/2",
  },
  {
    title: "עידן רייכל — קונצרט",
    artist: "עידן רייכל",
    date: "2026-05-06",   // Wednesday
    time: "21:00:00",
    city: "תל אביב",
    location: "היכל מנורה מבטחים",
    source: "seed",
    link: "https://example.com/3",
  },
  {
    title: "ליאור סוסי — סטנדאפ",
    artist: "ליאור סוסי",
    date: "2026-05-12",   // Tuesday
    time: "20:00:00",
    city: "רמת גן",
    location: "גלובוס מקס",
    source: "seed",
    link: "https://example.com/4",
  },
  {
    title: "נסרין קדרי — הופעה",
    artist: "נסרין קדרי",
    date: "2026-05-19",   // Tuesday
    time: "19:00:00",
    city: "תל אביב",
    location: "זאפה תל אביב",
    source: "seed",
    link: "https://example.com/5",
  },
];

async function main() {
  for (const ev of TEST_EVENTS) {
    await upsertEvent(ev);
    console.log(`✅ Seeded: ${ev.title} (${ev.date})`);
  }
  console.log("\nDone. Now send this to the WhatsApp group:");
  console.log("  ימי שלישי באפריל ומאי, אחרי 20:00, מרכז");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
