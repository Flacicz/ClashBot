import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError } from '../../src/common/errors.js';
import {
    DEFAULT_CONFIG_PATH,
    loadConfig,
    loadConfigFromArgs,
    loadDotEnv,
    resolveConfigPath,
} from '../../src/config/loadConfig.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clashbot-config-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir !== undefined) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('resolveConfigPath', () => {
    it('uses the first CLI argument when provided', () => {
        expect(resolveConfigPath(['/app/config.json', '--extra'])).toBe('/app/config.json');
    });

    it('falls back to DEFAULT_CONFIG_PATH when no CLI argument is provided', () => {
        expect(resolveConfigPath([])).toBe(DEFAULT_CONFIG_PATH);
    });
});

describe('loadDotEnv', () => {
    it('loads KEY=VALUE pairs, ignores comments and empty lines, and preserves "=" in values', () => {
        const dir = createTempDir();
        const envPath = path.join(dir, '.env');
        fs.writeFileSync(
            envPath,
            [
                '# Comment line',
                '',
                'SUPERCELL_TOKEN=abc=def==',
                'TELEGRAM_TOKEN=12345:XYZ',
                '',
            ].join('\r\n'),
            'utf8',
        );

        const env: NodeJS.ProcessEnv = {};
        loadDotEnv(envPath, env);

        expect(env.SUPERCELL_TOKEN).toBe('abc=def==');
        expect(env.TELEGRAM_TOKEN).toBe('12345:XYZ');
    });

    it('does not overwrite already-defined environment variables', () => {
        const dir = createTempDir();
        const envPath = path.join(dir, '.env');
        fs.writeFileSync(
            envPath,
            'SUPERCELL_TOKEN=from-dotenv\nTELEGRAM_TOKEN=from-dotenv-tg\n',
            'utf8',
        );

        const env: NodeJS.ProcessEnv = {
            SUPERCELL_TOKEN: 'from-process-env',
        };
        loadDotEnv(envPath, env);

        expect(env.SUPERCELL_TOKEN).toBe('from-process-env');
        expect(env.TELEGRAM_TOKEN).toBe('from-dotenv-tg');
    });

    it('throws ConfigError on malformed .env lines', () => {
        const dir = createTempDir();
        const envPath = path.join(dir, '.env');
        fs.writeFileSync(envPath, 'SUPERCELL_TOKEN=ok\nINVALID_LINE_WITHOUT_EQUALS\n', 'utf8');

        expect(() => {
            loadDotEnv(envPath, {});
        }).toThrow(ConfigError);
    });

    it('throws ConfigError on line starting with "="', () => {
        const dir = createTempDir();
        const envPath = path.join(dir, '.env');
        fs.writeFileSync(envPath, '=missing-key\n', 'utf8');

        expect(() => {
            loadDotEnv(envPath, {});
        }).toThrow(ConfigError);
    });
});

describe('loadConfig', () => {
    it('loads full config.json and optional sibling .env', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        const envPath = path.join(dir, '.env');

        fs.writeFileSync(
            configPath,
            JSON.stringify({
                api: {
                    use_tunnel: true,
                    tunnel_base_url: 'https://localhost:8080/v1',
                    base_url: 'https://api.clashofclans.com/v1',
                },
                database: {
                    path: '/app/data/database.sqlite',
                    migrations_path: '/app/migrations',
                },
                telegram: {
                    attack_guides_path: '/app/resources/telegram/attack_guides.json',
                },
            }),
            'utf8',
        );
        fs.writeFileSync(
            envPath,
            'SUPERCELL_TOKEN=sc-secret-token\nTELEGRAM_TOKEN=tg-secret-token\n',
            'utf8',
        );

        const env: NodeJS.ProcessEnv = {};
        const config = loadConfig(configPath, { env });

        expect(config).toEqual({
            useTunnel: true,
            tunnelBaseUrl: 'https://localhost:8080/v1',
            baseUrl: 'https://api.clashofclans.com/v1',
            databasePath: '/app/data/database.sqlite',
            migrationPath: '/app/migrations',
            attackGuidesPath: '/app/resources/telegram/attack_guides.json',
            supercellToken: 'sc-secret-token',
            telegramToken: 'tg-secret-token',
        });
    });

    it('gives process environment variables priority over sibling .env', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        const envPath = path.join(dir, '.env');

        fs.writeFileSync(configPath, JSON.stringify({}), 'utf8');
        fs.writeFileSync(envPath, 'SUPERCELL_TOKEN=dotenv-sc\nTELEGRAM_TOKEN=dotenv-tg\n', 'utf8');

        const env: NodeJS.ProcessEnv = {
            SUPERCELL_TOKEN: 'env-sc',
        };
        const config = loadConfig(configPath, { env });

        expect(config.supercellToken).toBe('env-sc');
        expect(config.telegramToken).toBe('dotenv-tg');
    });

    it('loads successfully without a .env file when env vars are already set', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({}), 'utf8');

        const config = loadConfigFromArgs([configPath], {
            env: {
                SUPERCELL_TOKEN: 'sc-only-env',
                TELEGRAM_TOKEN: 'tg-only-env',
            },
        });

        expect(config.useTunnel).toBe(false);
        expect(config.baseUrl).toBe('https://api.clashofclans.com/v1/');
        expect(config.tunnelBaseUrl).toBe('https://localhost:8080/v1');
        expect(config.databasePath).toBe('data/database.sqlite');
        expect(config.migrationPath).toBe('migrations');
        expect(config.attackGuidesPath).toBe('resources/telegram/attack_guides.json');
        expect(config.supercellToken).toBe('sc-only-env');
        expect(config.telegramToken).toBe('tg-only-env');
    });

    it('is idempotent across repeated loadConfig calls', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        const envPath = path.join(dir, '.env');

        fs.writeFileSync(configPath, JSON.stringify({ api: { use_tunnel: false } }), 'utf8');
        fs.writeFileSync(envPath, 'SUPERCELL_TOKEN=sc-1\nTELEGRAM_TOKEN=tg-1\n', 'utf8');

        const env: NodeJS.ProcessEnv = { SUPERCELL_TOKEN: 'sc-override' };
        const first = loadConfig(configPath, { env });
        const second = loadConfig(configPath, { env });

        expect(second).toEqual(first);
        expect(env.SUPERCELL_TOKEN).toBe('sc-override');
        expect(env.TELEGRAM_TOKEN).toBe('tg-1');
    });

    it('throws ConfigError when config file does not exist', () => {
        const dir = createTempDir();
        expect(() => {
            loadConfig(path.join(dir, 'missing.json'), {
                env: { SUPERCELL_TOKEN: 'a', TELEGRAM_TOKEN: 'b' },
            });
        }).toThrow(ConfigError);
    });

    it('throws ConfigError when config.json contains invalid JSON', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, '{ invalid json', 'utf8');

        expect(() => {
            loadConfig(configPath, {
                env: { SUPERCELL_TOKEN: 'a', TELEGRAM_TOKEN: 'b' },
            });
        }).toThrow(ConfigError);
    });

    it('throws ConfigError when required secrets are missing or empty', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({}), 'utf8');

        expect(() => {
            loadConfig(configPath, { env: { TELEGRAM_TOKEN: 'tg' } });
        }).toThrow(ConfigError);

        expect(() => {
            loadConfig(configPath, { env: { SUPERCELL_TOKEN: 'sc', TELEGRAM_TOKEN: '' } });
        }).toThrow(ConfigError);
    });

    it('throws ConfigError when use_tunnel is true and tunnel_base_url is empty', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(
            configPath,
            JSON.stringify({
                api: {
                    use_tunnel: true,
                    tunnel_base_url: '',
                },
            }),
            'utf8',
        );

        expect(() => {
            loadConfig(configPath, {
                env: { SUPERCELL_TOKEN: 'sc', TELEGRAM_TOKEN: 'tg' },
            });
        }).toThrow(ConfigError);
    });

    it('allows empty tunnel_base_url when use_tunnel is false (C++ parity)', () => {
        const dir = createTempDir();
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(
            configPath,
            JSON.stringify({
                api: {
                    use_tunnel: false,
                    tunnel_base_url: '',
                },
            }),
            'utf8',
        );

        const config = loadConfig(configPath, {
            env: { SUPERCELL_TOKEN: 'sc', TELEGRAM_TOKEN: 'tg' },
        });
        expect(config.useTunnel).toBe(false);
        expect(config.tunnelBaseUrl).toBe('');
    });

    it('throws ConfigError when required config fields are empty or have invalid types', () => {
        const dir = createTempDir();
        const emptyBaseUrlPath = path.join(dir, 'empty-base-url.json');
        fs.writeFileSync(emptyBaseUrlPath, JSON.stringify({ api: { base_url: '' } }), 'utf8');

        expect(() => {
            loadConfig(emptyBaseUrlPath, {
                env: { SUPERCELL_TOKEN: 'sc', TELEGRAM_TOKEN: 'tg' },
            });
        }).toThrow(ConfigError);

        const badTypePath = path.join(dir, 'bad-type.json');
        fs.writeFileSync(badTypePath, JSON.stringify({ api: { use_tunnel: 'yes' } }), 'utf8');

        expect(() => {
            loadConfig(badTypePath, {
                env: { SUPERCELL_TOKEN: 'sc', TELEGRAM_TOKEN: 'tg' },
            });
        }).toThrow(ConfigError);
    });
});
