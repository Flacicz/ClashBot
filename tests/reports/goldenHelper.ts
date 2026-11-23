import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';

const GOLDEN_ROOT = resolve(import.meta.dirname, '..', 'fixtures', 'golden');

export function resolveGoldenPath(suite: string, caseName: string): string {
    return resolve(GOLDEN_ROOT, suite, `${caseName}.txt`);
}

export function readGoldenSnapshot(suite: string, caseName: string): string {
    return readFileSync(resolveGoldenPath(suite, caseName), 'utf8');
}

export function expectMatchesGolden(actual: string, suite: string, caseName: string): void {
    const expected = readGoldenSnapshot(suite, caseName);
    expect(actual).toBe(expected);
}
