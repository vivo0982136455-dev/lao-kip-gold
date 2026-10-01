// Helpers for a data file that is made of several independent parts (one per source).
// A part that fails keeps its old numbers and is marked stale; the other parts still update.

// A part that worked. "updated_at" only moves when the numbers really changed (small diffs in git).
function okEntry(old, fields, now) {
  const { updated_at, stale, last_error, ...oldData } = old || {};
  const same = old && JSON.stringify(oldData) === JSON.stringify(fields);
  return { ...fields, updated_at: same ? updated_at : now, stale: false, last_error: null };
}

// A part that failed: the old numbers (or an empty fallback) + the first error since it last worked
function failEntry(old, fallback, err, now) {
  return { ...(old || fallback), stale: true, last_error: old && old.stale ? old.last_error : { message: err.message, at: now } };
}

// Run every part: parts = [[id, emptyFallback, async (oldPart) => fields, (part) => "text for the log"], ...]
// Returns { out, failed }.
async function runParts(old, parts, now = new Date().toISOString()) {
  const out = {};
  let failed = 0;
  for (const [id, fallback, run, describe] of parts) {
    try {
      out[id] = okEntry(old[id], await run(old[id] || null), now);
      console.log(`[OK]   ${id}${describe ? ": " + describe(out[id]) : ""}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${id}: ${err.message}`);
      out[id] = failEntry(old[id], fallback, err, now);
    }
  }
  return { out, failed };
}

// One part per line: a small diff in git when one part changes
function partsText(head, parts) {
  const lines = [...Object.entries(head), ...Object.entries(parts)].map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const text = "{\n" + lines.join(",\n") + "\n}\n";
  JSON.parse(text); // safety: must be valid JSON
  return text;
}

module.exports = { okEntry, failEntry, runParts, partsText };
