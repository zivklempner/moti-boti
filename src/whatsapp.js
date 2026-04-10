const { Client, RemoteAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const { getDb } = require("./firebase");

// ─── Firebase session store for RemoteAuth ────────────────────────────────────
// Stores the zipped session as a base64 string in Firebase so it survives deploys.

class FirebaseStore {
  async sessionExists({ session }) {
    const snap = await getDb().ref(`whatsapp-session/${session}`).once("value");
    return snap.exists();
  }

  async save({ session, data }) {
    // data is a Buffer (zip file)
    const b64 = data.toString("base64");
    await getDb().ref(`whatsapp-session/${session}`).set({ data: b64, savedAt: Date.now() });
  }

  async extract({ session }) {
    const snap = await getDb().ref(`whatsapp-session/${session}`).once("value");
    if (!snap.exists()) return null;
    return Buffer.from(snap.val().data, "base64");
  }

  async delete({ session }) {
    await getDb().ref(`whatsapp-session/${session}`).remove();
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
