import * as A from '@automerge/automerge';

/** Compare document versions, including versions sharing an Automerge backend. */
export function heads<T>(doc: A.Doc<T>): string {
  return A.getHeads(doc).sort().join(',');
}

/** Clones keep saved/queued versions usable and preserve the local actor ID. */
export function mergeDocuments<T>(left: A.Doc<T>, right: A.Doc<T>): A.Doc<T> {
  return A.merge(A.clone(left, { actor: A.getActorId(left) }), A.clone(right));
}
