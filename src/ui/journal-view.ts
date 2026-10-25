import * as A from '@automerge/automerge';
import { createDay, hasContent, isDate, localDate, type DayDoc } from '../domain/day';
import type { Journal } from '../domain/journal';
import { DayEditor } from './editor';
import { icon } from './icons';
import type { PhotoUrls } from './photos';

type Section = { element: HTMLElement; content: HTMLElement; toggle: HTMLButtonElement };

/** Date sections and local drafts. Collapsed older days need no editor yet. */
export class JournalView {
  readonly editors = new Map<string, DayEditor>();
  activeDate = localDate();
  private drafts = new Map<string, DayDoc>();
  private sections = new Map<string, Section>();
  private expanded = new Map<string, boolean>();
  private opened = new Set<string>();
  private openingEditor?: DayEditor;
  onDatesChange = () => {};

  constructor(
    private container: HTMLElement, private journal: Journal, private urls: PhotoUrls,
    private options: { afterSave: () => void; notify: (error: unknown) => void; canFocus: () => boolean },
  ) {}

  get dates(): string[] {
    return [...new Set([...this.journal.days.keys(), ...this.drafts.keys()])]
      .filter(date => hasContent(this.document(date)) || this.opened.has(date))
      .sort().reverse();
  }

  private document(date: string): DayDoc { return this.journal.days.get(date) ?? this.drafts.get(date)!; }

  render(): void {
    const dates = this.dates;
    for (const [date, section] of this.sections) section.element.hidden = !dates.includes(date);
    dates.forEach((date, index) => {
      const section = this.sections.get(date) ?? this.createSection(date);
      section.element.hidden = false;
      const expanded = this.expanded.get(date) ?? index < 3;
      section.toggle.setAttribute('aria-expanded', String(expanded));
      section.content.hidden = !expanded;
      section.element.classList.toggle('collapsed', !expanded);
      if (expanded) this.editor(date);
    });
    this.onDatesChange();
  }

  receive(date: string): void {
    if (this.journal.days.has(date)) this.drafts.delete(date);
    this.editors.get(date)?.receive(this.document(date));
    const visible = hasContent(this.document(date)) || this.opened.has(date);
    const section = this.sections.get(date);
    const wasVisible = section ? !section.element.hidden : false;
    // Ordinary keystrokes should not rebuild every date section or sidebar row.
    if (visible !== wasVisible) this.render();
    if (this.openingEditor && this.options.canFocus()) this.openingEditor.revealEnd();
  }

  openDate(date: string, followOpening = false): void {
    if (!isDate(date)) throw new Error('Choose a valid calendar date.');
    if (!this.journal.days.has(date) && !this.drafts.has(date)) this.drafts.set(date, createDay(date));
    this.activeDate = date;
    this.opened.add(date);
    this.expanded.set(date, true);
    this.render();
    const editor = this.editors.get(date)!;
    editor.receive(this.document(date));
    this.openingEditor = followOpening ? editor : undefined;
    if (this.options.canFocus()) editor.focusEnd();
  }

  async deleteDate(date: string): Promise<void> {
    this.stopFollowing();
    // Clear through Automerge rather than removing history that other devices
    // still need. Photos remain available for the separate cleanup action.
    if (this.journal.saveError) await this.journal.flush();
    if (this.journal.days.has(date)) await this.journal.edit(date, '');
    this.drafts.delete(date);
    this.opened.delete(date);
    this.expanded.delete(date);
    if (this.activeDate === date) this.openDate(localDate());
    else this.render();
  }

  discardBlank(date: string): void {
    const doc = this.journal.days.get(date) ?? this.drafts.get(date);
    if (doc && !hasContent(doc)) {
      this.drafts.delete(date);
      this.opened.delete(date);
      this.expanded.delete(date);
    }
  }

  stopFollowing(): void { this.openingEditor = undefined; }
  expandActive(): DayEditor {
    this.expanded.set(this.activeDate, true);
    this.render();
    return this.editors.get(this.activeDate)!;
  }
  revealOpening(): void { if (this.options.canFocus()) this.openingEditor?.revealEnd(); }
  refreshPhotos(): void { for (const editor of this.editors.values()) editor.refreshPhotos(); }

  private createSection(date: string): Section {
    const element = document.createElement('section');
    element.className = 'day'; element.dataset.date = date;
    const heading = document.createElement('h2');
    heading.className = 'day-heading';
    const toggle = document.createElement('button');
    toggle.className = 'day-toggle'; toggle.type = 'button';
    toggle.innerHTML = `${icon('chevron')}<time datetime="${date}">${date}</time><span class="weekday"></span>`;
    toggle.querySelector('.weekday')!.textContent = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
    const content = document.createElement('div');
    content.id = `entry-${date}`; content.className = 'day-content';
    toggle.setAttribute('aria-controls', content.id);
    heading.append(toggle); element.append(heading, content);
    const following = [...this.container.children].find(child => (child as HTMLElement).dataset.date! < date);
    this.container.insertBefore(element, following ?? null);
    const section = { element, content, toggle };
    this.sections.set(date, section);
    toggle.onclick = () => {
      this.stopFollowing();
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      this.expanded.set(date, !expanded);
      this.render();
      if (!expanded) {
        this.activeDate = date;
        this.editors.get(date)!.view.focus();
        this.onDatesChange();
      }
    };
    return section;
  }

  private editor(date: string): DayEditor {
    const existing = this.editors.get(date);
    if (existing) return existing;
    const editor = new DayEditor(this.sections.get(date)!.content, this.document(date), date, this.urls, next => {
      this.stopFollowing();
      this.opened.add(date);
      if (!this.journal.days.has(date) && !hasContent(next)) {
        this.drafts.set(date, next);
        return;
      }
      void this.journal.merge(date, A.save(next)).then(this.options.afterSave).catch(this.options.notify);
    }, () => {
      this.activeDate = date;
      this.opened.add(date);
      this.expanded.set(date, true);
      this.onDatesChange();
    });
    this.editors.set(date, editor);
    return editor;
  }
}
