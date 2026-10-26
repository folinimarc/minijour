import { expect, it } from 'vitest';
import * as A from '@automerge/automerge';
import { ChangeSet } from '@codemirror/state';
import { applyTextEdits, createDay, editDay, type DayDoc, type TextEdit } from '../src/domain/day';
import { mergeDocuments } from '../src/domain/documents';

const DATE = '2026-10-24';
function apply(doc: DayDoc, edits: TextEdit[]): DayDoc {
  // Exercise the actual editor's coordinate mapping, including combined edits.
  const changes = ChangeSet.of(edits, doc.text.length);
  const mapped: TextEdit[] = [];
  changes.iterChanges((from, to, _fromB, _toB, insert) => mapped.push({ from, to, insert: insert.toString() }));
  return applyTextEdits(doc, mapped);
}

it.each<{ label: string; text: string; edits: TextEdit[]; expected: string }>([
  { label: 'insertion', text: 'Morning.', edits: [{ from: 7, to: 7, insert: ' walk' }], expected: 'Morning walk.' },
  { label: 'deletion', text: 'Morning walk.', edits: [{ from: 7, to: 12, insert: '' }], expected: 'Morning.' },
  { label: 'replacement', text: 'Morning walk.', edits: [{ from: 0, to: 7, insert: 'Evening' }], expected: 'Evening walk.' },
  { label: 'multiline paste', text: 'Notes:', edits: [{ from: 6, to: 6, insert: '\n- One\n- Two' }], expected: 'Notes:\n- One\n- Two' },
  { label: 'UTF-16 emoji and accents', text: '🙂 café', edits: [{ from: 0, to: 2, insert: '🚀' }, { from: 3, to: 7, insert: 'tea' }], expected: '🚀 tea' },
  { label: 'multiple ranges', text: 'one two three', edits: [{ from: 0, to: 3, insert: '1' }, { from: 4, to: 7, insert: 'TWO!' }, { from: 13, to: 13, insert: '.' }], expected: '1 TWO! three.' },
])('applies $label as one Automerge change', ({ text, edits, expected }) => {
  const doc = editDay(createDay(DATE), text);
  const before = A.getAllChanges(doc).length;
  const edited = apply(doc, edits);
  expect(edited.text).toBe(expected);
  expect(A.getAllChanges(edited)).toHaveLength(before + 1);
  expect(A.view(edited, A.getHeads(doc)).text).toBe(text);
});

it('combines sequential editor transactions without losing their original positions', () => {
  const doc = editDay(createDay(DATE), 'A🙂B');
  const first = ChangeSet.of({ from: 1, to: 3, insert: '🚀!' }, doc.text.length);
  const second = ChangeSet.of([{ from: 0, insert: '[' }, { from: 5, insert: ']' }], first.newLength);
  const combined = first.compose(second);
  const edits: TextEdit[] = [];
  combined.iterChanges((from, to, _fromB, _toB, insert) => edits.push({ from, to, insert: insert.toString() }));
  expect(applyTextEdits(doc, edits).text).toBe('[A🚀!B]');
});

it('keeps concurrent edits mergeable with exact insertion and deletion positions', () => {
  const doc = editDay(createDay(DATE), 'A🙂B');
  const first = apply(A.clone(doc), [{ from: 0, to: 1, insert: 'Start' }]);
  const second = apply(A.clone(doc), [{ from: 4, to: 4, insert: ' End' }]);
  expect(mergeDocuments(first, second).text).toBe('Start🙂B End');
  expect(mergeDocuments(second, first).text).toBe('Start🙂B End');
});
