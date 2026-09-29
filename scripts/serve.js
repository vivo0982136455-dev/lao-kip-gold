// Tiny local web server for testing the site on your computer.
// Usage: node scripts/serve.js   then open http://localhost:8080
// (Opening index.html by double-click does not work, because the browser
//  blocks reading JSON files from file:// pages.)

const http = require("http");
const fs = require("fs");
const path = require("path");

// SITE_ROOT can point to another folder (used for testing with sample data)
const ROOT = process.env.SITE_ROOT ? path.resolve(process.env.SITE_ROOT) : path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // Remove "?query", decode %20 etc., default to index.html
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath.endsWith("/")) urlPath += "index.html";

  // Stay inside the project folder (block "../" tricks)
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found: " + urlPath);
    }
    const type = TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Site running at http://localhost:${PORT}  (press Ctrl+C to stop)`);
});
