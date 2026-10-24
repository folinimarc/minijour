import { registerSW } from 'virtual:pwa-register';
import { journalUrl } from './urls';
import './landing.css';

const params = new URLSearchParams(location.search);
const standalone = matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone;

// Older installations and in-flight OAuth attempts can still open the root.
// #about lets an installed app deliberately visit the information page.
if (params.has('code') || params.has('error') || (standalone && location.hash !== '#about')) {
  location.replace(`${journalUrl.href}${location.search}${location.hash}`);
} else {
  document.querySelector<HTMLAnchorElement>('#source-link')!.href = __SOURCE_URL__;
  // Visiting the information page also prepares the journal for offline use.
  // Updates stay waiting until the journal's normal update prompt is accepted.
  registerSW();
}
