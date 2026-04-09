const twilio = require("twilio");

let client;

function getClient() {
  if (!client) {
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return client;
}

/**
 * Send a WhatsApp message to a phone number (E.164 format, e.g. +15551234567).
 */
async function send(toPhone, body) {
  const to = toPhone.startsWith("whatsapp:") ? toPhone : `whatsapp:${toPhone}`;
  return getClient().messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body,
  });
}

/**
 * Reply inline via TwiML (faster, no extra HTTP round-trip).
 * Returns a TwiML XML string.
 */
function twimlReply(res, body) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(body);
  res.type("text/xml").send(twiml.toString());
}

/**
 * Reply inline AND push a separate message to the other user.
 */
async function replyAndNotify(res, replyBody, otherPhone, notifyBody) {
  twimlReply(res, replyBody);
  if (otherPhone && notifyBody) {
    try {
      await send(otherPhone, notifyBody);
    } catch (err) {
      console.error("Failed to notify other user:", err.message);
    }
  }
}

module.exports = { send, twimlReply, replyAndNotify };
