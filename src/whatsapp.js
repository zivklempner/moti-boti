const { Client, RemoteAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { getDb } = require("./firebase");

// ─── Firebase session store for RemoteAuth ────────────────────────────────────
// RemoteAuth calls compressSession() first, producing a zip, THEN calls:
//   save({ session: dirPath })        — dirPath is e.g. /tmp/.wwebjs_auth/RemoteAuth-grocery-bot
//                                       the zip already exists at dirPath + '.zip'
//   extract({ session: name,
//             path: destZipPath })    — write the stored zip to destZipPath
//   sessionExists({ session: name })  — name is e.g. "RemoteAuth-grocery-bot"
//   delete({ session: name })

class FirebaseStore {
  _key(session) {
    // session may be a full path or just a name — always use basename
    return path.basename(session).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  async sessionExists({ session }) {
    const snap = await getDb().ref(`whatsapp-session/${this._key(session)}`).once("value");
    return snap.exists();
  }

  async save({ session }) {
    // RemoteAuth already created session.zip — just read and store it
    const zipPath = `${session}.zip`;
    const data = fs.readFileSync(zipPath);
    const b64 = data.toString("base64");
    await getDb()
      .ref(`whatsapp-session/${this._key(session)}`)
      .set({ data: b64, savedAt: Date.now() });
    console.log(`Session saved to Firebase ✓ (${Math.round(b64.length / 1024)} KB)`);
  }

  async extract({ session, path: destZipPath }) {
    const snap = await getDb().ref(`whatsapp-session/${this._key(session)}`).once("value");
    if (!snap.exists()) throw new Error("No saved session in Firebase");
    const buf = Buffer.from(snap.val().data, "base64");
    // Ensure parent directory exists before writing
    fs.mkdirSync(path.dirname(destZipPath), { recursive: true });
    fs.writeFileSync(destZipPath, buf);
    console.log(`Session restored from Firebase ✓ (${Math.round(buf.length / 1024)} KB)`);
  }

  async delete({ session }) {
    await getDb().ref(`whatsapp-session/${this._key(session)}`).remove();
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

let client;
let currentQRDataUrl = null;
let isReady = false;

function getCurrentQR() { return currentQRDataUrl; }
function isClientReady() { return isReady; }

async function initWhatsApp(onMessage) {
  const store = new FirebaseStore();

  client = new Client({
    authStrategy: new RemoteAuth({
      store,
      clientId: "grocery-bot",
      dataPath: "/tmp/.wwebjs_auth",
      backupSyncIntervalMs: 60_000,   // save session to Firebase every 60s
    }),
    puppeteer: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", async (qr) => {
    console.log("QR code ready — visit /qr to scan");
    currentQRDataUrl = await qrcode.toDataURL(qr);
    isReady = false;
  });

  client.on("authenticated", () => {
    console.log("WhatsApp authenticated ✓");
  });

  client.on("remote_session_saved", () => {
    console.log("Session saved to Firebase ✓");
  });

  client.on("ready", () => {
    console.log("WhatsApp client ready ✓");
    currentQRDataUrl = null;
    isReady = true;
  });

  client.on("disconnected", (reason) => {
    console.log("WhatsApp disconnected:", reason);
    isReady = false;
  });

  client.on("message", onMessage);

  await client.initialize();
}

async function sendToGroup(groupId, text) {
  if (!isReady) throw new Error("WhatsApp client not ready");
  await client.sendMessage(groupId, text);
}

async function sendDM(phone, text) {
  if (!isReady) throw new Error("WhatsApp client not ready");
  // phone is E.164 e.g. +972507556620 → 972507556620@c.us
  const chatId = phone.replace("+", "") + "@c.us";
  await client.sendMessage(chatId, text);
}

module.exports = { initWhatsApp, sendToGroup, sendDM, getCurrentQR, isClientReady };
