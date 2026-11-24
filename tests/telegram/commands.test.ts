import { describe, expect, it } from 'vitest';

import { parseBotCommand, parseClanTag, parseCommand } from '../../src/telegram/commands.js';

describe('parseCommand', () => {
    it('parses /start command', () => {
        expect(parseCommand('/start')).toEqual({
            name: 'start',
            arguments: [],
        });
    });

    it('parses /link command and tag argument', () => {
        expect(parseCommand('/link #2pplq')).toEqual({
            name: 'link',
            arguments: ['#2pplq'],
        });
    });

    it('parses /unlink command and tag argument', () => {
        expect(parseCommand('/unlink #2PPLQ')).toEqual({
            name: 'unlink',
            arguments: ['#2PPLQ'],
        });
    });

    it('preserves extra arguments for command validation', () => {
        expect(parseCommand('/unlink #2PPLQ extra')).toEqual({
            name: 'unlink',
            arguments: ['#2PPLQ', 'extra'],
        });
    });

    it('parses /link command without arguments', () => {
        expect(parseCommand('/link')).toEqual({
            name: 'link',
            arguments: [],
        });
    });

    it('preserves @bot_username suffix and lowercases command name', () => {
        expect(parseCommand('/LINK@clash_bot 2PPLQ')).toEqual({
            name: 'link',
            arguments: ['2PPLQ'],
            botUsername: 'clash_bot',
        });
        expect(parseCommand('  /Start@MyBot   ')).toEqual({
            name: 'start',
            arguments: [],
            botUsername: 'MyBot',
        });
    });

    it('rejects non-command text, empty slash commands, and empty @bot_username suffix', () => {
        expect(parseCommand('hello')).toBeNull();
        expect(parseCommand('')).toBeNull();
        expect(parseCommand('   ')).toBeNull();
        expect(parseCommand('/')).toBeNull();
        expect(parseCommand('/@clash_bot')).toBeNull();
        expect(parseCommand('/start@')).toBeNull();
        expect(parseCommand('/link@ #2PPLQ')).toBeNull();
    });
});

describe('parseClanTag', () => {
    it('parses valid clan tag with or without leading hash and normalizes to uppercase', () => {
        expect(parseClanTag('2pplq')).toBe('#2PPLQ');
        expect(parseClanTag('#2PPLQ')).toBe('#2PPLQ');
        expect(parseClanTag('0289pylqgrjcuv')).toBe('#0289PYLQGRJCUV');
        expect(parseClanTag('#2PP')).toBe('#2PP');
        expect(parseClanTag('0289PYLQGRJCUV0')).toBe('#0289PYLQGRJCUV0');
    });

    it('rejects invalid clan tag formats, lengths, and disallowed characters', () => {
        expect(parseClanTag('#2PPA')).toBeNull(); // A is not in CoC alphabet
        expect(parseClanTag('#2PPLQ-')).toBeNull();
        expect(parseClanTag('#2P')).toBeNull(); // too short (2)
        expect(parseClanTag('2P')).toBeNull();
        expect(parseClanTag('#2PPLQ0123456789')).toBeNull(); // 1 is invalid & length 15
        expect(parseClanTag('#0289PYLQGRJCUV02')).toBeNull(); // too long (16)
        expect(parseClanTag('##2PPLQ')).toBeNull(); // double hash
        expect(parseClanTag('')).toBeNull();
        expect(parseClanTag('#')).toBeNull();
        expect(parseClanTag(' #2PPLQ')).toBeNull(); // leading whitespace
        expect(parseClanTag('#2PPLQ ')).toBeNull(); // trailing whitespace
        expect(parseClanTag('O2PPLQ')).toBeNull(); // letter O instead of 0
    });

    it('is idempotent when called repeatedly on normalized tag', () => {
        const first = parseClanTag('2pplq');
        expect(first).toBe('#2PPLQ');
        expect(parseClanTag(first ?? '')).toBe('#2PPLQ');
    });
});

describe('parseBotCommand', () => {
    it('parses /start without arguments and ignores /start with extra arguments', () => {
        expect(parseBotCommand('/start')).toEqual({ kind: 'start' });
        expect(parseBotCommand('/START@clash_bot')).toEqual({
            kind: 'start',
            botUsername: 'clash_bot',
        });
        expect(parseBotCommand('/start extra')).toBeNull();
    });

    it('parses valid /link and /unlink commands with normalized clan tag', () => {
        expect(parseBotCommand('/link 2pplq')).toEqual({
            kind: 'link',
            status: 'ok',
            clanTag: '#2PPLQ',
        });
        expect(parseBotCommand('/unlink@clash_bot #2pplq')).toEqual({
            kind: 'unlink',
            status: 'ok',
            clanTag: '#2PPLQ',
            botUsername: 'clash_bot',
        });
    });

    it('reports invalid_arguments when /link or /unlink does not have exactly one argument', () => {
        expect(parseBotCommand('/link')).toEqual({
            kind: 'link',
            status: 'invalid_arguments',
        });
        expect(parseBotCommand('/link@OtherBot')).toEqual({
            kind: 'link',
            status: 'invalid_arguments',
            botUsername: 'OtherBot',
        });
        expect(parseBotCommand('/link #2PPLQ extra')).toEqual({
            kind: 'link',
            status: 'invalid_arguments',
        });
        expect(parseBotCommand('/unlink')).toEqual({
            kind: 'unlink',
            status: 'invalid_arguments',
        });
        expect(parseBotCommand('/unlink #2PPLQ extra')).toEqual({
            kind: 'unlink',
            status: 'invalid_arguments',
        });
    });

    it('reports invalid_clan_tag when /link or /unlink has a single invalid tag', () => {
        expect(parseBotCommand('/link #INVALID')).toEqual({
            kind: 'link',
            status: 'invalid_clan_tag',
            rawTag: '#INVALID',
        });
        expect(parseBotCommand('/link@OtherBot #INVALID')).toEqual({
            kind: 'link',
            status: 'invalid_clan_tag',
            rawTag: '#INVALID',
            botUsername: 'OtherBot',
        });
        expect(parseBotCommand('/unlink #2P')).toEqual({
            kind: 'unlink',
            status: 'invalid_clan_tag',
            rawTag: '#2P',
        });
    });

    it('ignores unsupported commands and non-command messages', () => {
        expect(parseBotCommand('/help')).toBeNull();
        expect(parseBotCommand('/unknown@clash_bot arg')).toBeNull();
        expect(parseBotCommand('plain text')).toBeNull();
    });
});
