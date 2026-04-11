const crypto = require("crypto");
const { getDb } = require("../firebase");

// Firebase path: events/{id}
// ID = md5(title + date + location) — natural deduplication across scraper runs

function eventId(title, date, location) {
  return crypto
    .createHash("md5")
    .update(`${title}|${date}|${location || ""}`)
    .digest("hex")
    .substring(0, 16);
}

/**
 * Insert or overwrite an event in Firebase.
 */
async function upsertEvent({ title, artist, date, time, city, location, source, link }) {
  const id = eventId(title, date, location);
  await getDb().ref(`events/${id}`).set({
    id,
    title,
    artist: artist || title,
    date,           // "YYYY-MM-DD"
    time:  time  || null,   // "HH:MM:SS" or null
    city:  city  || null,
    location: location || null,
    source,
    link:  link  || null,
    updated_at: Date.now(),
  });
}

/**
 * Search events by availability constraints.
 *
 * Firebase has no SQL — we fetch events within the date range and filter in JS.
 * For the typical "next 2 months" query this is at most a few hundred rows.
 *
 * @param {object} c
 * @param {number[]}  [c.days_of_week]  0=Sun … 6=Sat
 * @param {string}    [c.date_from]     YYYY-MM-DD  (default: today)
 * @param {string}    [c.date_to]       YYYY-MM-DD  (default: 3 months ahead)
 * @param {string}    [c.time_from]     HH:MM
 * @param {string}    [c.city]          partial match
 * @param {string[]}  [c.artists]       partial match
 * @param {number}    [c.limit]         default 5
 */
async function searchEventsByAvailability({
  days_of_week,
  date_from,
  date_to,
  time_from,
  city,
  artists,
  limit = 5,
} = {}) {
  const today = new Date().toISOString().split("T")[0];
  const from  = date_from || today;
  const to    = date_to   || futureDate(90); // default: 3 months

  // Fetch events in date range using Firebase orderByChild
  const snap = await getDb()
    .ref("events")
    .orderByChild("date")
    .startAt(from)
    .endAt(to)
    .once("value");

  let events = Object.values(snap.val() || {});

  // Filter: day of week
  if (days_of_week?.length > 0) {
    events = events.filter((ev) => {
      const dow = new Date(ev.date + "T12:00:00Z").getUTCDay(); // 0=Sun
      return days_of_week.includes(dow);
    });
  }

  // Filter: time_from — skip events that start before the requested time
  if (time_from) {
    const minTime = time_from.replace(":", ""); // "2000"
    events = events.filter((ev) => {
      if (!ev.time) return true; // unknown time — include
      const evTime = ev.time.substring(0, 5).replace(":", ""); // "1930"
      return parseInt(evTime) >= parseInt(minTime);
    });
  }

  // Filter: city (partial, case-insensitive)
  if (city) {
    const c = city.toLowerCase();
    events = events.filter(
      (ev) =>
        (ev.city     && ev.city.toLowerCase().includes(c)) ||
        (ev.location && ev.location.toLowerCase().includes(c))
    );
  }

  // Filter: artists (any match)
  if (artists?.length > 0) {
    events = events.filter((ev) =>
      artists.some(
        (a) =>
          ev.artist?.toLowerCase().includes(a.toLowerCase()) ||
          ev.title?.toLowerCase().includes(a.toLowerCase())
      )
    );
  }

  // Sort by date asc, time asc
  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return (a.time || "99:99").localeCompare(b.time || "99:99");
  });

  return events.slice(0, limit);
}

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

module.exports = { upsertEvent, searchEventsByAvailability };
