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

// Read every file that was loaded before once more (the app came back to the front after a while).
// The old data stays in place until the new data has arrived, so nothing flickers. Returns true when a file changed.
export async function refreshLazy() {
  const results = await Promise.all(
    [...cache].map(async ([path, entry]) => {
      if (entry.state === "loading") return false;
      try {
        const res = await fetch(path, { cache: "no-cache" });
        if (!res.ok) return false;
        const data = await res.json();
        const same = entry.state === "ok" && JSON.stringify(entry.data) === JSON.stringify(data);
        entry.state = "ok";
        entry.data = data;
        return !same;
      } catch {
        return false; // keep what we have
      }
    })
  );
  return results.some(Boolean);
}
