const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");

let client;
let currentQRDataUrl = null;
let isReady = false;

function getClient() { return client; }
function getCurrentQR() { return currentQRDataUrl; }
function isClientReady() { return isReady; }

async function initWhatsApp(onMessage) {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: "/data/.wwebjs_auth" }),
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
    console.log("QR code received — visit /qr to scan it");
    currentQRDataUrl = await qrcode.toDataURL(qr);
    isReady = false;
  });

  client.on("authenticated", () => {
    console.log("WhatsApp authenticated ✓");
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
