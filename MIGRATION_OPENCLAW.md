# Moti-Boti → OpenClaw Migration

Moving the bot from GCP Cloud Functions to OpenClaw running locally on a dedicated MacBook Pro.

**What changes:** OpenClaw handles Claude + Telegram. Your existing Node.js tool code (Firebase, Sheets, Calendar, etc.) stays intact and runs as a local API server (`tools-server.js`) that OpenClaw skills call.

**What stays the same:** Firebase database, all data, Telegram bot token, all API keys.

---

## Prerequisites

You'll need these from the existing GCP deployment. Find them in `.env.yaml` in the repo:

- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID` (the group chat ID)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL`
- `OPENAI_API_KEY` (for Whisper)
- `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`

---

## Step 1 — Mac Setup

```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node 24 (OpenClaw requires 24 or 22.16+)
brew install node
node --version   # must show v24.x

# Install PM2 (keeps processes running, auto-restarts on reboot)
npm install -g pm2

# Install OpenClaw
npm install -g openclaw@latest
```

---

## Step 2 — Clone the Repo

GitHub no longer supports password authentication. Use the GitHub CLI instead:

```bash
# Install GitHub CLI
brew install gh

# Authenticate — this will print a code like AB12-CD34 in the terminal
gh auth login
```

When `gh auth login` runs, follow these steps:
1. Choose **GitHub.com**
2. Choose **HTTPS**
3. Choose **Login with a web browser**
4. It prints a code like `AB12-CD34` — **copy it**
5. Open Safari/Chrome and go to **github.com/login/device**
6. Sign in to GitHub if prompted
7. Paste the code and click **Continue → Authorize GitHub CLI**
8. Terminal says "Logged in as zivklempner" — done

Now clone:

```bash
cd ~
gh repo clone zivklempner/moti-boti
cd moti-boti
npm install
```

---

## Step 3 — Create `.env`

Create `~/moti-boti/.env` — copy the values from `.env.yaml` in the repo:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=-100...

FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com

OPENAI_API_KEY=sk-...

GOOGLE_SHEETS_ID=...
GOOGLE_SHEETS_CLIENT_EMAIL=sheets-bot@your-project-id.iam.gserviceaccount.com
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

TOOLS_PORT=3001
```

Test that the tools server starts cleanly:

```bash
node tools-server.js
# Should print: Moti tools API running on :3001
# Ctrl+C to stop
```

---

## Step 4 — OpenClaw Onboarding

```bash
openclaw onboard --install-daemon
```

The wizard will walk you through initial setup. When it asks for a model, enter:
```
anthropic/claude-haiku-4-5-20251001
```

When it asks for an API key, enter your `ANTHROPIC_API_KEY`.

After onboarding completes:

```bash
openclaw status   # should show: gateway running
```

---

## Step 5 — Configure `~/.openclaw/openclaw.json`

Open `~/.openclaw/openclaw.json` and replace its contents with:

```json5
{
  "agent": {
    "model": "anthropic/claude-haiku-4-5-20251001"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_TELEGRAM_BOT_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [ZIV_TELEGRAM_USER_ID, TAL_TELEGRAM_USER_ID],
      "groups": {
        "YOUR_TELEGRAM_CHAT_ID": {
          "enabled": true,
          "requireMention": false
        }
      }
    }
  }
}
```

**To get Telegram user IDs:**
1. DM your bot from Ziv's account
2. Run `openclaw logs --follow` in terminal
3. Look for `from.id` in the output — that's the user ID
4. Repeat for Tal

Replace `YOUR_TELEGRAM_CHAT_ID` with the group chat ID (the `TELEGRAM_CHAT_ID` value from your env, without the `-100` prefix if needed — check the logs to confirm the format).

```bash
openclaw gateway restart
```

---

## Step 6 — Create Workspace Files

### `~/.openclaw/workspace/SOUL.md`

Personality only — tone and style:

```markdown
תדבר עברית בלבד. תמיד. גם אם פונים אליך באנגלית.

כתוב כמו חבר בטלגרם — קצר, ישיר, ידידותי. לא פורמלי.

אל תנסה להיות מצחיק. פשוט עזור.

אמוג'י — מעט ובמינון. רק כשזה מוסיף משהו.

אל תסיים תשובות עם "אם יש לך שאלות..." — פשוט ענה ונגמר.

אין בדיחות. אין הערות חכמות. אין ציניות.
```

### `~/.openclaw/workspace/AGENTS.md`

Operational rules — when and how to use tools:

```markdown
# Moti — Family Assistant

## Users
- **זיו** — male. Hebrew male forms: אתה, קנית, שילמת
- **טל** — female. Hebrew female forms: את, קנית, שילמת

## Tool Rules

### Expenses
ALWAYS call log_expense for any mention of spending money. Never invent results.

Relative dates ("אתמול", "שלשום", "לפני שבוע") → resolve to YYYY-MM-DD using today's date.

Response after log_expense — exactly this format, nothing else:
```
✅ רשמתי: {amount} ₪ ב{merchant}
📂 {categoryNameHe} {categoryEmoji}
📊 {categoryNameHe} החודש: {categoryMonthlyTotal} ₪
```

Response after edit_expense — exactly this format, nothing else:
```
✏️ עדכנתי: {merchant} — {amount} ₪ ({date})
```

### Grocery List
"ניקוי הרשימה" — always ask for confirmation first. Never delete without explicit "כן".

### Calendar
ALWAYS call send_calendar_invite. Never say "זימנתי" without calling the tool first.
All times in Israel timezone (+03:00).

### Shows & Events
ALWAYS call find_shows (not find_events). Never invent events.
Format results: name, date, time, venue, price, purchase link if ticketUrl exists.
If no results — say so directly.

### Reminders
ALWAYS call set_reminder. Resolve relative times ("הלילה ב-21", "מחר בצהריים") to absolute ISO datetimes using today's date.
Response: ✅ תזכורת נקבעה ל-{time}: {text}

### Urgent
Message starting with "דחוף" — the other family member gets a private DM alert.

## Daily Briefing (21:00)
- One non-generic opening sentence summarizing the day
- Grocery items still not purchased
- Today's expenses if any
- Short friendly close
```

### `~/.openclaw/workspace/MEMORY.md`

Initial family facts (the bot will append to this automatically):

```markdown
# Family

- **זיו** — male
- **טל** — female

# Preferences

- Language: Hebrew only
- Currency: ILS (₪)
- Timezone: Asia/Jerusalem (UTC+3)
- Supermarkets: שופרסל, רמי לוי, ויקטורי, מגה
```

---

## Step 7 — Create Skills

Skills tell OpenClaw how to call the local tools API. Create one directory per skill.

```bash
mkdir -p ~/.openclaw/workspace/skills/grocery
mkdir -p ~/.openclaw/workspace/skills/expenses
mkdir -p ~/.openclaw/workspace/skills/calendar
mkdir -p ~/.openclaw/workspace/skills/reminders
mkdir -p ~/.openclaw/workspace/skills/prices
mkdir -p ~/.openclaw/workspace/skills/shows
mkdir -p ~/.openclaw/workspace/skills/receipts
```

### `~/.openclaw/workspace/skills/grocery/SKILL.md`

```markdown
---
name: grocery
description: Manage the family shared grocery list stored in Firebase
---

To manage the grocery list, call the local tools API at http://localhost:3001.

- **Get list:** GET http://localhost:3001/grocery/list
- **Add items:** POST http://localhost:3001/grocery/add — body: {"items": ["item1", "item2"]}
- **Mark done:** POST http://localhost:3001/grocery/done — body: {"query": "item name or number", "by": "Ziv"}
- **Remove item:** POST http://localhost:3001/grocery/remove — body: {"query": "item name or number"}
- **Clear all:** POST http://localhost:3001/grocery/clear — only after explicit user confirmation

Always show the updated list after add/remove/mark operations.
```

### `~/.openclaw/workspace/skills/expenses/SKILL.md`

```markdown
---
name: expenses
description: Log, edit and report household expenses stored in Firebase
---

All expense operations go through the local tools API at http://localhost:3001.

- **Log expense:** POST http://localhost:3001/expenses/log
  Body: {"amount": 120, "merchant": "שופרסל", "paid_by": "זיו", "raw_text": "...", "date": "2026-04-19"}
  The date field is optional — omit it to default to today.

- **Edit expense:** POST http://localhost:3001/expenses/edit
  Body: {"merchant_search": "שופרסל", "date_filter": "2026-04-18", "most_recent": true, "updates": {"amount": 95}}

- **Monthly summary:** GET http://localhost:3001/expenses/summary?year=2026&month=4

- **Balance:** GET http://localhost:3001/expenses/balance

- **Detailed report:** GET http://localhost:3001/expenses/report?year=2026&month=4
```

### `~/.openclaw/workspace/skills/calendar/SKILL.md`

```markdown
---
name: calendar
description: Send Google Calendar invites to Ziv and Tal
---

To create a calendar invite, POST to http://localhost:3001/calendar/invite

Body:
{
  "title": "Event title in Hebrew",
  "start_iso": "2026-04-25T19:00:00+03:00",
  "end_iso": "2026-04-25T20:00:00+03:00",
  "location": "optional location"
}

The response includes a googleCalendarUrl — open it or share it.
Always use +03:00 Israel timezone offset in ISO timestamps.
Default event duration is 1 hour if end time not specified.
```

### `~/.openclaw/workspace/skills/reminders/SKILL.md`

```markdown
---
name: reminders
description: Schedule reminders to be sent to the Telegram group at a future time
---

To set a reminder, POST to http://localhost:3001/reminders/set

Body:
{
  "text": "תזכורת לקחת את הילדים",
  "scheduled_iso": "2026-04-19T21:00:00+03:00",
  "created_by": "Ziv"
}

Always resolve relative times ("הלילה ב-21", "מחר בצהריים", "בשישי") to absolute ISO 8601 datetimes using today's date and Israel timezone (+03:00).
```

### `~/.openclaw/workspace/skills/prices/SKILL.md`

```markdown
---
name: prices
description: Compare real-time grocery prices across Israeli supermarket chains using chp.co.il
---

To compare prices, POST to http://localhost:3001/prices/compare

Body:
{
  "product": "חלב תנובה 3% 1 ליטר",
  "city": "תל אביב"
}

Product name should be in Hebrew. City is required.
The response includes prices per chain — present them sorted cheapest first.
```

### `~/.openclaw/workspace/skills/shows/SKILL.md`

```markdown
---
name: shows
description: Search upcoming shows, concerts, standup, theater in Israel from mevalim.co.il
---

To find shows, POST to http://localhost:3001/shows/find

Body:
{
  "category": "stand-up",
  "region": "תל אביב"
}

Category slugs: stand-up, concerts, theater, shows, musicals, dance, kids-shows, lectures
Hebrew equivalents: סטנדאפ, קונצרטים, תיאטרון, הופעות, מחזמרים, מחול, ילדים, הרצאות

Region is optional. Omit for all Israel.

Present results as: name, date, time, venue, price (if available), purchase link (if ticketUrl present).
After showing results, offer to set a reminder for events that interest them.
```

### `~/.openclaw/workspace/skills/receipts/SKILL.md`

```markdown
---
name: receipts
description: Save parsed receipt data from photos or PDFs, and generate receipt reports
---

To save a receipt, POST to http://localhost:3001/receipts/log

Body:
{
  "store": "אושר עד",
  "date": "2026-04-19",
  "total": 243.50,
  "items": [
    {"name": "חלב תנובה", "qty": 2, "unitPrice": 6.90, "lineTotal": 13.80, "category": "dairy"}
  ]
}

To get a monthly receipt report, GET http://localhost:3001/receipts/report?year=2026&month=4

When someone sends a receipt image or PDF, extract: store name, date, total amount, and line items.
Then call the log endpoint to save it.
```

---

## Step 8 — Start Everything with PM2

```bash
cd ~/moti-boti

# Start the tools API
pm2 start tools-server.js --name moti-tools

# Start OpenClaw gateway
pm2 start "openclaw gateway start" --name openclaw --interpreter none

# Save PM2 process list
pm2 save

# Set up auto-start on Mac reboot
pm2 startup
# Run the command it prints (will look like: sudo env PATH=... pm2 startup ...)
```

Check everything is running:

```bash
pm2 status
# Should show both moti-tools and openclaw as "online"

curl http://localhost:3001/health
# Should return: {"status":"ok","port":3001}

openclaw status
# Should show gateway running
```

---

## Step 9 — Keep the Mac Always On

1. **System Settings → Battery → Options** → disable "Enable Power Nap", disable "Put hard disks to sleep"
2. **System Settings → Lock Screen** → set "Turn display off" to Never (or use a screensaver)
3. Plug in power — don't run on battery

Optional — keep display off but prevent sleep:
```bash
# Run this once; PM2 will restart OpenClaw, not this
caffeinate -i &
```

---

## Step 10 — Test Before Decommissioning GCP

Send these messages in the Telegram group and verify responses:

| Message | Expected |
|---|---|
| `שלום` | Hebrew reply |
| `מה יש ברשימה` | Fetches grocery list from Firebase |
| `הוסף חלב` | Adds to grocery list |
| `רשום: קפה 18 ₪ זיו` | Logs expense, returns ✅ format |
| `כמה הוצאנו החודש` | Monthly expense summary |
| `מי חייב למי` | Balance report |
| `מה יש בסטנדאפ בתל אביב` | Scrapes mevalim.co.il |
| Voice message | Transcribes via Whisper |
| Receipt photo | Extracts and logs |

Watch logs in real time:
```bash
pm2 logs
# or
openclaw logs --follow
```

---

## Step 11 — Decommission GCP

Only do this after the Mac bot has been running stably for a few days.

```bash
# Delete Cloud Functions
gcloud functions delete motiWebhook --region=YOUR_REGION
gcloud functions delete motiCron   --region=YOUR_REGION

# Delete Cloud Scheduler jobs
gcloud scheduler jobs list   # find the job names first
gcloud scheduler jobs delete moti-daily-cron  --location=YOUR_REGION
gcloud scheduler jobs delete moti-weekly-cron --location=YOUR_REGION
```

Firebase is **not** deleted — it's still the data layer for the Mac bot.

---

## Troubleshooting

**Bot not responding in Telegram:**
```bash
openclaw logs --follow   # look for incoming message events
```

**Tools API errors:**
```bash
pm2 logs moti-tools      # check for Firebase auth errors, missing env vars
```

**Restart everything:**
```bash
pm2 restart all
openclaw gateway restart
```

**Check tool API manually:**
```bash
curl http://localhost:3001/grocery/list
curl -X POST http://localhost:3001/expenses/balance
```

**Wrong Telegram user ID / bot not responding to group:**
- DM the bot from Ziv or Tal's account
- Run `openclaw logs --follow` and find `from.id`
- Update `allowFrom` in `~/.openclaw/openclaw.json`
- Run `openclaw gateway restart`
