import { z } from 'zod';

export const DEFAULT_TUNNEL_BASE_URL = 'https://localhost:8080/v1';
export const DEFAULT_BASE_URL = 'https://api.clashofclans.com/v1/';
export const DEFAULT_DATABASE_PATH = 'data/database.sqlite';
export const DEFAULT_MIGRATION_PATH = 'migrations';
export const DEFAULT_ATTACK_GUIDES_PATH = 'resources/telegram/attack_guides.json';

const apiConfigSchema = z
    .object({
        use_tunnel: z.boolean().default(false),
        tunnel_base_url: z.string().default(DEFAULT_TUNNEL_BASE_URL),
        base_url: z.string().min(1, 'base_url must not be empty').default(DEFAULT_BASE_URL),
    })
    .default({});

const databaseConfigSchema = z
    .object({
        path: z.string().min(1, 'database.path must not be empty').default(DEFAULT_DATABASE_PATH),
        migrations_path: z
            .string()
            .min(1, 'database.migrations_path must not be empty')
            .default(DEFAULT_MIGRATION_PATH),
    })
    .default({});

const telegramConfigSchema = z
    .object({
        attack_guides_path: z
            .string()
            .min(1, 'telegram.attack_guides_path must not be empty')
            .default(DEFAULT_ATTACK_GUIDES_PATH),
    })
    .default({});

export const jsonConfigSchema = z
    .object({
        api: apiConfigSchema,
        database: databaseConfigSchema,
        telegram: telegramConfigSchema,
    })
    .superRefine((data, ctx) => {
        if (data.api.use_tunnel && data.api.tunnel_base_url.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['api', 'tunnel_base_url'],
                message: 'api.tunnel_base_url must not be empty when api.use_tunnel is true',
            });
        }
    });

export const envSecretsSchema = z.object({
    SUPERCELL_TOKEN: z.string().min(1, 'SUPERCELL_TOKEN is required and must not be empty'),
    TELEGRAM_TOKEN: z.string().min(1, 'TELEGRAM_TOKEN is required and must not be empty'),
});

export interface AppConfig {
    readonly useTunnel: boolean;
    readonly tunnelBaseUrl: string;
    readonly baseUrl: string;
    readonly databasePath: string;
    readonly migrationPath: string;
    readonly attackGuidesPath: string;
    readonly supercellToken: string;
    readonly telegramToken: string;
}
