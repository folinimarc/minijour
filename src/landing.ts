import { registerSW } from 'virtual:pwa-register';
import { icon } from './ui/icons';
import './landing.css';

document.querySelector('.wordmark')!.insertAdjacentHTML('afterbegin', icon('book'));
document.querySelector<HTMLAnchorElement>('#source-link')!.href = __SOURCE_URL__;
// Visiting the information page also prepares the journal for offline use.
// Updates stay waiting until the journal's normal update prompt is accepted.
registerSW();
