/**
 * Build a Google Calendar "add event" URL.
 * Tapping it on any phone opens Google Calendar with the event pre-filled.
 * User just taps "Save" — no files, no email needed.
 */
function buildGoogleCalendarUrl({ title, start, end, location }) {
  const endTime = end || new Date(start.getTime() + 60 * 60 * 1000);

  // Google Calendar expects dates as YYYYMMDDTHHmmssZ
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(start)}/${fmt(endTime)}`,
    details: "נוצר על ידי Moti Boti 🤖",
  });

  if (location) params.set("location", location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = { buildGoogleCalendarUrl };
