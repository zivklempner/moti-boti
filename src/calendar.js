const nodemailer = require("nodemailer");
const ical = require("ical-generator");

const ATTENDEES = [
  { name: "Ziv",  email: process.env.USER1_EMAIL || "ziv.klempner@gmail.com" },
  { name: "Tal",  email: process.env.USER2_EMAIL || "talmadar1906@gmail.com" },
];

function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.BOT_EMAIL,           // moti.aiboti@gmail.com
      pass: process.env.BOT_EMAIL_PASSWORD,  // app password
    },
  });
}

/**
 * Send a calendar invite to both Ziv and Tal.
 *
 * @param {object} opts
 * @param {string} opts.title        - Event title, e.g. "פגישה עם אייל"
 * @param {Date}   opts.start        - Start time
 * @param {Date}   opts.end          - End time (default: start + 1 hour)
 * @param {string} [opts.location]   - Optional location
 * @param {string} [opts.organizer]  - Who is organizing (display name)
 */
async function sendCalendarInvite({ title, start, end, location, organizer }) {
  const endTime = end || new Date(start.getTime() + 60 * 60 * 1000);

  const cal = ical.default({ name: "Moti Boti Calendar" });
  const event = cal.createEvent({
    start,
    end: endTime,
    summary: title,
    location: location || "",
    organizer: {
      name: "Moti Boti",
      email: process.env.BOT_EMAIL,
    },
    attendees: ATTENDEES.map((a) => ({ name: a.name, email: a.email, rsvp: true })),
  });

  const icsString = cal.toString();

  const transport = createTransport();

  const hebrewDate = start.toLocaleDateString("he-IL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const hebrewTime = start.toLocaleTimeString("he-IL", {
    hour: "2-digit", minute: "2-digit",
  });

  const subject = `הזמנה: ${title} — ${hebrewDate} ${hebrewTime}`;
  const htmlBody = `
    <div dir="rtl" style="font-family: Arial, sans-serif;">
      <h2>📅 ${title}</h2>
      <p><strong>תאריך:</strong> ${hebrewDate}</p>
      <p><strong>שעה:</strong> ${hebrewTime}</p>
      ${location ? `<p><strong>מיקום:</strong> ${location}</p>` : ""}
      ${organizer ? `<p><strong>מארגן:</strong> ${organizer}</p>` : ""}
      <p style="color:#666;font-size:13px">הוזמנת על ידי Moti Boti 🤖</p>
    </div>`;

  // Send to all attendees
  for (const attendee of ATTENDEES) {
    await transport.sendMail({
      from: `"Moti Boti 🤖" <${process.env.BOT_EMAIL}>`,
      to: attendee.email,
      subject,
      html: htmlBody,
      attachments: [
        {
          filename: "invite.ics",
          content: icsString,
          contentType: "text/calendar; charset=utf-8; method=REQUEST",
        },
      ],
    });
  }

  console.log(`Calendar invite sent: "${title}" at ${start.toISOString()}`);
  return { title, start, end: endTime, attendees: ATTENDEES.map((a) => a.email) };
}

module.exports = { sendCalendarInvite };
