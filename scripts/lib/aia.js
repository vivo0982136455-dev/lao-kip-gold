// Download a page from a web server that forgets to send its intermediate certificate (seen 2026-10-02 on
// www.bol.gov.la: the server sends only its own certificate, so Node on Linux - GitHub's runners - answers
// "unable to verify the first certificate"; browsers and Windows repair this silently).
//
// This does what a browser does: read the address of the missing certificate from the server's own certificate
// ("Authority Information Access - CA Issuers"), download that certificate, and connect again with it.
// Nothing is trusted that a browser would not trust: the downloaded certificate is used only when it is itself
// signed by a root certificate that ships with Node (so it can only fill the gap in the chain, never replace a
// root), the second connection is verified completely, and the host name is checked as usual.
// Certificate checking is never switched off for the page itself.

const https = require("https");
const http = require("http");
const tls = require("tls");
const crypto = require("crypto");

const AGENT = "lao-kip-gold-dashboard (personal, non-commercial)";
const MAX_CERT_BYTES = 20000;
const MAX_PAGE_BYTES = 5e6;

// GET with the given trusted certificates; resolves with the bytes, rejects with the network / certificate error
function get(url, ca, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca, headers: { "User-Agent": AGENT, ...headers }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_PAGE_BYTES) req.destroy(new Error(`more than ${MAX_PAGE_BYTES} bytes from ${url}`));
        else chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${timeoutMs / 1000} s from ${url}`)));
    req.on("error", reject);
  });
}

// The "CA Issuers" address written in the certificate the server presents. This handshake is NOT verified
// (that is the very thing that fails) and nothing but that address is taken from it.
function issuerAddress(host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const list = (cert && cert.infoAccess && cert.infoAccess["CA Issuers - URI"]) || [];
      const url = list.find((u) => /^http:\/\/[a-z0-9.-]+\/[\w./-]+$/i.test(u));
      if (url) resolve(url);
      else reject(new Error(`the certificate of ${host} names no issuer address`));
    });
    socket.on("timeout", () => socket.destroy(new Error(`no answer in ${timeoutMs / 1000} s from ${host}`)));
    socket.on("error", reject);
  });
}

// Is this downloaded certificate a real intermediate - signed by one of the roots that ship with Node, a
// certificate authority, and inside its validity period? Without this check a forged self-signed certificate
// would become a trusted root just by being downloaded.
function checkIntermediate(cert) {
  if (!cert.ca) throw new Error("not a certificate of a certificate authority");
  const now = Date.now();
  if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now) throw new Error("outside its validity period");
  const signedByRoot = tls.rootCertificates.some((pem) => {
    const root = new crypto.X509Certificate(pem);
    return cert.checkIssued(root) && cert.verify(root.publicKey);
  });
  if (!signedByRoot) throw new Error("not signed by a root certificate that Node trusts");
}

// The issuer's certificate as PEM text. Certificate authorities publish these over plain http on purpose;
// that is safe because the certificate is used only after checkIntermediate() has proved who signed it.
function downloadCertificate(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { "User-Agent": AGENT }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_CERT_BYTES) req.destroy(new Error("the issuer certificate is too big"));
        else chunks.push(c);
      });
      res.on("end", () => {
        try {
          const cert = new crypto.X509Certificate(Buffer.concat(chunks)); // DER or PEM
          checkIntermediate(cert);
          resolve(cert.toString());
        } catch (err) {
          reject(new Error(`issuer certificate from ${url}: ${err.message}`));
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${timeoutMs / 1000} s from ${url}`)));
    req.on("error", reject);
  });
}

// Download an https address; when the only problem is the missing intermediate certificate, fetch it and try again.
// Returns { buffer, repaired } - repaired: the address of the certificate that had to be added, or null.
async function fetchBufferAia(url, headers = {}, timeoutMs = 20000) {
  const roots = tls.rootCertificates; // the roots that ship with Node: the same on every computer
  try {
    return { buffer: await get(url, roots, headers, timeoutMs), repaired: null };
  } catch (err) {
    if (err.code !== "UNABLE_TO_VERIFY_LEAF_SIGNATURE") throw err;
  }
  const from = await issuerAddress(new URL(url).hostname, timeoutMs);
  const pem = await downloadCertificate(from, timeoutMs);
  return { buffer: await get(url, [...roots, pem], headers, timeoutMs), repaired: from };
}
// The same for a page of text: { text, repaired }
async function fetchTextAia(url, headers = {}, timeoutMs = 20000) {
  const { buffer, repaired } = await fetchBufferAia(url, headers, timeoutMs);
  return { text: buffer.toString("utf8"), repaired };
}

module.exports = { fetchTextAia, fetchBufferAia };
