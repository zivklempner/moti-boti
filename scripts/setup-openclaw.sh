#!/usr/bin/env bash
# Run this once on the Mac after cloning the repo.
# It creates the .env file, all OpenClaw workspace files, skills, and openclaw.json.

set -e
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="$HOME/.openclaw/workspace"
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "=============================="
echo "  Moti-Boti OpenClaw Setup"
echo "=============================="
echo ""

# ── Step 1: Get credentials ──────────────────────────────────────────────────

ENV_FILE="$REPO_DIR/.env"

# If .env.yaml was AirDropped / copied next to this repo, convert it automatically
YAML_FILE="$REPO_DIR/.env.yaml"
if [ -f "$YAML_FILE" ] && [ ! -f "$ENV_FILE" ]; then
  echo "Found .env.yaml — converting to .env..."
  # Convert "KEY: value" → "KEY=value", strip leading spaces and quotes
  grep -v '^#' "$YAML_FILE" | grep ':' | sed "s/: /=/" | sed "s/^  //" > "$ENV_FILE"
  echo -e "${GREEN}✓ .env created from .env.yaml${NC}"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env file found. Enter your credentials below."
  echo "(Find these in .env.yaml on your Windows machine or in the GCP console)"
  echo ""

  prompt() {
    local KEY="$1"
    local LABEL="$2"
    echo -n "  $LABEL: "
    read -r VAL
    echo "$KEY=$VAL" >> "$ENV_FILE"
  }

  touch "$ENV_FILE"
  prompt "ANTHROPIC_API_KEY"      "Anthropic API key (sk-ant-...)"
  prompt "TELEGRAM_BOT_TOKEN"     "Telegram bot token"
  prompt "TELEGRAM_CHAT_ID"       "Telegram group chat ID (-100...)"
  prompt "FIREBASE_PROJECT_ID"    "Firebase project ID"
  prompt "FIREBASE_CLIENT_EMAIL"  "Firebase client email"
  echo -n "  Firebase private key (paste full key, press Enter twice when done): "
  PRIVKEY=""
  while IFS= read -r LINE; do
    [ -z "$LINE" ] && break
    PRIVKEY="$PRIVKEY$LINE\n"
  done
  echo "FIREBASE_PRIVATE_KEY=\"$PRIVKEY\"" >> "$ENV_FILE"
  prompt "FIREBASE_DATABASE_URL"  "Firebase database URL (https://...firebaseio.com)"
  prompt "OPENAI_API_KEY"         "OpenAI API key (sk-...)"
  prompt "GOOGLE_SHEETS_ID"       "Google Sheets ID (or press Enter to skip)"
  prompt "GOOGLE_SHEETS_CLIENT_EMAIL" "Google Sheets client email (or Enter to skip)"
  echo -n "  Google Sheets private key (or press Enter to skip): "
  SHEETSKEY=""
  while IFS= read -r LINE; do
    [ -z "$LINE" ] && break
    SHEETSKEY="$SHEETSKEY$LINE\n"
  done
  [ -n "$SHEETSKEY" ] && echo "GOOGLE_SHEETS_PRIVATE_KEY=\"$SHEETSKEY\"" >> "$ENV_FILE"
  echo "TOOLS_PORT=3001" >> "$ENV_FILE"

  echo -e "${GREEN}✓ .env created${NC}"
fi

# Load env vars
set -a
source "$ENV_FILE"
set +a

echo -e "${GREEN}✓ Credentials loaded${NC}"

# ── Step 2: Create OpenClaw workspace directories ────────────────────────────

mkdir -p "$WORKSPACE/skills/grocery"
mkdir -p "$WORKSPACE/skills/expenses"
mkdir -p "$WORKSPACE/skills/calendar"
mkdir -p "$WORKSPACE/skills/reminders"
mkdir -p "$WORKSPACE/skills/prices"
mkdir -p "$WORKSPACE/skills/shows"
mkdir -p "$WORKSPACE/skills/receipts"

echo -e "${GREEN}✓ Workspace directories created${NC}"

# ── Step 3: SOUL.md ──────────────────────────────────────────────────────────

cat > "$WORKSPACE/SOUL.md" << 'SOUL'
תדבר עברית בלבד. תמיד. גם אם פונים אליך באנגלית.

כתוב כמו חבר בטלגרם — קצר, ישיר, ידידותי. לא פורמלי.

אל תנסה להיות מצחיק. פשוט עזור.

אמוג'י — מעט ובמינון. רק כשזה מוסיף משהו.

אל תסיים תשובות עם "אם יש לך שאלות..." — פשוט ענה ונגמר.

אין בדיחות. אין הערות חכמות. אין ציניות.
SOUL

echo -e "${GREEN}✓ SOUL.md created${NC}"

# ── Step 4: AGENTS.md ────────────────────────────────────────────────────────

cat > "$WORKSPACE/AGENTS.md" << 'AGENTS'
# Moti — Family Assistant

## Users
- **זיו** — male. Hebrew male forms: אתה, קנית, שילמת
- **טל** — female. Hebrew female forms: את, קנית, שילמת

## Tool Rules

### Expenses
ALWAYS call log_expense for any mention of spending money. Never invent results.

Relative dates ("אתמול", "שלשום", "לפני שבוע") → resolve to YYYY-MM-DD using today's date.

Response after log_expense — exactly this format, nothing else:
✅ רשמתי: {amount} ₪ ב{merchant}
📂 {categoryNameHe} {categoryEmoji}
📊 {categoryNameHe} החודש: {categoryMonthlyTotal} ₪

Response after edit_expense — exactly this format, nothing else:
✏️ עדכנתי: {merchant} — {amount} ₪ ({date})

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
AGENTS

echo -e "${GREEN}✓ AGENTS.md created${NC}"

# ── Step 5: MEMORY.md ────────────────────────────────────────────────────────

cat > "$WORKSPACE/MEMORY.md" << 'MEMORY'
# Family

- **זיו** — male
- **טל** — female

# Preferences

- Language: Hebrew only
- Currency: ILS (₪)
- Timezone: Asia/Jerusalem (UTC+3)
- Supermarkets: שופרסל, רמי לוי, ויקטורי, מגה
MEMORY

echo -e "${GREEN}✓ MEMORY.md created${NC}"

# ── Step 6: Skills ───────────────────────────────────────────────────────────

cat > "$WORKSPACE/skills/grocery/SKILL.md" << 'SKILL'
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
SKILL

cat > "$WORKSPACE/skills/expenses/SKILL.md" << 'SKILL'
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
SKILL

cat > "$WORKSPACE/skills/calendar/SKILL.md" << 'SKILL'
---
name: calendar
description: Send Google Calendar invites to Ziv and Tal
---

To create a calendar invite, POST to http://localhost:3001/calendar/invite

Body: {"title": "Event title in Hebrew", "start_iso": "2026-04-25T19:00:00+03:00", "end_iso": "2026-04-25T20:00:00+03:00", "location": "optional"}

The response includes a googleCalendarUrl — open it or share it.
Always use +03:00 Israel timezone offset. Default duration is 1 hour if end not specified.
SKILL

cat > "$WORKSPACE/skills/reminders/SKILL.md" << 'SKILL'
---
name: reminders
description: Schedule reminders to be sent to the Telegram group at a future time
---

To set a reminder, POST to http://localhost:3001/reminders/set

Body: {"text": "תזכורת לקחת את הילדים", "scheduled_iso": "2026-04-19T21:00:00+03:00", "created_by": "Ziv"}

Always resolve relative times ("הלילה ב-21", "מחר בצהריים", "בשישי") to absolute ISO 8601 datetimes using today's date and Israel timezone (+03:00).
SKILL

cat > "$WORKSPACE/skills/prices/SKILL.md" << 'SKILL'
---
name: prices
description: Compare real-time grocery prices across Israeli supermarket chains using chp.co.il
---

To compare prices, POST to http://localhost:3001/prices/compare

Body: {"product": "חלב תנובה 3% 1 ליטר", "city": "תל אביב"}

Product name in Hebrew. City is required. Present results sorted cheapest first.
SKILL

cat > "$WORKSPACE/skills/shows/SKILL.md" << 'SKILL'
---
name: shows
description: Search upcoming shows, concerts, standup, theater in Israel from mevalim.co.il
---

To find shows, POST to http://localhost:3001/shows/find

Body: {"category": "stand-up", "region": "תל אביב"}

Category slugs: stand-up, concerts, theater, shows, musicals, dance, kids-shows, lectures
Hebrew: סטנדאפ, קונצרטים, תיאטרון, הופעות, מחזמרים, מחול, ילדים, הרצאות

Region is optional. Present: name, date, time, venue, price, purchase link if available.
After results, offer to set a reminder for events they like.
SKILL

cat > "$WORKSPACE/skills/receipts/SKILL.md" << 'SKILL'
---
name: receipts
description: Save parsed receipt data from photos or PDFs, and generate receipt reports
---

To save a receipt, POST to http://localhost:3001/receipts/log
Body: {"store": "אושר עד", "date": "2026-04-19", "total": 243.50, "items": [{"name": "חלב תנובה", "qty": 2, "unitPrice": 6.90, "lineTotal": 13.80, "category": "dairy"}]}

To get a monthly report, GET http://localhost:3001/receipts/report?year=2026&month=4

When someone sends a receipt image or PDF, extract store, date, total, and line items, then call the log endpoint.
SKILL

echo -e "${GREEN}✓ All skills created${NC}"

# ── Step 7: openclaw.json ────────────────────────────────────────────────────

# Strip the -100 prefix from chat ID for the key (OpenClaw uses the raw ID)
CHAT_ID_CLEAN="${TELEGRAM_CHAT_ID}"

cat > "$OPENCLAW_CONFIG" << OCJSON
{
  "agent": {
    "model": "anthropic/claude-haiku-4-5-20251001"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "dmPolicy": "allowlist",
      "allowFrom": [],
      "groups": {
        "${CHAT_ID_CLEAN}": {
          "enabled": true,
          "requireMention": false
        }
      }
    }
  }
}
OCJSON

echo -e "${GREEN}✓ openclaw.json created${NC}"

# ── Step 8: Done ─────────────────────────────────────────────────────────────

echo ""
echo "=============================="
echo -e "${GREEN}  Setup complete!${NC}"
echo "=============================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Start the tools API and OpenClaw:"
echo "       cd $REPO_DIR"
echo "       pm2 start tools-server.js --name moti-tools"
echo "       pm2 start \"openclaw gateway start\" --name openclaw --interpreter none"
echo "       pm2 save"
echo "       pm2 startup   ← run the command it prints"
echo ""
echo "  2. Add Telegram user IDs (Ziv + Tal):"
echo "       DM your bot from each account, then run:"
echo "       openclaw logs --follow"
echo "       Look for 'from.id' — add both IDs to allowFrom in:"
echo "       $OPENCLAW_CONFIG"
echo "       Then: openclaw gateway restart"
echo ""
echo "  3. Test in the Telegram group:"
echo "       שלום → bot replies in Hebrew"
echo "       מה יש ברשימה → grocery list from Firebase"
echo "       רשום: קפה 18 ₪ זיו → logs expense"
echo ""
echo -e "${YELLOW}  Full guide: https://github.com/zivklempner/moti-boti/blob/master/MIGRATION_OPENCLAW.md${NC}"
echo ""
