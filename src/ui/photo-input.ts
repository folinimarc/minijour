import * as A from '@automerge/automerge';
import type { Journal } from '../domain/journal';
import type { DayEditor } from './editor';
import type { JournalView } from './journal-view';
import type { JournalUI } from './shell';
import { loadPhotoOptions } from './photo-settings';
import { preparePhoto } from './photos';

/** Keep the cursor's Automerge anchors while the camera or file picker is open. */
export function setupPhotoInput(ui: JournalUI, journal: Journal, view: JournalView, notify: (error: unknown) => void): () => void {
  const local = journal.local;
  let photoTarget: { editor: DayEditor; anchor: A.Cursor; head: A.Cursor } | undefined;
  function closePhotoMenu(): void {
    ui.photoMenu.hidden = true;
    ui.photoButton.setAttribute('aria-expanded', 'false');
  }
  ui.photoButton.onpointerdown = event => { event.preventDefault(); };
  ui.photoButton.onclick = () => {
    if (!ui.photoMenu.hidden) { closePhotoMenu(); return; }
    const editor = view.expandActive();
    const selection = editor.view.state.selection.main;
    photoTarget = {
      editor,
      anchor: A.getCursor(editor.doc, ['text'], selection.anchor),
      head: A.getCursor(editor.doc, ['text'], selection.head),
    };
    ui.photoMenu.hidden = false;
    ui.photoButton.setAttribute('aria-expanded', 'true');
  };
  ui.cameraButton.onclick = () => { closePhotoMenu(); ui.cameraInput.click(); };
  ui.chooseButton.onclick = () => { closePhotoMenu(); ui.photoInput.click(); };
  document.addEventListener('pointerdown', event => {
    if (!(event.target as HTMLElement).closest('.photo-tools')) closePhotoMenu();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePhotoMenu(); });

  async function addPhoto(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    const target = photoTarget;
    if (!file || !target) return;
    ui.photoButton.disabled = true;
    try {
      const photo = await preparePhoto(file, await loadPhotoOptions(local));
      await local.savePhoto(photo.name, photo.blob);
      const editor = target.editor;
      const anchor = A.getCursorPosition(editor.doc, ['text'], target.anchor);
      const head = A.getCursorPosition(editor.doc, ['text'], target.head);
      const from = Math.min(anchor, head), to = Math.max(anchor, head);
      const before = editor.view.state.doc.sliceString(0, from);
      const prefix = before.length && !before.endsWith('\n') ? '\n' : '';
      const insert = `${prefix}![Photo](photos/${photo.name})\n`;
      editor.view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
      journal.photosChanged();
      editor.view.focus();
    } finally { ui.photoButton.disabled = false; }
  }
  ui.cameraInput.onchange = () => { void addPhoto(ui.cameraInput).catch(notify); };
  ui.photoInput.onchange = () => { void addPhoto(ui.photoInput).catch(notify); };

  return closePhotoMenu;
}
