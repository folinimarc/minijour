import * as A from '@automerge/automerge';
import { isPhotoOptions, type PhotoOptions } from './photos';

export type Preferences = { photoOptions?: PhotoOptions };
export type PreferencesDoc = A.Doc<Preferences>;

// Defaults are a fallback, not a saved change. A fresh device has no opinion
// to merge until the person changes a setting or receives one from elsewhere.
export function createPreferences(): PreferencesDoc { return A.init<Preferences>(); }

export function loadPreferences(bytes: Uint8Array): PreferencesDoc {
  const doc = A.load<Preferences>(bytes);
  const choices = Object.values(A.getConflicts(doc, 'photoOptions') ?? {});
  if (Object.keys(doc).some(key => key !== 'photoOptions')
    || doc.photoOptions !== undefined && !isPhotoOptions(doc.photoOptions)
    || choices.some(value => !isPhotoOptions(value))) {
    throw new Error('Invalid journal preferences.');
  }
  return doc;
}

export function changePhotoOptions(doc: PreferencesDoc, options: PhotoOptions): PreferencesDoc {
  if (!isPhotoOptions(options)) throw new Error('Invalid photo settings.');
  // Replace the pair together. Concurrent changes choose one complete setting
  // through Automerge, rather than mixing the flag from one device and its size.
  // Pending writes need independent actors until either result is committed.
  return A.change(A.clone(doc), draft => { draft.photoOptions = { ...options }; });
}
