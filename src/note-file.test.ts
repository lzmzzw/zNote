import { describe, expect, it } from 'vitest';
import { conversionMenuState, displayMenuState, needsSave } from './note-file';

describe('file presentation rules', () => {
  it('allows conversion only for new notes and local txt files', () => {
    expect(conversionMenuState(null)).toBe('enabled');
    expect(conversionMenuState('C:\\notes\\draft.TXT')).toBe('enabled');
    for (const extension of ['md', 'markdown', 'json', 'jsonc', 'geojson', 'csv']) {
      expect(conversionMenuState(`C:\\notes\\saved.${extension}`)).toBe('disabled');
    }
    expect(conversionMenuState('C:\\notes\\script.js')).toBe('hidden');
  });

  it('allows display changes for ordinary text without changing conversion availability', () => {
    expect(displayMenuState(null)).toBe('enabled');
    expect(displayMenuState('C:\\notes\\draft.TXT')).toBe('enabled');
    expect(displayMenuState('C:\\notes\\server.log')).toBe('enabled');
    expect(conversionMenuState('C:\\notes\\server.log')).toBe('hidden');
    for (const extension of ['md', 'markdown', 'json', 'jsonc', 'geojson', 'csv']) {
      expect(displayMenuState(`C:\\notes\\saved.${extension}`)).toBe('disabled');
    }
  });

  it('marks new, modified, and save-as documents as unsaved', () => {
    expect(needsSave(null, false, false)).toBe(true);
    expect(needsSave('C:\\notes\\saved.md', true, false)).toBe(true);
    expect(needsSave('C:\\notes\\associated.md', false, true)).toBe(true);
    expect(needsSave('C:\\notes\\saved.md', false, false)).toBe(false);
  });
});
