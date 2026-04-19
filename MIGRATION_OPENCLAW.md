# Moti-Boti → OpenClaw Migration

Moving the bot from GCP Cloud Functions to OpenClaw running locally on a dedicated MacBook Pro.

**What changes:** OpenClaw handles Claude + Telegram. Your existing Node.js tool code (Firebase, Sheets, Calendar, etc.) stays intact and runs as a local API server (`tools-server.js`) that OpenClaw skills call.

**What stays the same:** Firebase database, all data, Telegram bot token, all API keys.

---

## Before You Start — Get Your Credentials

You'll need the values from `.env.yaml` (on the Windows machine). The easiest way to transfer them:

**Option A — AirDrop (fastest)**
1. On the Windows machine, open the repo folder and find `.env.yaml`
2. AirDrop it to the MacBook
3. Save it into the repo folder as `.env.yaml` — the setup script will convert it automatically

**Option B — Email it to yourself**
1. Open `.env.yaml` on the Windows machine
2. Email it to yourself
3. On the Mac, save the attachment into the repo folder as `.env.yaml`

**Option C — Enter manually**
Skip the file transfer. The setup script will ask you for each value one by one.

---

## Step 1 — Install Tools

Open Terminal on the Mac and run each block:

```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

```bash
# Install Node 24
brew install node
node --version
```

```bash
# Install PM2 and OpenClaw
npm install -g pm2
npm install -g openclaw@latest
```

---

## Step 2 — Clone the Repo

GitHub requires the CLI for authentication (no password support):

```bash
brew install gh
gh auth login
```

When `gh auth login` runs:
1. Choose **GitHub.com**
2. Choose **HTTPS**
3. Choose **Login with a web browser**
4. It prints a code like `AB12-CD34` — copy it
5. Open Safari and go to **github.com/login/device**
6. Sign in to GitHub, paste the code, click **Continue → Authorize GitHub CLI**
7. Terminal says "Logged in as zivklempner" — done

```bash
cd ~
gh repo clone zivklempner/moti-boti
cd moti-boti
npm install
```

---

## Step 3 — Run the Setup Script

This single script creates the `.env` file, all OpenClaw workspace files, all skills, and `openclaw.json`.

If you transferred `.env.yaml` in the step above, put it in `~/moti-boti/` first. Then:

```bash
cd ~/moti-boti
bash scripts/setup-openclaw.sh
```

If you chose Option C (no file transfer), the script will prompt you for each credential one by one.

When it finishes it prints your exact next steps.

---

## Step 4 — OpenClaw Onboarding

```bash
openclaw onboard --install-daemon
```

When asked for a model enter:
```
anthropic/claude-haiku-4-5-20251001
```

When asked for an API key enter your `ANTHROPIC_API_KEY` (starts with `sk-ant-`).

```bash
openclaw status
# Should show: gateway running
```

---

## Step 5 — Start Everything

```bash
cd ~/moti-boti

pm2 start tools-server.js --name moti-tools
pm2 start "openclaw gateway start" --name openclaw --interpreter none
pm2 save
pm2 startup
```

`pm2 startup` prints a command — copy and run it. It looks like:
```
sudo env PATH=$PATH:/usr/local/bin pm2 startup launchd -u yourname --hp /Users/yourname
```

Check everything is running:
```bash
pm2 status
curl http://localhost:3001/health
openclaw status
```

---

## Step 6 — Add Telegram User IDs

The bot needs to know Ziv and Tal's Telegram user IDs before it will respond to DMs.

1. DM the bot from Ziv's Telegram account (any message)
2. In Terminal: `openclaw logs --follow`
3. Look for `from.id` in the output — that number is Ziv's ID
4. Do the same from Tal's account
5. Edit `~/.openclaw/openclaw.json` and put both IDs in `allowFrom`:

```bash
nano ~/.openclaw/openclaw.json
```

Change:
```json
"allowFrom": []
```
To:
```json
"allowFrom": [123456789, 987654321]
```

Save (`Ctrl+O`, `Enter`, `Ctrl+X`), then:

```bash
openclaw gateway restart
```

---

## Step 7 — Keep the Mac Always On

1. **System Settings → Battery → Options** — disable "Enable Power Nap"
2. **System Settings → Lock Screen** — set display off to "Never"
3. Keep it plugged in

---

## Step 8 — Test

Send these in the Telegram group:

| Message | Expected |
|---|---|
| `שלום` | Hebrew reply |
| `מה יש ברשימה` | Grocery list from Firebase |
| `הוסף חלב` | Adds to grocery list |
| `רשום: קפה 18 ₪ זיו` | ✅ expense logged |
| `כמה הוצאנו החודש` | Monthly summary |
| `מי חייב למי` | Balance |
| `מה יש בסטנדאפ בתל אביב` | Live shows from mevalim.co.il |
| Voice message | Transcription |

Watch logs:
```bash
pm2 logs
openclaw logs --follow
```

---

## Step 9 — Decommission GCP

Wait a few days to confirm stability, then:

```bash
gcloud functions delete motiWebhook --region=YOUR_REGION
gcloud functions delete motiCron   --region=YOUR_REGION
gcloud scheduler jobs list
gcloud scheduler jobs delete moti-daily-cron  --location=YOUR_REGION
gcloud scheduler jobs delete moti-weekly-cron --location=YOUR_REGION
```

Firebase is **not** deleted — it remains the data layer.

---

## Troubleshooting

**Bot not responding:**
```bash
openclaw logs --follow
```

**Tools API errors:**
```bash
pm2 logs moti-tools
```

**Restart everything:**
```bash
pm2 restart all
openclaw gateway restart
```

**Test the tools API directly:**
```bash
curl http://localhost:3001/health
curl http://localhost:3001/grocery/list
```

**Wrong user IDs / bot ignores messages:**
- Run `openclaw logs --follow`, send a DM, find `from.id`
- Update `allowFrom` in `~/.openclaw/openclaw.json`
- Run `openclaw gateway restart`
