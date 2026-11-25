export const TELEGRAM_HARD_MAX_VISIBLE_LENGTH = 4_096;
export const DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH = 3_900;

export interface SplitHtmlMessageOptions {
    readonly maxVisibleLength?: number;
}

interface OpenTag {
    readonly tagName: string;
    readonly raw: string;
}

type HtmlToken =
    | {
          readonly kind: 'open_tag';
          readonly raw: string;
          readonly tagName: string;
          readonly visibleLength: 0;
      }
    | {
          readonly kind: 'close_tag';
          readonly raw: string;
          readonly tagName: string;
          readonly visibleLength: 0;
      }
    | {
          readonly kind: 'self_closing_tag';
          readonly raw: string;
          readonly visibleLength: 0;
      }
    | {
          readonly kind: 'newline';
          readonly raw: '\n';
          readonly visibleLength: 1;
      }
    | {
          readonly kind: 'entity';
          readonly raw: string;
          readonly visibleLength: number;
      }
    | {
          readonly kind: 'text';
          readonly raw: string;
          readonly visibleLength: number;
      };

type BufferItem =
    | {
          readonly kind: 'open';
          readonly tagName: string;
          readonly raw: string;
          readonly reopened: boolean;
      }
    | {
          readonly kind: 'close';
          readonly tagName: string;
          readonly raw: string;
      }
    | {
          readonly kind: 'newline';
      }
    | {
          readonly kind: 'content';
          readonly raw: string;
          readonly visibleLength: number;
      };

const OPEN_OR_SELF_CLOSING_TAG_PATTERN =
    /^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*(\/?)>/;
const CLOSE_TAG_PATTERN = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/;
const NAMED_ENTITY_PATTERN = /^&(lt|gt|amp|quot|apos|nbsp);/i;
const DECIMAL_ENTITY_PATTERN = /^&#(\d+);/;
const HEX_ENTITY_PATTERN = /^&#[xX]([0-9a-fA-F]+);/;
const WHITESPACE_ONLY_PATTERN = /^\s+$/;

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function decodedCodePointUtf16Length(codePoint: number): number | undefined {
    if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
        return undefined;
    }
    return codePoint > 0xffff ? 2 : 1;
}

function matchHtmlEntity(
    input: string,
): { readonly raw: string; readonly visibleLength: number } | undefined {
    const named = NAMED_ENTITY_PATTERN.exec(input);
    if (named !== null) {
        return { raw: named[0], visibleLength: 1 };
    }

    const decimal = DECIMAL_ENTITY_PATTERN.exec(input);
    const decimalDigits = decimal?.[1];
    if (decimal !== null && decimalDigits !== undefined) {
        const length = decodedCodePointUtf16Length(Number.parseInt(decimalDigits, 10));
        if (length !== undefined) {
            return { raw: decimal[0], visibleLength: length };
        }
    }

    const hex = HEX_ENTITY_PATTERN.exec(input);
    const hexDigits = hex?.[1];
    if (hex !== null && hexDigits !== undefined) {
        const length = decodedCodePointUtf16Length(Number.parseInt(hexDigits, 16));
        if (length !== undefined) {
            return { raw: hex[0], visibleLength: length };
        }
    }

    return undefined;
}

function tokenizeTelegramHtml(html: string): HtmlToken[] {
    const tokens: HtmlToken[] = [];
    let index = 0;

    while (index < html.length) {
        const char = html[index];

        if (char === '\n') {
            tokens.push({ kind: 'newline', raw: '\n', visibleLength: 1 });
            index += 1;
            continue;
        }

        if (char === '<') {
            const slice = html.slice(index);

            const closeMatch = CLOSE_TAG_PATTERN.exec(slice);
            const closeTagName = closeMatch?.[1];
            if (closeMatch !== null && closeTagName !== undefined) {
                tokens.push({
                    kind: 'close_tag',
                    raw: closeMatch[0],
                    tagName: closeTagName.toLowerCase(),
                    visibleLength: 0,
                });
                index += closeMatch[0].length;
                continue;
            }

            const openMatch = OPEN_OR_SELF_CLOSING_TAG_PATTERN.exec(slice);
            const openTagName = openMatch?.[1];
            if (openMatch !== null && openTagName !== undefined) {
                const raw = openMatch[0];
                const isSelfClosing = openMatch[2] === '/';
                if (isSelfClosing) {
                    tokens.push({
                        kind: 'self_closing_tag',
                        raw,
                        visibleLength: 0,
                    });
                } else {
                    tokens.push({
                        kind: 'open_tag',
                        raw,
                        tagName: openTagName.toLowerCase(),
                        visibleLength: 0,
                    });
                }
                index += raw.length;
                continue;
            }
        }

        if (char === '&') {
            const entity = matchHtmlEntity(html.slice(index));
            if (entity !== undefined) {
                tokens.push({
                    kind: 'entity',
                    raw: entity.raw,
                    visibleLength: entity.visibleLength,
                });
                index += entity.raw.length;
                continue;
            }
        }

        // Consume a contiguous plain-text run up to the next special character (`\n`, `<`, `&`),
        // advancing at least one character if the current `<` or `&` was not a valid tag/entity.
        let end = index + 1;
        while (end < html.length) {
            const nextChar = html[end];
            if (nextChar === '\n' || nextChar === '<' || nextChar === '&') {
                break;
            }
            end += 1;
        }

        const raw = html.slice(index, end);
        tokens.push({
            kind: 'text',
            raw,
            visibleLength: raw.length,
        });
        index = end;
    }

    return tokens;
}

function splitTokensIntoLines(tokens: readonly HtmlToken[]): HtmlToken[][] {
    const lines: HtmlToken[][] = [[]];

    for (const token of tokens) {
        if (token.kind === 'newline') {
            lines.push([]);
        } else {
            const currentLine = lines[lines.length - 1];
            if (currentLine !== undefined) {
                currentLine.push(token);
            }
        }
    }

    return lines;
}

function expandLineToGraphemeTokens(lineTokens: readonly HtmlToken[]): HtmlToken[] {
    const expanded: HtmlToken[] = [];

    for (const token of lineTokens) {
        if (token.kind !== 'text') {
            expanded.push(token);
            continue;
        }

        for (const { segment } of GRAPHEME_SEGMENTER.segment(token.raw)) {
            expanded.push({
                kind: 'text',
                raw: segment,
                visibleLength: segment.length,
            });
        }
    }

    return expanded;
}

function lineVisibleLength(lineTokens: readonly HtmlToken[]): number {
    let total = 0;
    for (const token of lineTokens) {
        total += token.visibleLength;
    }
    return total;
}

function formatPartIndicator(partIndex: number, partCount: number): string {
    return `\n\n<i>Часть ${String(partIndex)}/${String(partCount)}</i>`;
}

function partIndicatorVisibleLength(partIndex: number, partCount: number): number {
    return 2 + 'Часть '.length + String(partIndex).length + 1 + String(partCount).length;
}

class HtmlChunkBuilder {
    readonly chunks: string[] = [];
    private readonly openTags: OpenTag[] = [];
    private buffer: BufferItem[] = [];
    private visibleLength = 0;
    private hasContent = false;

    get currentVisibleLength(): number {
        return this.visibleLength;
    }

    get currentHasContent(): boolean {
        return this.hasContent;
    }

    pushNewline(): void {
        this.buffer.push({ kind: 'newline' });
        this.visibleLength += 1;
    }

    pushToken(token: HtmlToken): void {
        switch (token.kind) {
            case 'open_tag': {
                this.openTags.push({ tagName: token.tagName, raw: token.raw });
                this.buffer.push({
                    kind: 'open',
                    tagName: token.tagName,
                    raw: token.raw,
                    reopened: false,
                });
                return;
            }
            case 'close_tag': {
                this.popOpenTag(token.tagName);
                const last = this.buffer[this.buffer.length - 1];
                if (last?.kind === 'open' && last.tagName === token.tagName) {
                    this.buffer.pop();
                    return;
                }
                this.buffer.push({
                    kind: 'close',
                    tagName: token.tagName,
                    raw: token.raw,
                });
                return;
            }
            case 'self_closing_tag': {
                this.buffer.push({
                    kind: 'content',
                    raw: token.raw,
                    visibleLength: 0,
                });
                return;
            }
            case 'entity':
            case 'text': {
                this.buffer.push({
                    kind: 'content',
                    raw: token.raw,
                    visibleLength: token.visibleLength,
                });
                this.visibleLength += token.visibleLength;
                if (token.visibleLength > 0) {
                    this.hasContent = true;
                }
                return;
            }
            case 'newline': {
                this.pushNewline();
                return;
            }
        }
    }

    pushTokens(tokens: readonly HtmlToken[]): void {
        for (const token of tokens) {
            this.pushToken(token);
        }
    }

    flush(): void {
        if (!this.hasContent) {
            this.resetBufferWithReopenedTags();
            return;
        }

        // Trim trailing blank lines and trailing opening tags that had no content yet in this chunk.
        // Those opening tags remain on `this.openTags` so they open cleanly at the start of the next chunk.
        let deferredOpenCount = 0;
        while (this.buffer.length > 0) {
            const last = this.buffer[this.buffer.length - 1];
            if (last === undefined) {
                break;
            }
            if (last.kind === 'newline') {
                this.buffer.pop();
                continue;
            }
            if (last.kind === 'open') {
                this.buffer.pop();
                deferredOpenCount += 1;
                continue;
            }
            break;
        }

        const activeOpenCount = Math.max(0, this.openTags.length - deferredOpenCount);
        let serialized = '';
        for (const item of this.buffer) {
            switch (item.kind) {
                case 'open':
                case 'close':
                case 'content':
                    serialized += item.raw;
                    break;
                case 'newline':
                    serialized += '\n';
                    break;
            }
        }

        for (let i = activeOpenCount - 1; i >= 0; i -= 1) {
            const tag = this.openTags[i];
            if (tag !== undefined) {
                serialized += `</${tag.tagName}>`;
            }
        }

        if (serialized.length > 0) {
            this.chunks.push(serialized);
        }

        this.resetBufferWithReopenedTags();
    }

    private popOpenTag(tagName: string): void {
        for (let i = this.openTags.length - 1; i >= 0; i -= 1) {
            if (this.openTags[i]?.tagName === tagName) {
                this.openTags.splice(i, 1);
                return;
            }
        }
    }

    private resetBufferWithReopenedTags(): void {
        this.buffer = this.openTags.map((tag) => ({
            kind: 'open',
            tagName: tag.tagName,
            raw: tag.raw,
            reopened: true,
        }));
        this.visibleLength = 0;
        this.hasContent = false;
    }
}

function splitOversizedLine(
    lineTokens: readonly HtmlToken[],
    contentBudget: number,
    builder: HtmlChunkBuilder,
): void {
    const expanded = expandLineToGraphemeTokens(lineTokens);
    let cursor = 0;

    while (cursor < expanded.length) {
        let end = cursor;
        let segmentVisible = 0;
        let lastWhitespaceIndex = -1;
        let hasVisibleBeforeWhitespace = false;

        while (end < expanded.length) {
            const token = expanded[end];
            if (token === undefined) {
                break;
            }

            // Do not pull an opening tag into the end of a full segment with zero remaining room.
            if (token.kind === 'open_tag' && segmentVisible >= contentBudget) {
                break;
            }

            if (segmentVisible + token.visibleLength > contentBudget) {
                // Guarantee forward progress if a single indivisible grapheme exceeds contentBudget.
                if (segmentVisible === 0 && token.visibleLength > 0) {
                    segmentVisible += token.visibleLength;
                    end += 1;
                }
                break;
            }

            if (
                token.kind === 'text' &&
                WHITESPACE_ONLY_PATTERN.test(token.raw) &&
                segmentVisible > 0
            ) {
                lastWhitespaceIndex = end;
                hasVisibleBeforeWhitespace = true;
            }

            segmentVisible += token.visibleLength;
            end += 1;
        }

        if (end >= expanded.length) {
            builder.pushTokens(expanded.slice(cursor));
            return;
        }

        // Prefer breaking at the last whitespace boundary when available to avoid mid-word splits.
        if (hasVisibleBeforeWhitespace && lastWhitespaceIndex > cursor) {
            builder.pushTokens(expanded.slice(cursor, lastWhitespaceIndex));
            builder.flush();
            cursor = lastWhitespaceIndex + 1;
            // Skip any immediately following whitespace at the start of the wrapped continuation.
            while (cursor < expanded.length) {
                const next = expanded[cursor];
                if (next?.kind === 'text' && WHITESPACE_ONLY_PATTERN.test(next.raw)) {
                    cursor += 1;
                } else {
                    break;
                }
            }
            continue;
        }

        builder.pushTokens(expanded.slice(cursor, end));
        builder.flush();
        cursor = end;
    }
}

function splitTokensIntoRawChunks(tokens: readonly HtmlToken[], contentBudget: number): string[] {
    const lines = splitTokensIntoLines(tokens);
    const builder = new HtmlChunkBuilder();

    for (const lineTokens of lines) {
        const lineLen = lineVisibleLength(lineTokens);

        // Skip leading blank lines at the start of a new chunk.
        if (!builder.currentHasContent && lineTokens.length === 0) {
            continue;
        }

        if (lineLen > contentBudget) {
            if (builder.currentHasContent) {
                builder.flush();
            }
            splitOversizedLine(lineTokens, contentBudget, builder);
            continue;
        }

        const separatorCost = builder.currentHasContent ? 1 : 0;
        if (
            builder.currentHasContent &&
            builder.currentVisibleLength + separatorCost + lineLen > contentBudget
        ) {
            builder.flush();
            // After flushing, skip a pure blank line so the next chunk starts directly on content.
            if (lineTokens.length === 0) {
                continue;
            }
        }

        if (builder.currentHasContent) {
            builder.pushNewline();
        }
        builder.pushTokens(lineTokens);
    }

    builder.flush();
    return builder.chunks;
}

/**
 * Counts visible UTF-16 code units of a Telegram HTML message after stripping
 * HTML tags and decoding standard/numeric HTML entities.
 */
export function countTelegramHtmlVisibleLength(html: string): number {
    const tokens = tokenizeTelegramHtml(html);
    let total = 0;
    for (const token of tokens) {
        total += token.visibleLength;
    }
    return total;
}

/**
 * Splits a Telegram HTML message into one or more HTML-safe parts whose visible
 * length (after entity parsing, including the `Часть K/N` indicator when split)
 * does not exceed `maxVisibleLength` (default 3900, safely under Telegram's 4096 limit).
 */
export function splitHtmlMessage(html: string, options: SplitHtmlMessageOptions = {}): string[] {
    const maxVisibleLength = options.maxVisibleLength ?? DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH;
    if (!Number.isInteger(maxVisibleLength) || maxVisibleLength <= 0) {
        throw new RangeError(
            `splitHtmlMessage maxVisibleLength must be a positive integer, got ${String(maxVisibleLength)}`,
        );
    }

    const tokens = tokenizeTelegramHtml(html);
    let totalVisible = 0;
    for (const token of tokens) {
        totalVisible += token.visibleLength;
    }

    if (totalVisible <= maxVisibleLength) {
        return [html];
    }

    let estimatedPartCount = 2;
    for (let iteration = 0; iteration < 10; iteration += 1) {
        const reservedIndicatorLength = partIndicatorVisibleLength(
            estimatedPartCount,
            estimatedPartCount,
        );
        const contentBudget = maxVisibleLength - reservedIndicatorLength;
        if (contentBudget < 1) {
            throw new RangeError(
                `splitHtmlMessage maxVisibleLength (${String(maxVisibleLength)}) is too small to fit a part indicator`,
            );
        }

        const rawChunks = splitTokensIntoRawChunks(tokens, contentBudget);
        if (rawChunks.length === 0) {
            return [html.slice(0, maxVisibleLength)];
        }
        if (rawChunks.length === 1) {
            const single = rawChunks[0];
            if (
                single !== undefined &&
                countTelegramHtmlVisibleLength(single) <= maxVisibleLength
            ) {
                return [single];
            }
            return [html];
        }

        const actualIndicatorLength = partIndicatorVisibleLength(
            rawChunks.length,
            rawChunks.length,
        );
        if (actualIndicatorLength <= reservedIndicatorLength) {
            const totalParts = rawChunks.length;
            return rawChunks.map(
                (chunk, index) => `${chunk}${formatPartIndicator(index + 1, totalParts)}`,
            );
        }

        estimatedPartCount = rawChunks.length;
    }

    // Fallback (unreachable in practice since part count digits stabilize in <= 2 iterations)
    const fallbackBudget = Math.max(
        1,
        maxVisibleLength - partIndicatorVisibleLength(estimatedPartCount, estimatedPartCount),
    );
    const rawChunks = splitTokensIntoRawChunks(tokens, fallbackBudget);
    if (rawChunks.length <= 1) {
        return rawChunks.length === 1 && rawChunks[0] !== undefined ? [rawChunks[0]] : [html];
    }
    const totalParts = rawChunks.length;
    return rawChunks.map((chunk, index) => `${chunk}${formatPartIndicator(index + 1, totalParts)}`);
}
