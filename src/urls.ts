// Both entry scripts are built into assets/ (and live in src/ during dev).
// Resolving from the module keeps links correct at / and at /minijour/.
export const appRoot = new URL(/* @vite-ignore */ '../', import.meta.url);
export const journalUrl = new URL('journal/', appRoot);
