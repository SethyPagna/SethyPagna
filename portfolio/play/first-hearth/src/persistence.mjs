import { newGame, readSave } from './engine.mjs';

const SAVE_KEY = 'living-kingdom-p001';
const BACKUP_KEY = `${SAVE_KEY}-backup`;

export function restoreChronicle(storage, content) {
  try {
    const current = storage.getItem(SAVE_KEY);
    if (!current) return { state: newGame(content), warning: '', blocked: false };
    try { return { state: readSave(current, content), warning: '', blocked: false }; }
    catch {
      const backup = storage.getItem(BACKUP_KEY);
      if (backup) {
        try { return { state: readSave(backup, content), warning: 'Latest save was unreadable. Restored the previous valid decision.', blocked: false }; }
        catch { /* Keep both damaged originals until an explicit new game or import. */ }
      }
      return { state: newGame(content), warning: 'Damaged save preserved. Autosave paused; export this session, or explicitly start/import a chronicle to replace it.', blocked: true };
    }
  } catch { return { state: newGame(content), warning: 'Browser storage unavailable. Export your session before closing.', blocked: false }; }
}

export function persistChronicle(storage, state, options) {
  if (options.blocked) return 'Autosave paused to preserve a damaged save. Export this session before closing.';
  try {
    const previous = storage.getItem(SAVE_KEY);
    if (previous) {
      try { readSave(previous, options.content); storage.setItem(BACKUP_KEY, previous); }
      catch { /* A malformed current save must not replace the last valid backup. */ }
    }
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return '';
  } catch { return 'Could not autosave. Your decision is in memory; export before closing.'; }
}
