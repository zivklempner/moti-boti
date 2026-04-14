// GCP Cloud Functions entry point.
// Re-exports motiWebhook and motiCron from src/functions.js.
// (Railway still uses src/index.js via the "start" npm script — this file is not used by Railway.)
module.exports = require("./src/functions");
