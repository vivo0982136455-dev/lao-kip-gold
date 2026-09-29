// Simple line icons (24x24, drawn with the current text colour). Made for this project.

const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  exchange: '<path d="M4 8h14l-4-4"/><path d="M20 16H6l4 4"/>',
  gold: '<path d="M3 20l2.5-6h6l2.5 6z"/><path d="M10 20l2.5-6h6l2.5 6z"/><path d="M6.5 14l2.5-6h6l2.5 6"/>',
  economy: '<path d="M4 4v16h16"/><path d="M7 15l4-4 3 3 5-6"/>',
  forecast: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9.5h4.5a1.8 1.8 0 010 3.5H9m0 0h5a1.8 1.8 0 010 3.5H9m1.5-9v10"/>',
};

// Returns an <svg> element. The markup above is our own fixed text, so innerHTML is safe here.
export function icon(name, size = 20) {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
  return span;
}
