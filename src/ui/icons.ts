// The same project-created SVG is used for the wordmark and favicon.
import logo from './logo.svg?raw';

const device = '<path d="M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8M9 5h4M9 19h1"/>';
const cloud = '<path d="M8 19H6a4.5 4.5 0 1 1 .6-8.96A6.5 6.5 0 0 1 19 9a5 5 0 0 1 2.5 8.3"/>';
const check = '<path d="m13 19 3 3 6-7"/>';
const alert = '<path d="M18 15v4m0 3h.01"/>';

const icons = {
  chevron: '<path d="m9 5 7 7-7 7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  cloud: '<path d="M7 18H6a4 4 0 1 1 .6-7.95A6 6 0 0 1 18 8a5 5 0 0 1 0 10h-1M12 20V12m-3 3 3-3 3 3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-6-6-9 12"/>',
  device: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 5h6m-4 14h2"/>',
  'device-check': device + check,
  'device-alert': device + alert,
  'cloud-check': cloud + check,
  'cloud-alert': cloud + alert,
  'cloud-sync': cloud + '<path d="M13 17a4 4 0 0 1 7-2l2 2m0-4v4h-4M22 20a4 4 0 0 1-7 2l-2-2m0 3v-3h3"/>',
};

export function icon(name: 'book' | keyof typeof icons): string {
  if (name === 'book') return logo;
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
