import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/logging/logger.js';

function createMemoryStream(): { stream: Writable; getOutput: () => string } {
    const chunks: string[] = [];
    const stream = new Writable({
        write(chunk, _encoding, callback) {
            chunks.push(String(chunk));
            callback();
        },
    });
    return {
        stream,
        getOutput: () => chunks.join(''),
    };
}

describe('createLogger', () => {
    it('writes structured JSON logs to the destination stream by default', () => {
        const { stream, getOutput } = createMemoryStream();
        const logger = createLogger({ destination: stream, env: {} });

        logger.info({ clanTag: '#ABC123' }, 'Sync completed');

        const line = getOutput().trim();
        const parsed = JSON.parse(line) as Record<string, unknown>;
        expect(parsed.msg).toBe('Sync completed');
        expect(parsed.clanTag).toBe('#ABC123');
        expect(parsed.name).toBe('ClashBot');
        expect(parsed.level).toBe(30);
    });

    it('redacts sensitive token fields from structured logs', () => {
        const { stream, getOutput } = createMemoryStream();
        const logger = createLogger({ destination: stream, env: {} });

        logger.info(
            {
                supercellToken: 'secret-sc',
                telegramToken: 'secret-tg',
                authorization: 'Bearer secret-sc',
            },
            'Config loaded',
        );

        const output = getOutput();
        expect(output).not.toContain('secret-sc');
        expect(output).not.toContain('secret-tg');
        expect(output).toContain('[Redacted]');
    });

    it('supports human-readable pretty output for local development', () => {
        const { stream, getOutput } = createMemoryStream();
        const logger = createLogger({
            pretty: true,
            destination: stream,
            env: {},
        });

        logger.info({ component: 'Main' }, 'Starting ClashBot');

        const output = getOutput();
        expect(output).toContain('Starting ClashBot');
        expect(output).toContain('INFO');
        expect(() => {
            JSON.parse(output.trim());
        }).toThrow();
    });

    it('respects LOG_LEVEL and LOG_FORMAT environment variables', () => {
        const { stream, getOutput } = createMemoryStream();
        const logger = createLogger({
            destination: stream,
            env: { LOG_LEVEL: 'debug', LOG_FORMAT: 'json' },
        });

        logger.debug('debug message');

        const parsed = JSON.parse(getOutput().trim()) as Record<string, unknown>;
        expect(parsed.msg).toBe('debug message');
        expect(parsed.level).toBe(20);
    });

    it('is idempotent when called repeatedly', () => {
        const firstDest = createMemoryStream();
        const secondDest = createMemoryStream();

        const logger1 = createLogger({ destination: firstDest.stream, env: {} });
        const logger2 = createLogger({ destination: secondDest.stream, env: {} });

        logger1.info('first');
        logger2.info('second');

        expect(firstDest.getOutput()).toContain('first');
        expect(firstDest.getOutput()).not.toContain('second');
        expect(secondDest.getOutput()).toContain('second');
        expect(secondDest.getOutput()).not.toContain('first');
    });
});
