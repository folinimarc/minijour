import * as A from '@automerge/automerge';

export type Day = { text: string };
export type DayDoc = A.Doc<Day>;

export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/**
 * Every device starts a given day from the SAME creation change. Otherwise,
 * concurrent creation would produce two unrelated text objects at `text`.
 * The fixed actor is used only for this immutable genesis, never for typing.
 */
export function createDay(date: string): DayDoc {
  if (!isDate(date)) throw new Error('Invalid journal date.');
  const actor = `000000000000000000000000${date.replaceAll('-', '')}`;
  const genesis = A.change(A.init<Day>({ actor }), { time: 0 }, draft => {
    draft.text = '';
  });
  return A.clone(genesis); // A fresh actor for this editor's subsequent changes.
}

export function loadDay(bytes: Uint8Array): DayDoc {
  const doc = A.load<Day>(bytes);
  if (typeof doc.text !== 'string' || Object.keys(doc).some(key => key !== 'text')) {
    throw new Error('This file is not a minijour day.');
  }
  return doc;
}

export function mergeDays(left: DayDoc, right: DayDoc): DayDoc {
  // Clones keep saved/queued versions usable; the editor keeps its actor ID.
  return A.merge(A.clone(left, { actor: A.getActorId(left) }), A.clone(right));
}

export function heads(doc: DayDoc): string {
  return A.getHeads(doc).sort().join(',');
}

export function editDay(doc: DayDoc, text: string): DayDoc {
  return A.change(doc, draft => A.updateText(draft, ['text'], text));
}

export function markdown(days: ReadonlyMap<string, DayDoc>): string {
  return [...days].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, doc]) => `# ${date}\n\n${doc.text.trimEnd()}`)
    .join('\n\n') + '\n';
}
