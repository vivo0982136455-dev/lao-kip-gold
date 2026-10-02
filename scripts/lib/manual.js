// Helpers for the manual-entry sources (Google Form -> Google Sheet -> published CSV).

const path = require("path");
const { ROOT_DIR, readJson } = require("./common");

// CSV link from config/manual-sources.json. An environment variable wins (useful for tests).
function manualUrl(configKey, envName) {
  if (process.env[envName] !== undefined) return process.env[envName].trim();
  const config = readJson(path.join(ROOT_DIR, "config", "manual-sources.json"), {});
  return String(config[configKey] || "").trim();
}

// Read a date typed in Google Sheets and return "YYYY-MM-DD".
// Accepts "2026-09-29", "29/9/2026", "29/09/2569" (Buddhist year) and "29/9/2026, 10:15:00".
// Day/month order is DAY first (Thai / Lao sheet setting) - see the guide.
function parseSheetDate(text) {
  const s = String(text || "").trim();
  let y, m, d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) [, y, m, d] = match.map(Number);
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (!match) return null;
    [, d, m, y] = match.map(Number);
  }
  if (y > 2400) y -= 543; // Buddhist Era -> Christian Era
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(iso + "T00:00:00Z"))) return null;
  return iso;
}

// Google Forms timestamp "29/9/2026, 10:15:00" (Vientiane time) -> ISO UTC. Null if unreadable.
function parseSheetTimestamp(text) {
  const day = parseSheetDate(text);
  if (!day) return null;
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(text).slice(8));
  const hms = t ? `${t[1].padStart(2, "0")}:${t[2]}:${t[3] || "00"}` : "00:00:00";
  return new Date(`${day}T${hms}+07:00`).toISOString();
}

// Is `day` ("YYYY-MM-DD") today or earlier? An answer dated in the future would stay "the newest price" for ever.
// One day of slack: the clock of the person who typed the date is not ours.
function notInFuture(day, now = Date.now()) {
  const tomorrow = new Date(now + (7 + 24) * 3600000).toISOString().slice(0, 10); // Vientiane time (UTC+7) + 1 day
  return day <= tomorrow;
}

module.exports = { manualUrl, parseSheetDate, parseSheetTimestamp, notInFuture };
