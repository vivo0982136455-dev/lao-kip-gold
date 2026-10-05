// Google Apps Script of the owner's price Sheet: it takes a price from the web page ONLY together with the
// owner's key, and writes it as one new row - in the columns the Google Form used, so the bot reads on as before.
// The owner pastes this file into the Sheet (Extensions > Apps Script); the steps are in
// docs/owner-save-key-th.md. The key is NOT in this file: makeKey() below creates it and keeps it in the
// script's own settings ("Script properties"), where only the owner of the Sheet can see it.
//
//   POST  body = {"key":"...","values":{"date":"2026-10-05","sell":123, ...}}   (sent as text/plain: no preflight)
//         -> {"ok":true,"row":12}  |  {"ok":false,"error":"key" | "values" | "setup" | "sheet"}
//   GET   -> {"ok":true,"roles":[...]}   the prices this Sheet has a column for (nothing secret, nothing is written)
//
// tests/save-script.js runs handle() and roles() of this very file in Node with a pretend Sheet.

var KEY_PROPERTY = "SAVE_KEY";
var KEY_MIN_LENGTH = 16;
var WRONG_KEY_WAIT_MS = 1500; // a wrong key is answered slowly: guessing a 24-letter key this way is hopeless
var TEXT_MAX = 200;
var NUMBER_MAX = 1e13;

// role -> test on a column title. The first match wins - the very list of scripts/fetch-form-entries.js.
var has = function (t, word) {
  return t.indexOf(word) !== -1;
};
var ROLES = [
  ["note", function (t) { return has(t, "หมายเหตุ"); }],
  ["rubber_price", function (t) { return has(t, "ยาง") && has(t, "ราคา"); }],
  ["rubber_type", function (t) { return has(t, "ยาง") && has(t, "ชนิด"); }],
  ["rubber_place", function (t) { return has(t, "ยาง") && has(t, "สถานที่"); }],
  ["land_place", function (t) { return has(t, "ที่ดิน") && has(t, "สถานที่"); }],
  ["land_total", function (t) { return has(t, "ที่ดิน") && has(t, "ราคา"); }],
  ["land_area", function (t) { return has(t, "ที่ดิน") && has(t, "เนื้อที่"); }],
  ["silver_sell", function (t) { return (has(t, "เงิน") || /silver/i.test(t)) && has(t, "ขาย"); }],
  ["silver_buy", function (t) { return (has(t, "เงิน") || /silver/i.test(t)) && has(t, "ซื้อ"); }],
  ["bar_sell", function (t) { return has(t, "แท่ง") && has(t, "ขาย"); }],
  ["bar_buy", function (t) { return has(t, "แท่ง") && has(t, "ซื้อ"); }],
  ["sell", function (t) { return has(t, "ขาย"); }],
  ["buy", function (t) { return has(t, "ซื้อ"); }],
];
var TEXT_ROLES = { note: 1, rubber_type: 1, rubber_place: 1, land_place: 1 };

// Column titles -> { role: column number from 0 }. Column 0 is the Form's time stamp; the date question is the
// column titled "วันที่".
function roles(headers) {
  var out = {};
  for (var i = 1; i < headers.length; i++) {
    var title = String(headers[i] || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
    if (!title) continue;
    if (out.date === undefined && title === "วันที่") {
      out.date = i;
      continue;
    }
    for (var r = 0; r < ROLES.length; r++) {
      if (out[ROLES[r][0]] === undefined && ROLES[r][1](title)) {
        out[ROLES[r][0]] = i;
        break;
      }
    }
  }
  return out;
}

// Same length and same letters? Every letter is compared, so the time taken tells nothing about the key.
function sameText(a, b) {
  var diff = a.length ^ b.length;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return diff === 0;
}

// One request. env = { key, headers, append(row), wait(ms), now }   -> the answer object
function handle(body, env) {
  var key = String(env.key || "");
  if (key.length < KEY_MIN_LENGTH) return { ok: false, error: "setup" };
  var msg;
  try {
    msg = JSON.parse(body);
  } catch (e) {
    msg = null;
  }
  if (!msg || typeof msg.key !== "string" || !sameText(msg.key, key)) {
    env.wait(WRONG_KEY_WAIT_MS);
    return { ok: false, error: "key" };
  }
  var cols = roles(env.headers);
  if (cols.date === undefined) return { ok: false, error: "sheet" };
  var values = msg.values;
  if (!values || typeof values !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(String(values.date || ""))) return { ok: false, error: "values" };
  var row = [];
  for (var i = 0; i < env.headers.length; i++) row.push("");
  row[0] = env.now;
  row[cols.date] = values.date;
  var numbers = 0;
  for (var role in values) {
    if (role === "date" || !Object.prototype.hasOwnProperty.call(values, role)) continue;
    if (cols[role] === undefined) return { ok: false, error: "values" }; // a price this Sheet has no column for
    var v = values[role];
    if (TEXT_ROLES[role]) {
      if (typeof v !== "string" || v.length > TEXT_MAX) return { ok: false, error: "values" };
      // a text that starts like a formula would be run by the Sheet: keep it a text
      row[cols[role]] = /^[=+\-@]/.test(v) ? "'" + v : v;
    } else {
      if (typeof v !== "number" || !isFinite(v) || v <= 0 || v > NUMBER_MAX) return { ok: false, error: "values" };
      row[cols[role]] = v;
      numbers++;
    }
  }
  if (!numbers) return { ok: false, error: "values" };
  return { ok: true, row: env.append(row) };
}

// ---------- the parts that only exist at Google ----------
function answerSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; // the Form's answers: the first tab (the bot reads it too)
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  var sheet = answerSheet();
  return json(
    handle(e && e.postData ? e.postData.contents : "", {
      key: PropertiesService.getScriptProperties().getProperty(KEY_PROPERTY),
      headers: sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0],
      append: function (row) {
        sheet.appendRow(row);
        return sheet.getLastRow();
      },
      wait: function (ms) {
        Utilities.sleep(ms);
      },
      now: new Date(),
    })
  );
}
function doGet() {
  var sheet = answerSheet();
  return json({ ok: true, roles: Object.keys(roles(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0])) });
}

// Run ONCE by the owner (Run > makeKey): creates a random key, keeps it in the script's settings and shows it in
// the log. Run it again to replace the key (a lost phone): the old key stops working at once.
function makeKey() {
  var letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // without l, o, I, O, 0, 1: easy to type
  var key = "";
  var bytes = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes + new Date().getTime() + Math.random());
  for (var i = 0; i < 24; i++) key += letters.charAt((digest[i] + 256) % letters.length);
  PropertiesService.getScriptProperties().setProperty(KEY_PROPERTY, key);
  Logger.log("Your key (type it into the app once on each device, tell nobody): " + key);
}
