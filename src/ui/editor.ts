import { Annotation, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { PhotoUrls } from './photos';
import { photoPreviews, refreshPhotos } from './photo-previews';
import { applyTextEdits, type DayDoc, type TextEdit } from '../domain/day';

const externalChange = Annotation.define<boolean>();
/** One editor per day, visually joined into one chronological document. */
export class DayEditor {
  readonly view: EditorView;
  private applyingExternal = false;
  private deferredDoc?: { doc: DayDoc; onApplied?: () => void };
  private displayedDoc: DayDoc;

  constructor(parent: HTMLElement, doc: DayDoc, date: string, urls: PhotoUrls,
    onEdit: (doc: DayDoc) => void, onFocus: (editor: DayEditor) => void) {
    this.displayedDoc = doc;
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          markdown(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.scrollMargins.of(() => ({ top: document.querySelector('.topbar')!.getBoundingClientRect().height, bottom: 24 })),
          placeholder(`Write for ${date}…`),
          EditorView.contentAttributes.of({ 'aria-label': `Journal for ${date}`, spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on' }),
          syntaxHighlighting(HighlightStyle.define([
            { tag: tags.heading, fontWeight: '600', color: '#354438' },
            { tag: tags.emphasis, fontStyle: 'italic' },
            { tag: tags.strong, fontWeight: '650' },
            { tag: tags.link, color: '#657e66', textDecoration: 'underline' },
            { tag: tags.monospace, fontFamily: 'ui-monospace, monospace', fontSize: '0.9em', color: '#7e6255' },
            { tag: tags.processingInstruction, color: '#90918a' },
          ])),
          photoPreviews(urls),
          EditorView.domEventHandlers({
            focus: () => { onFocus(this); },
            compositionend: () => {
              // Never disturb Android keyboard composition with incoming edits.
              setTimeout(() => {
                if (this.deferredDoc !== undefined) {
                  const incoming = this.deferredDoc;
                  this.deferredDoc = undefined;
                  this.receive(incoming.doc, incoming.onApplied);
                }
              }, 0);
            },
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !this.applyingExternal && !update.transactions.every(tx => tx.annotation(externalChange))) {
              // Edit the version actually displayed, even if a remote change is
              // waiting for IME composition to finish. Automerge merges branches.
              const edits: TextEdit[] = [];
              update.changes.iterChanges((from, to, _fromB, _toB, insert) => {
                edits.push({ from, to, insert: insert.toString() });
              });
              this.displayedDoc = applyTextEdits(this.displayedDoc, edits);
              onEdit(this.displayedDoc);
            }
          }),
        ],
      }),
    });
  }

  get doc(): DayDoc { return this.displayedDoc; }

  receive(doc: DayDoc, onApplied?: () => void): void {
    if (this.view.composing) { this.deferredDoc = { doc, onApplied }; return; }
    // A newer edit may arrive after composition ends but before its queued
    // callback runs. Do not let that callback restore an older document.
    this.deferredDoc = undefined;
    this.displayedDoc = doc;
    const text = doc.text;
    const current = this.view.state.doc.toString();
    if (current === text) { onApplied?.(); return; }
    // Apply the smallest contiguous display patch so CodeMirror can map the
    // cursor. Automerge has already performed the actual data merge.
    let start = 0;
    while (start < current.length && start < text.length && current[start] === text[start]) start++;
    let end = current.length, nextEnd = text.length;
    while (end > start && nextEnd > start && current[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
    this.applyingExternal = true;
    try {
      this.view.dispatch({ changes: { from: start, to: end, insert: text.slice(start, nextEnd) }, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] });
    } finally { this.applyingExternal = false; }
    onApplied?.();
  }

  focusEnd(): void {
    this.view.dispatch({ selection: { anchor: this.view.state.doc.length } });
    this.view.focus();
    this.revealEnd();
  }
  revealEnd(): void {
    this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.doc.length, { y: 'end', yMargin: 24 }) });
  }
  refreshPhotos(): void { this.view.dispatch({ effects: refreshPhotos.of() }); }
}
