const { Client, RemoteAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const AdmZip = require("adm-zip");
const { getDb } = require("./firebase");

// ─── Firebase session store for RemoteAuth ────────────────────────────────────
// RemoteAuth calls:
//   save({ session: dirPath })   — dirPath is the session folder to zip+save
//   extract({ session: name, path: destZipPath }) — write saved zip to destZipPath
//   sessionExists({ session: name }) — true/false
//   delete({ session: name })

class FirebaseStore {
  _fbKey(name) {
    // Firebase keys can't contain dots, slashes etc.
    return `whatsapp-session/${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }

  async sessionExists({ session }) {
    const snap = await getDb().ref(this._fbKey(session)).once("value");
    return snap.exists();
  }

  async save({ session }) {
    // session = path to the session directory — zip it and store base64 in Firebase
    const zip = new AdmZip();
    zip.addLocalFolder(session);
    const b64 = zip.toBuffer().toString("base64");
    await getDb().ref(this._fbKey(session)).set({ data: b64, savedAt: Date.now() });
    console.log(`Session saved to Firebase (${Math.round(b64.length / 1024)} KB)`);
  }

  async extract({ session, path: destZipPath }) {
    // session = session name, destZipPath = where to write the zip file
    const snap = await getDb().ref(this._fbKey(session)).once("value");
    if (!snap.exists()) throw new Error("No saved session found in Firebase");
    const buf = Buffer.from(snap.val().data, "base64");
    fs.writeFileSync(destZipPath, buf);
    console.log(`Session restored from Firebase (${Math.round(buf.length / 1024)} KB)`);
  }

  async delete({ session }) {
    await getDb().ref(this._fbKey(session)).remove();
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

module.exports = { initWhatsApp, sendToGroup, getCurrentQR, isClientReady };
