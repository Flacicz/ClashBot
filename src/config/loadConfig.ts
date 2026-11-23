import fs from 'node:fs';
import path from 'node:path';

import { ConfigError } from '../common/errors.js';
import { type AppConfig, envSecretsSchema, jsonConfigSchema } from './configSchema.js';

export const DEFAULT_CONFIG_PATH = 'config.json';

export interface LoadConfigOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly loadDotEnvFile?: boolean;
}

export interface LoadConfigFromArgsOptions extends LoadConfigOptions {
    readonly defaultPath?: string;
}

export function resolveConfigPath(
    argv: readonly string[] = process.argv.slice(2),
    defaultPath: string = DEFAULT_CONFIG_PATH,
): string {
    const firstArg = argv[0];
    if (firstArg !== undefined && firstArg.length > 0) {
        return firstArg;
    }
    return defaultPath;
}

export function parseDotEnv(content: string): [string, string][] {
    const entries: [string, string][] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i] ?? '';
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        const lineNumber = i + 1;

        if (line.length === 0 || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            throw new ConfigError(`Malformed .env line ${String(lineNumber)}`, {
                context: { lineNumber },
            });
        }

        const key = line.slice(0, separatorIndex);
        const value = line.slice(separatorIndex + 1);
        entries.push([key, value]);
    }

    return entries;
}

export function loadDotEnv(envPath: string, targetEnv: NodeJS.ProcessEnv = process.env): void {
    let content: string;
    try {
        content = fs.readFileSync(envPath, 'utf8');
    } catch (error: unknown) {
        throw new ConfigError(`Failed to read .env file: ${envPath}`, {
            cause: error,
            context: { envPath },
        });
    }

    const entries = parseDotEnv(content);
    for (const [key, value] of entries) {
        if (!Object.prototype.hasOwnProperty.call(targetEnv, key) || targetEnv[key] === undefined) {
            targetEnv[key] = value;
        }
    }
}

export function loadConfig(configPath: string, options?: LoadConfigOptions): AppConfig {
    const env = options?.env ?? process.env;
    const shouldLoadDotEnv = options?.loadDotEnvFile ?? true;

    const resolvedConfigPath = path.resolve(configPath);
    if (shouldLoadDotEnv) {
        const dotEnvPath = path.join(path.dirname(resolvedConfigPath), '.env');
        if (fs.existsSync(dotEnvPath)) {
            loadDotEnv(dotEnvPath, env);
        }
    }

    let rawJson: string;
    try {
        rawJson = fs.readFileSync(resolvedConfigPath, 'utf8');
    } catch (error: unknown) {
        throw new ConfigError(`Failed to read config file: ${configPath}`, {
            cause: error,
            context: { configPath: resolvedConfigPath },
        });
    }

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(rawJson);
    } catch (error: unknown) {
        throw new ConfigError(`Invalid JSON in config file: ${configPath}`, {
            cause: error,
            context: { configPath: resolvedConfigPath },
        });
    }

    const jsonResult = jsonConfigSchema.safeParse(parsedJson);
    if (!jsonResult.success) {
        const details = jsonResult.error.issues
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; ');
        throw new ConfigError(`Invalid configuration in ${configPath}: ${details}`, {
            cause: jsonResult.error,
            context: { configPath: resolvedConfigPath },
        });
    }

    const envResult = envSecretsSchema.safeParse({
        SUPERCELL_TOKEN: env.SUPERCELL_TOKEN,
        TELEGRAM_TOKEN: env.TELEGRAM_TOKEN,
    });
    if (!envResult.success) {
        const details = envResult.error.issues
            .map((issue) => `${issue.path.join('.') || '<env>'}: ${issue.message}`)
            .join('; ');
        throw new ConfigError(`Invalid environment secrets: ${details}`, {
            cause: envResult.error,
        });
    }

    return {
        useTunnel: jsonResult.data.api.use_tunnel,
        tunnelBaseUrl: jsonResult.data.api.tunnel_base_url,
        baseUrl: jsonResult.data.api.base_url,
        databasePath: jsonResult.data.database.path,
        migrationPath: jsonResult.data.database.migrations_path,
        attackGuidesPath: jsonResult.data.telegram.attack_guides_path,
        supercellToken: envResult.data.SUPERCELL_TOKEN,
        telegramToken: envResult.data.TELEGRAM_TOKEN,
    };
}

export function loadConfigFromArgs(
    argv: readonly string[] = process.argv.slice(2),
    options?: LoadConfigFromArgsOptions,
): AppConfig {
    const configPath = resolveConfigPath(argv, options?.defaultPath);
    return loadConfig(configPath, options);
}
