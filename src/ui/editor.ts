import { Annotation, EditorState, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { PhotoUrls } from './photos';
import { editDay, type DayDoc } from '../domain/day';

const externalChange = Annotation.define<boolean>();
const refreshPhotos = StateEffect.define<void>();

class PhotoWidget extends WidgetType {
  constructor(private name: string, private urls: PhotoUrls, private version: number) { super(); }
  eq(other: PhotoWidget): boolean { return other.name === this.name && other.version === this.version; }
  toDOM(): HTMLElement {
    const figure = document.createElement('span');
    figure.className = 'photo-preview';
    figure.textContent = 'Photo is unavailable or has not downloaded yet.';
    void this.urls.get(this.name).then(url => {
      if (!url) return;
      const image = document.createElement('img');
      image.src = url;
      image.alt = 'Journal photo';
      image.loading = 'lazy';
      figure.replaceChildren(image);
    }).catch(() => { figure.textContent = 'Could not load this photo.'; });
    return figure;
  }
}

function photoPreviews(urls: PhotoUrls) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean; transactions: readonly { effects: readonly StateEffect<unknown>[] }[] }) {
      if (update.docChanged || update.viewportChanged || update.transactions.some(tx => tx.effects.some(effect => effect.is(refreshPhotos)))) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const widgets = [];
      const pattern = /!\[[^\]\n]*\]\(photos\/([a-f0-9-]{36}\.jpg)\)/g;
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const match of text.matchAll(pattern)) {
          widgets.push(Decoration.widget({ widget: new PhotoWidget(match[1], urls, urls.version), side: 1 })
            .range(from + match.index! + match[0].length));
        }
      }
      return Decoration.set(widgets, true);
    }
  }, { decorations: instance => instance.decorations });
}

/** One editor per day, visually joined into one chronological document. */
export class DayEditor {
  readonly view: EditorView;
  private applyingExternal = false;
  private deferredDoc?: DayDoc;
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
          placeholder('Start writing…'),
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
                  this.receive(incoming);
                }
              }, 0);
            },
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !this.applyingExternal && !update.transactions.every(tx => tx.annotation(externalChange))) {
              // Edit the version actually displayed, even if a remote change is
              // waiting for IME composition to finish. Automerge merges branches.
              this.displayedDoc = editDay(this.displayedDoc, update.state.doc.toString());
              onEdit(this.displayedDoc);
            }
          }),
        ],
      }),
    });
  }

  get doc(): DayDoc { return this.displayedDoc; }

  receive(doc: DayDoc): void {
    if (this.view.composing) { this.deferredDoc = doc; return; }
    this.displayedDoc = doc;
    const text = doc.text;
    const current = this.view.state.doc.toString();
    if (current === text) return;
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
  }

  focusEnd(): void {
    this.view.dispatch({ selection: { anchor: this.view.state.doc.length }, scrollIntoView: true });
    this.view.focus();
  }
  refreshPhotos(): void { this.view.dispatch({ effects: refreshPhotos.of() }); }
  destroy(): void { this.view.destroy(); }
}
