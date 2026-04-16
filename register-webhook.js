#!/usr/bin/env node
// register-webhook.js
// Reads TELEGRAM_BOT_TOKEN from .env.yaml, fetches the deployed motiWebhook URL,
// and registers it with Telegram.

const https        = require("https");
const { execSync } = require("child_process");
const fs           = require("fs");
const path         = require("path");

// ── Read .env.yaml ────────────────────────────────────────────────────────────
function readYaml(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ── HTTPS GET helper ──────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Bad JSON: " + data)); }
      });
    }).on("error", reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const yamlPath = path.join(__dirname, ".env.yaml");
  if (!fs.existsSync(yamlPath)) {
    console.error("ERROR: .env.yaml not found — run generate-env-yaml.js first");
    process.exit(1);
  }

  const env   = readYaml(yamlPath);
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN not found in .env.yaml");
    process.exit(1);
  }

  // Get the Cloud Function's URL via gcloud
  // Resolve project ID (gcloud may be configured with a project number)
  let projectFlag = "";
  try {
    const ref = execSync("gcloud config get-value project", { encoding: "utf8" }).trim();
    const id  = execSync(`gcloud projects describe ${ref} --format="value(projectId)"`, { encoding: "utf8" }).trim();
    if (id) projectFlag = `--project=${id}`;
  } catch (_) {}

  console.log("Fetching motiWebhook URL from GCP...");
  let webhookUrl;
  try {
    webhookUrl = execSync(
      `gcloud functions describe motiWebhook ${projectFlag} --gen2 --region=us-central1 --format="value(serviceConfig.uri)"`,
      { encoding: "utf8" }
    ).trim();
  } catch (e) {
    console.error("Failed to get function URL:", e.message);
    process.exit(1);
  }

  if (!webhookUrl) {
    console.error("ERROR: Got empty URL from gcloud — is the function deployed?");
    process.exit(1);
  }

  console.log("Webhook URL:", webhookUrl);

  // Register the webhook with Telegram
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
  const result = await get(apiUrl);

  if (result.ok) {
    console.log("✓ Telegram webhook registered successfully");
  } else {
    console.error("✗ Failed to register webhook:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
