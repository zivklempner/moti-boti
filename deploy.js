#!/usr/bin/env node
// deploy.js — full GCP deployment script for Moti Boti
// Usage: node deploy.js

const { execSync, spawnSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

const PROJECT_ID = "grocery-bot-263a2";
const REGION     = "us-central1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log("  > " + cmd);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error("\nERROR: Command failed (exit code " + result.status + ")");
    process.exit(1);
  }
}

function runCapture(cmd) {
  const result = spawnSync(cmd, { shell: true, stdio: ["inherit", "pipe", "inherit"] });
  if (result.status !== 0) {
    console.error("\nERROR: Command failed: " + cmd);
    process.exit(1);
  }
  return result.stdout.toString().trim();
}

function step(n, total, label) {
  console.log("\n[" + n + "/" + total + "] " + label);
  console.log("-".repeat(50));
}

function readYaml(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("============================================");
  console.log("  Moti Boti - GCP Deployment");
  console.log("============================================");
  console.log("Project: " + PROJECT_ID);

  process.chdir(__dirname);

  // Set gcloud project
  runCapture("gcloud config set project " + PROJECT_ID);

  // ── Step 1: Generate .env.yaml ─────────────────────────────────────────────
  step(1, 5, "Generating .env.yaml from .env");
  run("node generate-env-yaml.js");

  // ── Step 2: Deploy motiWebhook ─────────────────────────────────────────────
  step(2, 5, "Deploying motiWebhook Cloud Function");
  run(
    "gcloud functions deploy motiWebhook" +
    " --project=" + PROJECT_ID +
    " --gen2 --runtime=nodejs20" +
    " --region=" + REGION +
    " --source=." +
    " --entry-point=motiWebhook" +
    " --trigger-http --allow-unauthenticated" +
    " --memory=512MB --timeout=300s" +
    " --env-vars-file=.env.yaml"
  );

  // ── Step 3: Deploy motiCron ────────────────────────────────────────────────
  step(3, 5, "Deploying motiCron Cloud Function");
  run(
    "gcloud functions deploy motiCron" +
    " --project=" + PROJECT_ID +
    " --gen2 --runtime=nodejs20" +
    " --region=" + REGION +
    " --source=." +
    " --entry-point=motiCron" +
    " --trigger-http --allow-unauthenticated" +
    " --memory=256MB --timeout=300s" +
    " --env-vars-file=.env.yaml"
  );

  // ── Step 4: Register Telegram webhook ─────────────────────────────────────
  step(4, 5, "Registering Telegram webhook");
  run("node register-webhook.js");

  // ── Step 5: Cloud Scheduler ────────────────────────────────────────────────
  step(5, 5, "Setting up Cloud Scheduler jobs");

  const yaml       = readYaml(path.join(__dirname, ".env.yaml"));
  const cronSecret = yaml.CRON_SECRET;

  const cronUrl = runCapture(
    "gcloud functions describe motiCron" +
    " --project=" + PROJECT_ID +
    " --gen2 --region=" + REGION +
    " --format=value(serviceConfig.uri)"
  );

  if (!cronUrl) {
    console.error("ERROR: Could not get motiCron URL");
    process.exit(1);
  }

  console.log("Cron URL: " + cronUrl);

  const jobs = [
    {
      name:     "moti-reminders",
      schedule: "* * * * *",
      job:      "reminders",
      deadline: "60s",
      desc:     "Moti: reminders every minute",
    },
    {
      name:     "moti-weekly-summary",
      schedule: "0 9 * * 0",
      job:      "weekly_summary",
      deadline: "120s",
      desc:     "Moti: weekly summary Sundays 9AM",
    },
    {
      name:     "moti-event-scraper",
      schedule: "0 3 * * *",
      job:      "event_scraper",
      deadline: "300s",
      desc:     "Moti: daily event scraper 3AM",
    },
  ];

  for (const j of jobs) {
    const uri  = cronUrl + "?secret=" + cronSecret + "&job=" + j.job;
    const body = JSON.stringify({ job: j.job });

    const sharedFlags =
      " --location=" + REGION +
      " --schedule=" + JSON.stringify(j.schedule) +
      " --time-zone=Asia/Jerusalem" +
      " --uri=" + JSON.stringify(uri) +
      " --http-method=POST" +
      " --message-body=" + JSON.stringify(body) +
      " --attempt-deadline=" + j.deadline;

    // gcloud uses --headers on create, --update-headers on update
    const createCmd = "gcloud scheduler jobs create http " + j.name + sharedFlags + " --headers=Content-Type=application/json";
    const updateCmd = "gcloud scheduler jobs update http " + j.name + sharedFlags + " --update-headers=Content-Type=application/json";

    console.log("\nCreating " + j.name + "...");
    const create = spawnSync(createCmd, { shell: true, stdio: "inherit" });

    if (create.status !== 0) {
      console.log("  Already exists — updating...");
      run(updateCmd);
    }
  }

  console.log("\n============================================");
  console.log("  Deployment complete!");
  console.log("============================================");
  console.log("");
  console.log("Next: send a message in your Telegram group - Moti should respond.");
  console.log("To re-deploy after code changes, run: node deploy.js");
}

main().catch(err => { console.error(err); process.exit(1); });
