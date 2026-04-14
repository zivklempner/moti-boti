# Moti Boti — WhatsApp → Telegram + GCP Migration Guide

## Overview

| Layer | Before | After |
|---|---|---|
| Messaging | whatsapp-web.js (headless Chrome) | Telegraf + Telegram Bot API (webhook) |
| Hosting | Railway (persistent server) | GCP Cloud Functions Gen 2 (serverless) |
| Cron jobs | node-cron (in-process) | Cloud Scheduler (HTTP triggers) |
| Session storage | Firebase (3+ GB WhatsApp session) | Not needed — bot token never expires |
| Entry point | `src/index.js` | `src/functions.js` |

Business logic is **unchanged**: `claude.js`, `expenses.js`, `sheets.js`, `whisper.js`, `reminders.js`, `firebase.js`.

---

## Environment Variables

### Add these

| Variable | Description | How to get it |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot auth token | @BotFather → /newbot |
| `TELEGRAM_CHAT_ID` | Numeric group chat ID | See "How to get the chat ID" below |
| `USER1_TELEGRAM_ID` | Ziv's Telegram user ID | See "How to get user IDs" below |
| `USER2_TELEGRAM_ID` | Tal's Telegram user ID | See "How to get user IDs" below |
| `CRON_SECRET` | Shared secret for Cloud Scheduler auth | `openssl rand -hex 24` |

### Remove these (no longer needed)

| Variable | Reason |
|---|---|
| `WHATSAPP_GROUP_ID` | Replaced by `TELEGRAM_CHAT_ID` |
| `USER1_PHONE` | Replaced by `USER1_TELEGRAM_ID` |
| `USER2_PHONE` | Replaced by `USER2_TELEGRAM_ID` |
| `CHROMIUM_PATH` | No more Puppeteer |
| `ADMIN_TOKEN` | /setup-charts endpoint removed |

### Keep these unchanged

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIREBASE_*`, `GOOGLE_SHEETS_*`,
`USER1_NAME`, `USER2_NAME`, `FIREBASE_DATABASE_URL`

---

## How to get the Telegram Chat ID

1. Create the family Telegram group
2. Add your bot to the group
3. Send any message to the group
4. Open: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
5. Find `"chat":{"id":...}` in the response — that negative number is `TELEGRAM_CHAT_ID`

Or use [@userinfobot](https://t.me/userinfobot) — forward a message from the group to it.

## How to get Telegram User IDs

1. Have Ziv and Tal each message [@userinfobot](https://t.me/userinfobot) directly
2. It replies with their numeric user ID
3. Set `USER1_TELEGRAM_ID` (Ziv) and `USER2_TELEGRAM_ID` (Tal) to those numbers

---

## Deployment Steps

### 1. Create the Telegram bot

```
1. Open Telegram → search @BotFather
2. /newbot → follow prompts → copy the token
3. Add the bot to your family group
4. Give it admin rights (or at minimum: "Send Messages")
```

### 2. Set the webhook

After deploying the Cloud Function, register the webhook once:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://REGION-PROJECT.cloudfunctions.net/motiWebhook"
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

### 3. Deploy Cloud Functions

```bash
# Deploy the webhook function
gcloud functions deploy motiWebhook \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=motiWebhook \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512MB \
  --timeout=300s \
  --set-env-vars="TELEGRAM_BOT_TOKEN=...,TELEGRAM_CHAT_ID=...,..."

# Deploy the cron function
gcloud functions deploy motiCron \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=motiCron \
  --trigger-http \
  --allow-unauthenticated \
  --memory=256MB \
  --timeout=300s \
  --set-env-vars="TELEGRAM_BOT_TOKEN=...,CRON_SECRET=..."
```

> Tip: use `--set-env-vars-file=.env.yaml` to avoid long command lines.
> Create `.env.yaml` from your `.env` file (never commit it).

### 4. Set up Cloud Scheduler

```bash
export CRON_URL=https://us-central1-PROJECT_ID.cloudfunctions.net/motiCron
export CRON_SECRET=your-secret
./setup-scheduler.sh
```

### 5. Test

```bash
# Send a message in the Telegram group — bot should respond
# Trigger a reminder check manually:
gcloud scheduler jobs run moti-reminders --location=us-central1
```

---

## Local Testing with functions-framework

```bash
npm install --save-dev @google-cloud/functions-framework

# Terminal 1 — serve the webhook function
npx functions-framework --target=motiWebhook --port=8080

# Terminal 2 — use ngrok to get a public HTTPS URL
npx ngrok http 8080

# Set the webhook to the ngrok URL (do this once per ngrok session)
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://XXXX.ngrok.io"

# Test the cron locally
curl -X POST "http://localhost:8080?job=reminders&secret=your-secret" \
  -H "Content-Type: application/json" \
  -d '{"job":"reminders"}'
```

---

## Roll Back Plan

The old Railway deployment (`src/index.js` + `src/whatsapp.js`) is **not deleted** — it still exists on the `master` branch. To roll back:

1. Re-deploy Railway from the same repo (it uses `src/index.js` as entry point via `npm start`)
2. Scan the WhatsApp QR code again
3. Delete the Telegram webhook: `curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`

Firebase data (expenses, groceries, reminders, history) is shared between both deployments — no data migration needed.

---

## Files Added / Changed

| File | Status | Notes |
|---|---|---|
| `src/telegram.js` | New | Telegram bot wrapper (sendToGroup, sendDM, downloadTelegramFile) |
| `src/functions.js` | New | Cloud Functions entry point (motiWebhook, motiCron) |
| `setup-scheduler.sh` | New | One-time Cloud Scheduler setup |
| `src/claude.js` | Minor | `set_reminder` now reads `TELEGRAM_CHAT_ID \|\| WHATSAPP_GROUP_ID` |
| `src/index.js` | Kept | Old Railway/WhatsApp entry point — safe to delete after validation |
| `src/whatsapp.js` | Kept | Old WhatsApp layer — safe to delete after validation |
| `src/cron.js` | Kept | Old node-cron — safe to delete after validation |

---

## Cost Estimate (GCP free tier, family usage)

| Resource | Free tier | Expected usage | Cost |
|---|---|---|---|
| Cloud Functions invocations | 2M/month | ~3K/month | **$0** |
| Cloud Functions compute | 400K GB-s/month | ~5K GB-s/month | **$0** |
| Cloud Scheduler jobs | 3 free jobs | 3 jobs | **$0** |
| Firebase Realtime DB | 1 GB storage | ~50 MB | **$0** |
| **Total** | | | **~$0/month** |
