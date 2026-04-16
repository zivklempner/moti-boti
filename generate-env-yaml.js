#!/usr/bin/env node
// generate-env-yaml.js
// Reads .env and generates .env.yaml for GCP Cloud Functions deployment.
// Run: node generate-env-yaml.js

const fs       = require("fs");
const path     = require("path");
const crypto   = require("crypto");
const readline = require("readline");

const ENV_PATH  = path.join(__dirname, ".env");
const YAML_PATH = path.join(__dirname, ".env.yaml");

// ── Parse .env ────────────────────────────────────────────────────────────────
function parseEnv(content) {
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key   = trimmed.slice(0, idx).trim();
    let   value = trimmed.slice(idx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// ── Escape a value for a YAML double-quoted scalar ───────────────────────────
// GCP env-vars-file uses standard YAML; double-quoted scalars are safest.
function yamlValue(val) {
  const escaped = val
    .replace(/\\/g, "\\\\")   // \ → \\ (important for \n in private keys)
    .replace(/"/g,  '\\"');   // " → \"
  return `"${escaped}"`;
}

// ── Prompt helper ─────────────────────────────────────────────────────────────
function ask(rl, question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error("ERROR: .env file not found at", ENV_PATH);
    process.exit(1);
  }

  const env = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Prompt only for secrets we can't derive automatically
  if (!env.TELEGRAM_BOT_TOKEN) {
    env.TELEGRAM_BOT_TOKEN = await ask(rl, "Enter TELEGRAM_BOT_TOKEN (from @BotFather): ");
  }
  if (!env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = await ask(rl, "Enter OPENAI_API_KEY (for voice transcription, or press Enter to skip): ");
  }

  rl.close();

  // ── Known / derived values ─────────────────────────────────────────────────
  env.TELEGRAM_CHAT_ID    = env.TELEGRAM_CHAT_ID    || "-5295208622";
  env.USER1_TELEGRAM_ID   = env.USER1_TELEGRAM_ID   || "65359435";
  env.USER1_NAME          = "זיו";
  env.USER2_NAME          = "טל";

  // Generate CRON_SECRET if missing
  if (!env.CRON_SECRET) {
    env.CRON_SECRET = crypto.randomBytes(24).toString("hex");
    console.log(`Generated CRON_SECRET: ${env.CRON_SECRET}`);
  }

  // ── Build .env.yaml ────────────────────────────────────────────────────────
  const KEYS = [
    // Telegram
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "USER1_TELEGRAM_ID",
    "USER2_TELEGRAM_ID",
    "CRON_SECRET",
    // Users
    "USER1_NAME",
    "USER2_NAME",
    "USER1_EMAIL",
    "USER2_EMAIL",
    // AI
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    // Firebase
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_DATABASE_URL",
    // Google Sheets (falls back to Firebase creds if absent)
    "GOOGLE_SHEETS_ID",
    "GOOGLE_SHEETS_CLIENT_EMAIL",
    "GOOGLE_SHEETS_PRIVATE_KEY",
    // Email (optional)
    "BOT_EMAIL",
    "BOT_EMAIL_PASSWORD",
  ];

  const lines = [];
  for (const key of KEYS) {
    if (env[key]) lines.push(`${key}: ${yamlValue(env[key])}`);
  }

  fs.writeFileSync(YAML_PATH, lines.join("\n") + "\n", "utf8");
  console.log("✓ .env.yaml written");

  // ── Persist new values back to .env ───────────────────────────────────────
  let envContent = fs.readFileSync(ENV_PATH, "utf8");
  const append   = [];
  const addIfMissing = (key, val) => {
    if (val && !envContent.includes(`${key}=`)) append.push(`${key}=${val}`);
  };
  addIfMissing("TELEGRAM_BOT_TOKEN",  env.TELEGRAM_BOT_TOKEN);
  addIfMissing("TELEGRAM_CHAT_ID",    env.TELEGRAM_CHAT_ID);
  addIfMissing("USER1_TELEGRAM_ID",   env.USER1_TELEGRAM_ID);
  addIfMissing("CRON_SECRET",         env.CRON_SECRET);
  addIfMissing("OPENAI_API_KEY",      env.OPENAI_API_KEY);

  if (append.length) {
    fs.writeFileSync(ENV_PATH, envContent.trimEnd() + "\n\n" + append.join("\n") + "\n");
    console.log("✓ .env updated with new values");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
