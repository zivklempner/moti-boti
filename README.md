# 🛒 WhatsApp Grocery Bot

A shared grocery list for two people, powered by WhatsApp (Twilio sandbox), Firebase Realtime Database, and Node.js + Express. One person adds items; both see updates instantly.

---

## Table of contents

1. [Project structure](#project-structure)
2. [Local setup](#local-setup)
3. [Set up the Twilio WhatsApp sandbox](#1-set-up-the-twilio-whatsapp-sandbox)
4. [Set up Firebase Realtime Database](#2-set-up-firebase-realtime-database)
5. [Deploy to Railway (free tier)](#3-deploy-to-railway-free-tier)
6. [Point Twilio at your deployed URL](#4-point-twilio-at-your-deployed-url)
7. [Add both phone numbers to the config](#5-add-both-phone-numbers-to-the-config)
8. [Bot commands](#bot-commands)
9. [Environment variables reference](#environment-variables-reference)

---

## Project structure

```
grocery-app/
├── src/
│   ├── index.js      # Express server + webhook router
│   ├── handlers.js   # Command logic (add, done, remove, clear, help…)
│   ├── firebase.js   # Firebase Realtime Database helpers
│   ├── twilio.js     # Twilio send / TwiML reply helpers
│   ├── users.js      # Two-user config resolution
│   └── cron.js       # Weekly summary (node-cron)
├── .env.example      # Copy to .env and fill in your values
├── .gitignore
├── package.json
└── README.md
```

---

## Local setup

```bash
# 1. Clone or download this repo
git clone <your-repo-url>
cd grocery-app

# 2. Install dependencies
npm install

# 3. Copy the env template and fill in your secrets
cp .env.example .env
# edit .env — see sections below for where to get each value

# 4. Start locally (requires Node 18+)
npm run dev        # uses nodemon for auto-reload
# or
npm start
```

To expose your local server to the internet for Twilio webhooks during development, use **ngrok**:

```bash
npx ngrok http 3000
# copy the https://xxxx.ngrok.io URL — use it as your Twilio webhook
```

---

## 1. Set up the Twilio WhatsApp sandbox

> The sandbox is free and requires no WhatsApp Business approval.

1. Sign up at <https://www.twilio.com> (free account is fine).
2. In the Twilio Console, go to **Messaging → Try it out → Send a WhatsApp message**.
3. Note the **sandbox number** (usually `+1 415 523 8886`) and the **join code** (e.g. `join bright-elephant`).
4. From **both** phones, send a WhatsApp message to `+1 415 523 8886` with the join code.
   - Each phone must opt in separately — you have 72 hours before the session expires.
5. From the Console, copy your **Account SID** and **Auth Token** (visible on the Dashboard).
6. Add them to `.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
   ```

---

## 2. Set up Firebase Realtime Database

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it (e.g. `grocery-bot`), disable Google Analytics (optional), click **Create project**.
3. In the left sidebar: **Build → Realtime Database → Create database**.
   - Choose a region close to you.
   - Start in **test mode** (you can lock it down later; the bot authenticates with a service account anyway).
4. Copy the database URL — it looks like:
   `https://grocery-bot-default-rtdb.firebaseio.com`
5. Generate a service account key:
   - Go to **Project settings** (gear icon) → **Service accounts**.
   - Click **Generate new private key** → **Generate key**.
   - A JSON file downloads. Open it and copy the three fields you need:
     ```
     "project_id"   → FIREBASE_PROJECT_ID
     "client_email" → FIREBASE_CLIENT_EMAIL
     "private_key"  → FIREBASE_PRIVATE_KEY  (the whole -----BEGIN … END----- block)
     ```
6. Add them to `.env`:
   ```
   FIREBASE_PROJECT_ID=grocery-bot
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@grocery-bot.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n"
   FIREBASE_DATABASE_URL=https://grocery-bot-default-rtdb.firebaseio.com
   ```
   > **Tip:** keep the entire private key on one line with literal `\n` characters — the app converts them back automatically.

---

## 3. Deploy to Railway (free tier)

Railway gives you a persistent free-tier service without sleeping (unlike Render's free tier, which sleeps after 15 min of inactivity — Railway is the better choice here).

1. Push your code to a GitHub repo.
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   gh repo create grocery-whatsapp-bot --public --source=. --push
   ```
2. Go to <https://railway.app> and sign in with GitHub.
3. Click **New Project → Deploy from GitHub repo** → select your repo.
4. Railway detects `package.json` automatically and runs `npm start`.
5. Add your environment variables:
   - In your Railway project, click the service → **Variables** tab.
   - Add every key from `.env.example` with your real values.
   - Railway sets `PORT` automatically — you don't need to add it.
6. Click **Deploy** (or it deploys automatically on every push).
7. Once deployed, copy the generated domain from the **Settings → Domains** panel.
   It will look like `https://grocery-whatsapp-bot-production.up.railway.app`.

---

## 4. Point Twilio at your deployed URL

1. In the Twilio Console, go to **Messaging → Try it out → Send a WhatsApp message**.
2. Scroll to **Sandbox Configuration**.
3. Set **"When a message comes in"** to:
   ```
   https://your-railway-domain.up.railway.app/webhook
   ```
   Method: **HTTP POST**
4. Click **Save**.

That's it — Twilio will now POST every inbound WhatsApp message to your bot.

---

## 5. Add both phone numbers to the config

Open `.env` and fill in the two phone numbers in E.164 format (country code + number, no spaces):

```
USER1_PHONE=+15551234567
USER1_NAME=Me
USER2_PHONE=+15559876543
USER2_NAME=Spouse
```

- The bot matches the inbound `From` number against these two entries to identify who is messaging.
- Any action by one user triggers a push notification to the other's number.
- If a message arrives from an unregistered number, the bot replies with an error and ignores it.

After changing `.env` locally: restart the server. On Railway: update the Variables panel and Railway redeploys automatically.

---

## Bot commands

| You send | What happens |
|---|---|
| `milk, eggs, bread` | Adds all three items |
| `list` | Shows the full list with status |
| `done 2` | Marks item #2 as bought |
| `done eggs` | Marks "eggs" as bought (case-insensitive) |
| `remove 3` | Deletes item #3 |
| `remove bread` | Deletes "bread" (case-insensitive) |
| `clear` | Asks for confirmation |
| `YES` | Confirms a pending action (clear or add duplicate) |
| `help` | Shows command reference |

**List output format:**

```
1. • milk
2. ✓ eggs (bought by Ziv)
3. • bread
```

**Smart deduplication:** if you add an item already on the list, the bot warns you and waits for `YES` before adding again.

**Real-time sync:** every action (add, done, remove, clear) instantly notifies the other user via WhatsApp.

**Weekly summary:** every Sunday at 9 AM (server time) both users receive a count of pending vs. bought items.

---

## Environment variables reference

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | From Twilio Console Dashboard |
| `TWILIO_AUTH_TOKEN` | From Twilio Console Dashboard |
| `TWILIO_WHATSAPP_NUMBER` | Sandbox number, prefixed with `whatsapp:` |
| `USER1_PHONE` | First user's phone (E.164) |
| `USER1_NAME` | First user's display name |
| `USER2_PHONE` | Second user's phone (E.164) |
| `USER2_NAME` | Second user's display name |
| `FIREBASE_PROJECT_ID` | From Firebase service account JSON |
| `FIREBASE_CLIENT_EMAIL` | From Firebase service account JSON |
| `FIREBASE_PRIVATE_KEY` | From Firebase service account JSON |
| `FIREBASE_DATABASE_URL` | From Firebase Realtime Database settings |
| `PORT` | Set automatically by Railway; defaults to 3000 locally |
