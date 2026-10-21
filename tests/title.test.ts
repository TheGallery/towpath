import { describe, expect, it } from 'vitest';
import { GAME_TITLE, tabTitle } from '../src/title';

describe('GAME_TITLE', () => {
  it('names the game', () => {
    expect(GAME_TITLE).toBe('Towpath');
  });
});

describe('tabTitle', () => {
  it('is just the name when nothing is calling', () => {
    expect(tabTitle(null)).toBe('Towpath');
  });

  it('puts the bell and the call first, so a narrow tab still shows them', () => {
    expect(tabTitle('Waiting at Brook Lock')).toBe('🔔 Waiting at Brook Lock · Towpath');
  });
});
