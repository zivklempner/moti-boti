const ical = require("ical-generator");
const fs = require("fs");
const path = require("path");
const { MessageMedia } = require("whatsapp-web.js");

// ical-generator uses Web Crypto API — polyfill for Node 18
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = require("crypto").webcrypto;
}

/**
 * Create a .ics file and return a WhatsApp MessageMedia object ready to send.
 */
async function buildCalendarMedia({ title, start, end, location, organizer }) {
  const endTime = end || new Date(start.getTime() + 60 * 60 * 1000);

  const cal = ical.default({ name: "Moti Boti" });
  cal.createEvent({
    start,
    end: endTime,
    summary: title,
    location: location || "",
    organizer: { name: "Moti Boti", email: "moti.aiboti@gmail.com" },
    attendees: [
      { name: process.env.USER1_NAME || "Ziv", email: process.env.USER1_EMAIL || "ziv.klempner@gmail.com", rsvp: true },
      { name: process.env.USER2_NAME || "Tal", email: process.env.USER2_EMAIL || "talmadar1906@gmail.com", rsvp: true },
    ],
  });

  const icsContent = cal.toString();
  const b64 = Buffer.from(icsContent).toString("base64");

  // Safe filename from title
  const filename = `${title.replace(/[^א-תa-zA-Z0-9\s]/g, "").trim()}.ics`;

  return {
    media: new MessageMedia("text/calendar", b64, filename),
    start,
    endTime,
    title,
  };
}

module.exports = { buildCalendarMedia };
