// The shared download helper (scripts/lib/common.js fetchText) and a server that answers with an error page it
// never finishes - what a broken gateway does ("502"). The fetch scripts must end when their work is done, not
// minutes later when the request's time limit lets the unread page go. Seen 2026-10-03 on GitHub: a weekly step
// had written its file and was still stopped by its 10-minute limit.
// A local server and a child process; nothing is downloaded from outside. Usage: node tests/download.js
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const COMMON = path.join(__dirname, "..", "scripts", "lib", "common.js");
const TIME_LIMIT_MS = 20000; // the time limit the child gives its request
const RETRY_WAIT_MS = 3000; // fetchText waits this long before its second try
let requests = 0;

const server = http.createServer((req, res) => {
  requests++;
  res.writeHead(502, { "Content-Type": "text/html" });
  res.write("<html><body>Bad gateway " + "x".repeat(2000)); // ... the rest never comes
});
server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const code = `
    const { fetchText } = require(${JSON.stringify(COMMON)});
    fetchText(${JSON.stringify(url)}, {}, ${TIME_LIMIT_MS})
      .then(() => console.log("RESULT success"))
      .catch((e) => console.log("RESULT " + e.message));
  `;
  const started = Date.now();
  let out = "";
  let doneAt = null;
  const child = spawn(process.execPath, ["-e", code]);
  child.stdout.on("data", (d) => {
    out += d;
    if (doneAt === null && out.includes("RESULT")) doneAt = Date.now();
  });
  child.on("exit", (status) => {
    const total = Date.now() - started;
    const lingered = doneAt === null ? null : Date.now() - doneAt;
    server.closeAllConnections();
    server.close();
    const checks = [
      ["two tries, then the error is reported with the status of the page", requests === 2 && /RESULT Download failed .*HTTP 502/.test(out), `${requests} requests, ${out.trim()}`],
      ["the program ends when its work is done, not at the request's time limit", status === 0 && lingered !== null && lingered < 1500 && total < RETRY_WAIT_MS + 5000, `work done after ${doneAt === null ? "?" : ((doneAt - started) / 1000).toFixed(1)} s, exit ${lingered === null ? "?" : (lingered / 1000).toFixed(1)} s later (time limit of the request: ${TIME_LIMIT_MS / 1000} s)`],
    ];
    let failed = 0;
    for (const [name, ok, detail] of checks) {
      if (!ok) failed++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${detail}`);
    }
    console.log(`\n${checks.length - failed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
});
