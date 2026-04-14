#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-scheduler.sh
# Creates the Cloud Scheduler jobs that replace node-cron.
# Run once after deploying the Cloud Functions.
#
# Prerequisites:
#   gcloud auth login
#   gcloud config set project YOUR_PROJECT_ID
#   Cloud Scheduler API enabled: gcloud services enable cloudscheduler.googleapis.com
#
# Usage:
#   chmod +x setup-scheduler.sh
#   CRON_URL=https://REGION-PROJECT.cloudfunctions.net/motiCron \
#   CRON_SECRET=your-secret-here \
#   ./setup-scheduler.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [[ -z "${CRON_URL:-}" ]]; then
  echo "ERROR: CRON_URL is not set."
  echo "  export CRON_URL=https://REGION-PROJECT_ID.cloudfunctions.net/motiCron"
  exit 1
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "ERROR: CRON_SECRET is not set."
  echo "  export CRON_SECRET=your-secret-here"
  exit 1
fi

REGION="${GCP_REGION:-us-central1}"
TZ="Asia/Jerusalem"

echo "Creating Cloud Scheduler jobs..."
echo "  CRON_URL : $CRON_URL"
echo "  REGION   : $REGION"
echo "  TIMEZONE : $TZ"
echo ""

# ── 1. Reminders — every minute ───────────────────────────────────────────────
gcloud scheduler jobs create http moti-reminders \
  --location="$REGION" \
  --schedule="* * * * *" \
  --time-zone="$TZ" \
  --uri="${CRON_URL}?secret=${CRON_SECRET}&job=reminders" \
  --http-method=POST \
  --message-body='{"job":"reminders"}' \
  --headers="Content-Type=application/json" \
  --attempt-deadline=60s \
  --description="Moti: fire due reminders every minute"

echo "✓ moti-reminders created"

# ── 2. Weekly summary — Sundays 9:00 AM Israel time ──────────────────────────
gcloud scheduler jobs create http moti-weekly-summary \
  --location="$REGION" \
  --schedule="0 9 * * 0" \
  --time-zone="$TZ" \
  --uri="${CRON_URL}?secret=${CRON_SECRET}&job=weekly_summary" \
  --http-method=POST \
  --message-body='{"job":"weekly_summary"}' \
  --headers="Content-Type=application/json" \
  --attempt-deadline=120s \
  --description="Moti: weekly grocery + expense summary on Sundays"

echo "✓ moti-weekly-summary created"

# ── 3. Event scraper — daily 3:00 AM Israel time ─────────────────────────────
gcloud scheduler jobs create http moti-event-scraper \
  --location="$REGION" \
  --schedule="0 3 * * *" \
  --time-zone="$TZ" \
  --uri="${CRON_URL}?secret=${CRON_SECRET}&job=event_scraper" \
  --http-method=POST \
  --message-body='{"job":"event_scraper"}' \
  --headers="Content-Type=application/json" \
  --attempt-deadline=300s \
  --description="Moti: daily event scraper (Bravo/Leaan)"

echo "✓ moti-event-scraper created"

echo ""
echo "All scheduler jobs created. To list them:"
echo "  gcloud scheduler jobs list --location=$REGION"
echo ""
echo "To run a job manually (e.g. to test):"
echo "  gcloud scheduler jobs run moti-reminders --location=$REGION"
