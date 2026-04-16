@echo off
setlocal enabledelayedexpansion

set CLOUDSDK_PYTHON=C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\platform\bundledpython\python.exe

echo ============================================
echo   Moti Boti - GCP Deployment
echo ============================================
echo.

cd /d "%~dp0"

set PROJECT_ID=grocery-bot-263a2
echo Project: %PROJECT_ID%
call gcloud config set project %PROJECT_ID% >nul 2>&1
echo.

echo [1/5] Generating .env.yaml from .env...
node generate-env-yaml.js
if errorlevel 1 (
  echo.
  echo ERROR: Failed to generate .env.yaml
  exit /b 1
)
echo.

echo [2/5] Deploying motiWebhook Cloud Function...
call gcloud functions deploy motiWebhook --project=%PROJECT_ID% --gen2 --runtime=nodejs20 --region=us-central1 --source=. --entry-point=motiWebhook --trigger-http --allow-unauthenticated --memory=512MB --timeout=300s --env-vars-file=.env.yaml
if errorlevel 1 (
  echo.
  echo ERROR: motiWebhook deployment failed
  exit /b 1
)
echo.

echo [3/5] Deploying motiCron Cloud Function...
call gcloud functions deploy motiCron --project=%PROJECT_ID% --gen2 --runtime=nodejs20 --region=us-central1 --source=. --entry-point=motiCron --trigger-http --allow-unauthenticated --memory=256MB --timeout=300s --env-vars-file=.env.yaml
if errorlevel 1 (
  echo.
  echo ERROR: motiCron deployment failed
  exit /b 1
)
echo.

echo [4/5] Registering Telegram webhook...
node register-webhook.js
if errorlevel 1 (
  echo.
  echo ERROR: Webhook registration failed
  exit /b 1
)
echo.

echo [5/5] Setting up Cloud Scheduler jobs...

for /f "tokens=2 delims=:" %%A in ('findstr "CRON_SECRET" .env.yaml') do set RAW_SECRET=%%A
set CRON_SECRET=!RAW_SECRET: =!
set CRON_SECRET=!CRON_SECRET:"=!

for /f "tokens=*" %%U in ('call gcloud functions describe motiCron --project=%PROJECT_ID% --gen2 --region=us-central1 --format="value(serviceConfig.uri)"') do set CRON_URL=%%U

if "!CRON_URL!"=="" (
  echo ERROR: Could not get motiCron URL
  exit /b 1
)

echo CRON_URL = !CRON_URL!
echo.

echo Creating moti-reminders job (every minute)...
call gcloud scheduler jobs create http moti-reminders --location=us-central1 --schedule="* * * * *" --time-zone="Asia/Jerusalem" --uri="!CRON_URL!?secret=!CRON_SECRET!&job=reminders" --http-method=POST --message-body="{\"job\":\"reminders\"}" --headers="Content-Type=application/json" --attempt-deadline=60s --description="Moti: reminders every minute" 2>nul
if errorlevel 1 (
  echo   Job exists - updating...
  call gcloud scheduler jobs update http moti-reminders --location=us-central1 --schedule="* * * * *" --time-zone="Asia/Jerusalem" --uri="!CRON_URL!?secret=!CRON_SECRET!&job=reminders" --http-method=POST --message-body="{\"job\":\"reminders\"}" --headers="Content-Type=application/json" --attempt-deadline=60s
)

echo Creating moti-weekly-summary job (Sundays 9AM)...
call gcloud scheduler jobs create http moti-weekly-summary --location=us-central1 --schedule="0 9 * * 0" --time-zone="Asia/Jerusalem" --uri="!CRON_URL!?secret=!CRON_SECRET!&job=weekly_summary" --http-method=POST --message-body="{\"job\":\"weekly_summary\"}" --headers="Content-Type=application/json" --attempt-deadline=120s --description="Moti: weekly summary Sundays" 2>nul
if errorlevel 1 (
  echo   Job exists - updating...
  call gcloud scheduler jobs update http moti-weekly-summary --location=us-central1 --schedule="0 9 * * 0" --time-zone="Asia/Jerusalem" --uri="!CRON_URL!?secret=!CRON_SECRET!&job=weekly_summary" --http-method=POST --message-body="{\"job\":\"weekly_summary\"}" --headers="Content-Type=application/json" --attempt-deadline=120s
)

echo Creating moti-event-scraper job (daily 3AM)...
call gcloud scheduler jobs create http moti-event-scraper --location=us-central1 --schedule="0 3 * * *" --time-zone="Asia/Jerusalem" --uri="!CRON_URL!?secret=!CRON_SECRET!&job=event_scraper" --http-method=POST --message-body="{\"job\":\"event_scraper\"}" --headers="Content-Type=application/json" --attempt-deadline=300s --description="Moti: daily event scraper" 2>nul
if errorlevel 1 (
  echo   Job exists - updating...
  call gcloud scheduler jobs update http moti-event-scraper --location=us-central1 --schedule="0 3 * * *" --time-zone="Asia/Jerusalem" --uri="!CRON_URL!?secret=!CRON_SECRET!&job=event_scraper" --http-method=POST --message-body="{\"job\":\"event_scraper\"}" --headers="Content-Type=application/json" --attempt-deadline=300s
)

echo.
echo ============================================
echo   Deployment complete!
echo ============================================
echo.
echo Next: send a message in your Telegram group - Moti should respond.
echo To re-deploy after code changes, just run deploy.bat again.
