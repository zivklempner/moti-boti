const { query } = require("../db/postgres");

/**
 * Insert or update an event row.
 * Conflict target: (title, date, location) — updates time/link/source if row exists.
 */
async function upsertEvent({ title, artist, date, time, city, location, source, link }) {
  await query(
    `INSERT INTO events (title, artist, date, time, city, location, source, link, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (title, date, location) DO UPDATE
       SET time       = EXCLUDED.time,
           city       = EXCLUDED.city,
           artist     = EXCLUDED.artist,
           link       = EXCLUDED.link,
           updated_at = NOW()`,
    [title, artist || title, date, time || null, city || null, location || "", source, link || null]
  );
}

/**
 * Search events by availability constraints.
 *
 * @param {object} constraints
 * @param {number[]}  [constraints.days_of_week]  0=Sun … 6=Sat
 * @param {string}    [constraints.date_from]      YYYY-MM-DD
 * @param {string}    [constraints.date_to]        YYYY-MM-DD
 * @param {string}    [constraints.time_from]      HH:MM
 * @param {string}    [constraints.city]           partial city name
 * @param {string[]}  [constraints.artists]        artist name fragments
 * @param {number}    [constraints.limit]          default 5
 * @returns {Promise<object[]>}
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
  const conditions = ["date >= CURRENT_DATE"];
  const params = [];
  let i = 1;

  if (days_of_week?.length > 0) {
    conditions.push(`EXTRACT(DOW FROM date) = ANY($${i++})`);
    params.push(days_of_week);
  }

  if (date_from) {
    conditions.push(`date >= $${i++}`);
    params.push(date_from);
  }

  if (date_to) {
    conditions.push(`date <= $${i++}`);
    params.push(date_to);
  }

  if (time_from) {
    // include events with unknown time (NULL) so we don't silently drop them
    conditions.push(`(time IS NULL OR time >= $${i++})`);
    params.push(time_from + ":00");
  }

  if (city) {
    conditions.push(`city ILIKE $${i++}`);
    params.push(`%${city}%`);
  }

  if (artists?.length > 0) {
    const artistConds = artists.map(() => `(artist ILIKE $${i++} OR title ILIKE $${i - 1})`);
    conditions.push(`(${artistConds.join(" OR ")})`);
    params.push(...artists.map((a) => `%${a}%`));
  }

  params.push(limit);

  const sql = `
    SELECT id, title, artist, date, time, city, location, link
    FROM events
    WHERE ${conditions.join(" AND ")}
    ORDER BY date ASC, time ASC NULLS LAST
    LIMIT $${i}
  `;

  const { rows } = await query(sql, params);
  return rows;
}

/**
 * Format a list of event rows into a short Hebrew string for the bot reply.
 * Caller can pass the raw rows directly.
 */
function formatEvents(rows) {
  if (rows.length === 0) return "לא מצאתי אירועים שמתאימים לתאריכים שנתת. נסה לשנות את הסינון?";

  return rows
    .map((ev) => {
      const date = ev.date instanceof Date
        ? ev.date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" })
        : String(ev.date).substring(0, 10).split("-").reverse().join("/");
      const time = ev.time ? ` | ${ev.time.substring(0, 5)}` : "";
      const city = ev.city ? ` | ${ev.city}` : "";
      const link = ev.link ? `\n   🔗 ${ev.link}` : "";
      return `🎭 *${ev.title}*\n   📅 ${date}${time}${city}${link}`;
    })
    .join("\n\n");
}

module.exports = { upsertEvent, searchEventsByAvailability, formatEvents };
