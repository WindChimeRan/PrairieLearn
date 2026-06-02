import { describe, expect, it } from 'vitest';

import { shouldGenerateHintForScore } from '../../lib/ai-grading/ai-hints.js';

describe('shouldGenerateHintForScore', () => {
  it('offers a hint for a fully-correct submission (score = 1)', () => {
    expect(shouldGenerateHintForScore(1)).toBe(true);
  });
});
