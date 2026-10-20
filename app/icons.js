// A deliberately small, local outline-icon set.  The geometry follows the
// Lucide visual language so every ASHA surface can share one calm, readable
// stroke treatment without loading a third-party icon font or CDN asset.
const paths = {
  "scan-face": '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 10h.01M16 10h.01M9 16c.8.7 1.8 1 3 1s2.2-.3 3-1M12 11v2"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10V5a2 2 0 0 0-4 0v9"/><path d="M6 13v-2a2 2 0 0 0-4 0v5c0 3.9 3.1 7 7 7h4c3.9 0 7-3.1 7-7v-3a2 2 0 0 0-4 0v1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>',
  accessibility: '<circle cx="12" cy="4" r="2"/><path d="M5 8h14M12 6v15M8 21l4-7 4 7"/>',
  camera: '<path d="M14.5 4 16 7h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4l1.5-3z"/><circle cx="12" cy="13" r="3"/>',
  "camera-off": '<path d="m2 2 20 20M9.5 4l-1 2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12M16 7h4a2 2 0 0 1 2 2v7"/><path d="M14.5 4 16 7M9.8 9.8a3 3 0 0 0 4.2 4.2"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
  "circle-help": '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 17h.01"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  square: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  house: '<path d="m3 11 9-8 9 8v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22v-6h6v6"/>',
  "layout-list": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 14h8M5.5 9h.01M5.5 14h.01"/>',
  "heart-handshake": '<path d="M19.5 12.6 16 16l-3-3-2 2-4-4 3.2-3.2a2.1 2.1 0 0 1 3 0l.8.8.8-.8a2.1 2.1 0 0 1 3 0z"/><path d="M7 11 4.5 8.5a2.1 2.1 0 0 0-3 0L1 9"/><path d="m5 13 2 2M8 16l2 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.3 2.3-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-3v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L6.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4.8v-3H5a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.3-2.3.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V4.3h3v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v3H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="m10.3 3.5-8.4 14A2 2 0 0 0 3.6 20h16.8a2 2 0 0 0 1.7-2.5l-8.4-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  languages: '<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M14 18h7M17.5 15l3 7M20.5 15l-3 7"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "arrow-left": '<path d="m15 18-6-6 6-6M9 12h12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

export function icon(name, options = {}) {
  const size = options.size || 20;
  const label = options.label;
  const body = paths[name] || paths.info;
  const accessible = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="asha-icon asha-icon--${name}" ${accessible} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${options.stroke || 2}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const iconButton = (name, label, size = 20) => `${icon(name, { size })}<span>${label}</span>`;
