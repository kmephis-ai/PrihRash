import { normalizeSourceLabel } from '../reference/bootstrap.js';

export function analyticsStateFromNote(note: string | null): 'INCLUDED' | 'EXCLUDED' {
  return note !== null && normalizeSourceLabel(note) === 'Не учитывать' ? 'EXCLUDED' : 'INCLUDED';
}
