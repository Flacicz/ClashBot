import { describe, expect, it } from 'vitest';

import type { ClanwarRosterPlayerReport } from '../../src/analytics/clanwarRosterAnalyzer.js';
import {
    DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH,
    TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
    countTelegramHtmlVisibleLength,
    splitHtmlMessage,
} from '../../src/notifications/index.js';
import { ClanwarRosterFormatter } from '../../src/reports/index.js';
import { expectMatchesGolden } from '../reports/goldenHelper.js';

const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*(\/?)>/;
const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/;
const VALID_ENTITY_RE = /^&(lt|gt|amp|quot|apos|nbsp|#\d+|#[xX][0-9a-fA-F]+);/i;

/**
 * Verifies that a chunk is well-formed Telegram HTML with balanced tags,
 * no broken tags or entities, and no lone UTF-16 surrogates.
 */
function assertValidTelegramHtml(chunk: string): void {
    const stack: string[] = [];

    for (let i = 0; i < chunk.length; i += 1) {
        const code = chunk.charCodeAt(i);
        // Check for lone high/low UTF-16 surrogates
        if (code >= 0xd800 && code <= 0xdbff) {
            const nextCode = i + 1 < chunk.length ? chunk.charCodeAt(i + 1) : 0;
            expect(nextCode >= 0xdc00 && nextCode <= 0xdfff).toBe(true);
            i += 1;
            continue;
        }
        if (code >= 0xdc00 && code <= 0xdfff) {
            throw new Error(`Found lone low UTF-16 surrogate at index ${String(i)}`);
        }

        const char = chunk[i];
        if (char === '<') {
            const slice = chunk.slice(i);
            const closeMatch = CLOSE_TAG_RE.exec(slice);
            const closeTagName = closeMatch?.[1];
            if (closeMatch !== null && closeTagName !== undefined) {
                const tagName = closeTagName.toLowerCase();
                const popped = stack.pop();
                expect(popped).toBe(tagName);
                i += closeMatch[0].length - 1;
                continue;
            }

            const openMatch = OPEN_TAG_RE.exec(slice);
            const openTagName = openMatch?.[1];
            if (openMatch !== null && openTagName !== undefined) {
                if (openMatch[2] !== '/') {
                    stack.push(openTagName.toLowerCase());
                }
                i += openMatch[0].length - 1;
                continue;
            }

            throw new Error(
                `Found broken or unescaped '<' at index ${String(i)}: ${slice.slice(0, 20)}`,
            );
        }

        if (char === '&') {
            const slice = chunk.slice(i);
            const entityMatch = VALID_ENTITY_RE.exec(slice);
            if (entityMatch === null) {
                throw new Error(
                    `Found broken or unescaped '&' at index ${String(i)}: ${slice.slice(0, 20)}`,
                );
            }
            i += entityMatch[0].length - 1;
        }
    }

    expect(stack).toEqual([]);
}

function buildFiftyPlayerRosterReport(): string {
    const players: ClanwarRosterPlayerReport[] = [];

    for (let i = 1; i <= 50; i += 1) {
        const padded = String(i).padStart(2, '0');
        const playerName =
            i % 3 === 0
                ? `👑 Легенда <Клана & Войны> №${padded} 《Боец 🔥⚔️》`
                : `ДлинноеИмяИгрока_СуперВоин_${padded}_ClashOfClans_🏆`;

        if (i <= 15) {
            players.push({
                playerTag: `#P${padded}`,
                playerName,
                includedWars: 5,
                lastWarOffset: 0,
                attacksUsed: 10,
                averageStarsPerAttack: 2.85,
                averageDestructionPerAttack: 95.4,
                warsWithoutAttacks: 0,
                warsWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            });
        } else if (i <= 30) {
            players.push({
                playerTag: `#P${padded}`,
                playerName,
                includedWars: 4,
                lastWarOffset: 1,
                attacksUsed: 7,
                averageStarsPerAttack: 2.1,
                averageDestructionPerAttack: 78.25,
                warsWithoutAttacks: 0,
                warsWithOneAttack: 1,
                firstAttacksNotOnMirror: 1,
            });
        } else if (i <= 45) {
            players.push({
                playerTag: `#P${padded}`,
                playerName,
                includedWars: 3,
                lastWarOffset: 2,
                attacksUsed: 2,
                averageStarsPerAttack: 1.5,
                averageDestructionPerAttack: 52.0,
                warsWithoutAttacks: 1,
                warsWithOneAttack: 1,
                firstAttacksNotOnMirror: 1,
            });
        } else {
            players.push({
                playerTag: `#P${padded}`,
                playerName,
                includedWars: 0,
                lastWarOffset: null,
                attacksUsed: 0,
                averageStarsPerAttack: 0,
                averageDestructionPerAttack: 0,
                warsWithoutAttacks: 0,
                warsWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            });
        }
    }

    return ClanwarRosterFormatter.buildReport({
        warsCount: 5,
        players,
    });
}

describe('htmlMessageSplitter', () => {
    it('counts visible UTF-16 length after stripping HTML tags and decoding entities', () => {
        expect(countTelegramHtmlVisibleLength('<b>Hello</b>')).toBe(5);
        expect(
            countTelegramHtmlVisibleLength('<a href="https://example.com?a=1&amp;b=2">Link</a>'),
        ).toBe(4);
        expect(countTelegramHtmlVisibleLength('&lt;&gt;&amp;&quot;&apos;&nbsp;')).toBe(6);
        // BMP numeric entity (1 UTF-16 code unit) vs astral emoji entity (2 UTF-16 code units)
        expect(countTelegramHtmlVisibleLength('&#65;&#x42;&#128512;&#x1F525;')).toBe(6);
        // Astral emoji literal (2 UTF-16 code units) and ZWJ sequence (11 UTF-16 code units)
        expect(countTelegramHtmlVisibleLength('🔥')).toBe(2);
        expect(countTelegramHtmlVisibleLength('👨‍👩‍👧‍👦')).toBe(11);
    });

    it('returns short messages untouched without adding a part indicator, even when raw HTML exceeds the limit', () => {
        const short = '<b>Короткий отчёт</b>\nБез разбиения';
        expect(splitHtmlMessage(short)).toEqual([short]);
        expect(splitHtmlMessage(short)[0]).not.toContain('Часть');

        // Exactly 20 visible characters, but raw HTML length is much larger due to tags & entities
        const exactBoundary =
            '<a href="https://example.com/very/long/url"><b>&lt;1234567890&amp;1234567&gt;</b></a>';
        expect(countTelegramHtmlVisibleLength(exactBoundary)).toBe(20);
        expect(exactBoundary.length).toBeGreaterThan(20);
        expect(splitHtmlMessage(exactBoundary, { maxVisibleLength: 20 })).toEqual([exactBoundary]);
    });

    it('matches golden snapshot when splitting nested HTML tags, entities, and emojis across newlines', () => {
        const html = [
            '<b><i>Клановый отчёт &amp; итоги 🔥</i></b>',
            '<a href="https://example.com/war?id=1&amp;mode=full"><b>Игрок &lt;Alpha&gt; 👨‍👩‍👧‍👦 — 3⭐',
            'Игрок &lt;Beta&gt; ⚔️ — 2⭐</b></a>',
            '<code>#2PPLQ</code>',
        ].join('\n');

        const parts = splitHtmlMessage(html, { maxVisibleLength: 75 });
        expect(parts).toHaveLength(2);

        for (const part of parts) {
            assertValidTelegramHtml(part);
            expect(countTelegramHtmlVisibleLength(part)).toBeLessThanOrEqual(75);
        }

        const formatted = parts
            .map((part, idx) => `=== PART ${String(idx + 1)}/${String(parts.length)} ===\n${part}`)
            .join('\n');
        expectMatchesGolden(formatted, 'htmlMessageSplitter', 'nested-tags-entities-emoji');
    });

    it('preserves nested tags (<pre><code>, <tg-spoiler>, <blockquote expandable>) and never splits inside entities or grapheme clusters on oversized single lines', () => {
        const singleLine =
            '<blockquote expandable><tg-spoiler><pre><code class="language-ts">' +
            '&amp;&lt;&gt;&#128512;👨‍👩‍👧‍👦🇷🇺⚠️'.repeat(8) +
            '</code></pre></tg-spoiler></blockquote>';

        const parts = splitHtmlMessage(singleLine, { maxVisibleLength: 60 });
        expect(parts.length).toBeGreaterThan(2);

        for (let i = 0; i < parts.length; i += 1) {
            const part = parts[i] ?? '';
            assertValidTelegramHtml(part);
            expect(countTelegramHtmlVisibleLength(part)).toBeLessThanOrEqual(60);
            expect(part).toContain(`<i>Часть ${String(i + 1)}/${String(parts.length)}</i>`);
            expect(part).toContain(
                '<blockquote expandable><tg-spoiler><pre><code class="language-ts">',
            );
            expect(part).toContain('</code></pre></tg-spoiler></blockquote>');
        }

        // Verify no emoji or entity was lost or corrupted
        const stripped = parts
            .map((p) => p.replace(/\n\n<i>Часть \d+\/\d+<\/i>$/, '').replace(/<[^>]+>/g, ''))
            .join('');
        expect(stripped).toBe('&amp;&lt;&gt;&#128512;👨‍👩‍👧‍👦🇷🇺⚠️'.repeat(8));
    });

    it('prefers word boundaries when wrapping an oversized single line with spaces', () => {
        const line =
            '<b>' +
            Array.from({ length: 12 }, (_, i) => `слово${String(i + 1)}`).join(' ') +
            '</b>';
        const parts = splitHtmlMessage(line, { maxVisibleLength: 45 });

        expect(parts.length).toBeGreaterThanOrEqual(2);
        for (const part of parts) {
            assertValidTelegramHtml(part);
            expect(countTelegramHtmlVisibleLength(part)).toBeLessThanOrEqual(45);
        }

        // Every word stays intact (none split mid-word)
        const combinedWords = parts
            .map((p) => p.replace(/\n\n<i>Часть \d+\/\d+<\/i>$/, '').replace(/<[^>]+>/g, ''))
            .join(' ')
            .split(/\s+/);
        expect(combinedWords).toEqual(
            Array.from({ length: 12 }, (_, i) => `слово${String(i + 1)}`),
        );
    });

    it('recalculates content budget when part count crosses from 1 digit to 2 digits (10+ parts)', () => {
        const lines = Array.from(
            { length: 24 },
            (_, i) => `Строка_${String(i + 1).padStart(2, '0')}_текст`,
        );
        const html = lines.join('\n');

        const parts = splitHtmlMessage(html, { maxVisibleLength: 35 });
        expect(parts.length).toBeGreaterThanOrEqual(10);

        for (let i = 0; i < parts.length; i += 1) {
            const part = parts[i] ?? '';
            assertValidTelegramHtml(part);
            expect(countTelegramHtmlVisibleLength(part)).toBeLessThanOrEqual(35);
            expect(part).toContain(`<i>Часть ${String(i + 1)}/${String(parts.length)}</i>`);
        }
    });

    it('avoids empty reopened/closed tag pairs and leading/trailing blank lines at split boundaries', () => {
        const html = '<b>Первая строка\n</b>\n\nВторая строка';
        // "Первая строка" is 13 visible chars; maxVisibleLength = 24 reserves 11 chars for "\n\nЧасть 1/2",
        // leaving contentBudget = 13 so "\n</b>" spills onto part 2 and collapses cleanly without "<b></b>".
        const parts = splitHtmlMessage(html, { maxVisibleLength: 24 });

        expect(parts).toHaveLength(2);
        expect(parts[0]).toBe('<b>Первая строка</b>\n\n<i>Часть 1/2</i>');
        expect(parts[1]).toBe('Вторая строка\n\n<i>Часть 2/2</i>');
        for (const part of parts) {
            assertValidTelegramHtml(part);
            expect(part).not.toContain('<b></b>');
            expect(countTelegramHtmlVisibleLength(part)).toBeLessThanOrEqual(24);
        }
    });

    it('splits a 50-player ClanwarRosterFormatter report with long names under the default 3900 visible limit', () => {
        const report = buildFiftyPlayerRosterReport();
        expect(countTelegramHtmlVisibleLength(report)).toBeGreaterThan(
            TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
        );

        const parts = splitHtmlMessage(report);
        expect(parts.length).toBeGreaterThanOrEqual(2);

        for (let i = 0; i < parts.length; i += 1) {
            const part = parts[i] ?? '';
            assertValidTelegramHtml(part);
            const visibleLen = countTelegramHtmlVisibleLength(part);
            expect(visibleLen).toBeGreaterThan(0);
            expect(visibleLen).toBeLessThanOrEqual(DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH);
            expect(visibleLen).toBeLessThanOrEqual(TELEGRAM_HARD_MAX_VISIBLE_LENGTH);
            expect(part).toContain(`<i>Часть ${String(i + 1)}/${String(parts.length)}</i>`);
        }

        // All 50 players must appear in the split parts in order
        const joined = parts.join('\n');
        for (let i = 1; i <= 50; i += 1) {
            const padded = String(i).padStart(2, '0');
            expect(joined).toContain(padded);
        }
        expect(parts[0]).toContain('📋 <b>НАДЁЖНОСТЬ СОСТАВА</b>');
    });

    it('validates maxVisibleLength option', () => {
        expect(() => splitHtmlMessage('test', { maxVisibleLength: 0 })).toThrow(RangeError);
        expect(() => splitHtmlMessage('test', { maxVisibleLength: -10 })).toThrow(RangeError);
        expect(() => splitHtmlMessage('test', { maxVisibleLength: 10.5 })).toThrow(RangeError);
        expect(() => splitHtmlMessage('a'.repeat(30), { maxVisibleLength: 10 })).toThrow(
            RangeError,
        );
    });
});
