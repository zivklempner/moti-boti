# Moti Boti — Personal WhatsApp Assistant

An AI-powered family assistant living inside a WhatsApp group. Built with Node.js, [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), Claude (Anthropic Haiku), and Firebase Realtime Database. Deployed on Railway.

---

## How it works

1. A dedicated phone number (eSIM) runs the WhatsApp session linked to the bot.
2. Every message sent to the family group is picked up by whatsapp-web.js.
3. The message is passed to Claude (Haiku) with an agentic tool-use loop.
4. Claude calls the appropriate tools (grocery list, expenses, calendar, etc.) and replies in Hebrew.

No Twilio. No webhooks. The bot connects directly to WhatsApp via QR scan.

---

## Features

| Feature | How to trigger |
|---|---|
| Grocery list — add, view, tick off, remove, clear | Natural Hebrew, e.g. "תוסיף חלב וביצים" |
| Expense tracking — log purchases, monthly report | "הוצאתי 250 שקל בשופרסל" |
| Receipt scanning — upload a PDF grocery receipt | Send the PDF file to the group |
| Calendar invite — schedule events, get Google Calendar link | "תזמין פגישה עם אייל ביום שלישי ב-7 בערב" |
| Urgent escalation — privately DM the other family member | Start the message with "דחוף" |
| Weekly summary | Every Sunday 9 AM (Israel time), automatic |
| Daily briefing | Every day 9 PM (Israel time), automatic |

---

## Project structure

```
moti-boti/
├── src/
│   ├── index.js       # Express server, WhatsApp client bootstrap, message routing
│   ├── claude.js      # Claude (Anthropic) agentic loop + tool definitions
│   ├── whatsapp.js    # whatsapp-web.js client wrapper (send, QR, session)
│   ├── firebase.js    # Firebase Realtime Database helpers (grocery list, session)
│   ├── expenses.js    # Expense tracking (log + monthly report)
│   ├── receipts.js    # Receipt storage and insights
│   ├── calendar.js    # Google Calendar URL builder
│   ├── history.js     # Conversation history (per group, stored in Firebase)
│   ├── chat.js        # Chat logging helpers
│   └── cron.js        # Scheduled tasks: weekly summary + daily briefing
├── public/            # Static dashboard (served at /dashboard)
├── .env.example       # Copy to .env and fill in your values
├── package.json
└── README.md
```

---

## Local setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd moti-boti

# 2. Install dependencies
npm install

# 3. Copy the env template and fill in your secrets
cp .env.example .env

# 4. Start locally (requires Node 18+)
npm run dev   # nodemon with auto-reload
# or
npm start
```

On first run, open `http://localhost:3000/qr` in a browser and scan the QR code with the **bot's WhatsApp number** (Linked Devices → Link a Device). The session is persisted to Firebase so you won't need to scan again after restarts.

---

## Set up Firebase Realtime Database

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project.
2. **Build → Realtime Database → Create database** (start in test mode).
3. Generate a service account key:
   - **Project settings** → **Service accounts → Generate new private key**
   - Copy `project_id`, `client_email`, and `private_key` from the downloaded JSON.
4. Add them to `.env` together with the database URL.

---

## Deploy to Railway

1. Push your code to GitHub:
   ```bash
   git init && git add . && git commit -m "initial commit"
   gh repo create moti-boti --public --source=. --push
   ```
2. Go to [railway.app](https://railway.app), sign in with GitHub.
3. **New Project → Deploy from GitHub repo** → select `moti-boti`.
4. Railway detects `package.json` and runs `npm start` automatically.
5. Add all environment variables under the service's **Variables** tab (`PORT` is set automatically).
6. After deploy, open `https://<your-railway-domain>/qr` and scan the QR once to link the bot's WhatsApp.
7. To find your family group ID: send any message to the group — Railway logs will print:
   ```
   Set this in Railway env vars:
     WHATSAPP_GROUP_ID=1234567890-1234567890@g.us
   ```
   Add that value and redeploy.

---

## Environment variables

| Variable | Description |
|---|---|
| `USER1_PHONE` | First user's phone in E.164 format (e.g. `+972501234567`) |
| `USER1_NAME` | First user's display name |
| `USER2_PHONE` | Second user's phone in E.164 format |
| `USER2_NAME` | Second user's display name |
| `WHATSAPP_GROUP_ID` | Family group ID (see deploy step 7 above) |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) |
| `FIREBASE_PROJECT_ID` | From Firebase service account JSON |
| `FIREBASE_CLIENT_EMAIL` | From Firebase service account JSON |
| `FIREBASE_PRIVATE_KEY` | From Firebase service account JSON |
| `FIREBASE_DATABASE_URL` | From Firebase Realtime Database settings |
| `PORT` | Set automatically by Railway; defaults to `3000` locally |
