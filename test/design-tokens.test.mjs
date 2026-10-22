/** Design tokens: every promised colour pairing meets its WCAG minimum. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { colorTokens, contrast, CONTRAST_RULES } from '../src/utils/design-tokens.js';

const tokens = colorTokens();

describe('design tokens', () => {
  test('ds.css declares every colour the rules refer to', () => {
    for (const { fg, bg } of CONTRAST_RULES) {
      assert.ok(tokens.has(fg), `${fg} missing from ds.css`);
      assert.ok(tokens.has(bg), `${bg} missing from ds.css`);
    }
  });

  for (const { fg, bg, min } of CONTRAST_RULES) {
    test(`${fg} on ${bg} ≥ ${min}:1`, () => {
      const ratio = contrast(tokens.get(fg), tokens.get(bg));
      assert.ok(ratio >= min, `${fg} ${tokens.get(fg)} on ${bg} ${tokens.get(bg)} is ${ratio}:1`);
    });
  }

  test('decorative tints are never used as a control edge', () => {
    // Sage and sand are below 3:1 against the page, which is fine for a
    // background and wrong for anything a patient must see the edge of.
    assert.ok(contrast(tokens.get('--color-accent-sage'), tokens.get('--color-bg')) < 3);
    assert.ok(contrast(tokens.get('--color-accent-sand'), tokens.get('--color-bg')) < 3);
    assert.notEqual(tokens.get('--color-border-strong'), tokens.get('--color-accent-sage'));
    assert.notEqual(tokens.get('--color-border-strong'), tokens.get('--color-accent-sand'));
  });

  test('contrast() matches known WCAG values', () => {
    assert.equal(contrast('#000000', '#FFFFFF'), 21);
    assert.equal(contrast('#FFFFFF', '#FFFFFF'), 1);
    assert.equal(contrast('#767676', '#FFFFFF'), 4.54);
  });
});
