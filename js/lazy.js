// Load a data file only when a page needs it (keeps the first load small on phones).
// Returns { state: "loading" | "ok" | "error", data }. rerender() is called once the file has arrived (or failed).
const cache = new Map();

export function lazyJson(path, rerender) {
  let entry = cache.get(path);
  if (!entry) {
    entry = { state: "loading", data: null };
    cache.set(path, entry);
    fetch(path, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data) => {
        entry.state = "ok";
        entry.data = data;
      })
      .catch(() => {
        entry.state = "error";
      })
      .finally(rerender);
  }
  return entry;
}
