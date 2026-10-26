import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { PhotoUrls } from './photos';

export const refreshPhotos = StateEffect.define<void>();

class PhotoWidget extends WidgetType {
  constructor(private name: string, private urls: PhotoUrls, private version: number) { super(); }
  eq(other: PhotoWidget): boolean { return other.name === this.name && other.version === this.version; }
  toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement('div');
    figure.className = 'photo-preview';
    figure.textContent = 'Photo is unavailable or has not downloaded yet.';
    void this.urls.get(this.name).then(photo => {
      if (!photo || !figure.isConnected) return;
      const image = document.createElement('img');
      image.width = photo.width; image.height = photo.height;
      image.alt = 'Journal photo'; image.loading = 'lazy';
      const frame = document.createElement('div');
      frame.className = 'photo-frame';
      frame.style.width = `min(100%, ${Math.min(photo.width, 560 * photo.width / photo.height)}px)`;
      frame.style.aspectRatio = `${photo.width} / ${photo.height}`;
      frame.append(image);
      image.onload = () => { if (figure.isConnected) view.requestMeasure(); };
      image.onerror = () => {
        if (!figure.isConnected) return;
        figure.textContent = 'Could not load this photo.';
        view.requestMeasure();
      };
      figure.replaceChildren(frame);
      image.src = photo.url;
      view.requestMeasure();
    }).catch(() => {
      if (!figure.isConnected) return;
      figure.textContent = 'Could not load this photo.';
      view.requestMeasure();
    });
    return figure;
  }
}

/** Photos affect page height, so describe every block before viewport layout. */
export function photoPreviews(urls: PhotoUrls) {
  const build = (state: EditorState): DecorationSet => {
    const widgets = [];
    const pattern = /!\[[^\]\n]*\]\(photos\/([a-f0-9-]{36}\.jpg)\)/g;
    for (const match of state.doc.toString().matchAll(pattern)) {
      widgets.push(Decoration.widget({ widget: new PhotoWidget(match[1], urls, urls.version), block: true, side: 1 })
        .range(match.index! + match[0].length));
    }
    return Decoration.set(widgets, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (decorations, transaction) => transaction.docChanged || transaction.effects.some(effect => effect.is(refreshPhotos))
      ? build(transaction.state) : decorations,
    provide: field => EditorView.decorations.from(field),
  });
}
