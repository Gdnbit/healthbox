import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const foundationsCss = readFileSync(
  resolve(process.cwd(), 'src/styles/household-health-foundations.css'),
  'utf8'
);
const prototypeCss = readFileSync(
  resolve(process.cwd(), 'src/pages/prototype/HouseholdHealthPrototype.css'),
  'utf8'
);

describe('household health design-token scope', () => {
  it('provides design tokens to portalled modal content', () => {
    expect(foundationsCss).toMatch(
      /\.health-prototype,\s*\.hhp-modal-backdrop\s*\{[\s\S]*--hhp-surface:\s*#fffefa;/
    );
    expect(prototypeCss).toMatch(
      /\.hhp-modal\s*\{[\s\S]*?background:\s*var\(--hhp-surface\);/
    );
  });
});
