import { isDate, localDate } from '../domain/day';
import type { JournalView } from './journal-view';
import { icon } from './icons';
import type { mountShell } from './shell';

/** A small date drawer; navigation does not change what is stored or synced. */
export function setupDateNavigation(
  ui: ReturnType<typeof mountShell>, view: JournalView, notify: (error: unknown) => void,
): void {
  let rendered = '';
  const refresh = () => {
    const dates = view.dates;
    const key = dates.join(',');
    if (key !== rendered) {
      rendered = key;
      const rows = dates.map(date => {
        const row = document.createElement('li');
        const link = document.createElement('button');
        link.className = 'date-link'; link.textContent = date; link.value = date;
        link.onclick = () => { ui.dateSidebar.close(); view.openDate(date); };
        const remove = document.createElement('button');
        remove.className = 'icon-button delete-date'; remove.innerHTML = icon('trash');
        remove.setAttribute('aria-label', `Delete entry for ${date}`);
        remove.onclick = () => {
          if (!confirm(`Delete the entry for ${date}? Its text will be removed from your journal. Photo files stay until you clean them up through the settings.`)) return;
          remove.disabled = true;
          void view.deleteDate(date).catch(notify).finally(() => { remove.disabled = false; });
        };
        row.append(link, remove);
        return row;
      });
      ui.dateList.replaceChildren(...rows);
    }
    for (const link of ui.dateList.querySelectorAll<HTMLButtonElement>('.date-link')) {
      if (link.value === view.activeDate) link.setAttribute('aria-current', 'date');
      else link.removeAttribute('aria-current');
    }
  };
  view.onDatesChange = refresh;
  ui.datesButton.onclick = () => {
    view.stopFollowing();
    ui.entryDate.value = localDate();
    refresh();
    ui.dateSidebar.append(ui.notice);
    ui.dateSidebar.showModal();
    ui.datesButton.setAttribute('aria-expanded', 'true');
  };
  const showDateForm = (show: boolean) => {
    ui.dateForm.hidden = !show;
    ui.addDateButton.setAttribute('aria-expanded', String(show));
    if (show) ui.entryDate.focus();
  };
  ui.todayButton.onclick = () => { ui.dateSidebar.close(); view.openDate(localDate()); };
  ui.addDateButton.onclick = () => showDateForm(!!ui.dateForm.hidden);
  ui.closeDates.onclick = () => ui.dateSidebar.close();
  ui.dateSidebar.addEventListener('close', () => {
    showDateForm(false);
    document.body.append(ui.notice);
    ui.datesButton.setAttribute('aria-expanded', 'false');
  });
  ui.dateSidebar.addEventListener('click', event => {
    if (event.target !== ui.dateSidebar) return;
    const box = ui.dateSidebar.getBoundingClientRect();
    if (event.clientX > box.right || event.clientX < box.left) ui.dateSidebar.close();
  });
  ui.dateForm.onsubmit = event => {
    event.preventDefault();
    try {
      const date = ui.entryDate.value;
      if (!isDate(date)) throw new Error('Choose a valid calendar date.');
      ui.dateSidebar.close();
      view.openDate(date);
    } catch (error) { notify(error); }
  };
  refresh();
}
