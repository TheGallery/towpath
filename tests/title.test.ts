import { describe, expect, it } from 'vitest';
import { GAME_TITLE } from '../src/title';

describe('GAME_TITLE', () => {
  it('names the game', () => {
    expect(GAME_TITLE).toBe('Towpath');
  });
});
