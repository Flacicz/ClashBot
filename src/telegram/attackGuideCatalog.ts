import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { ConfigError } from '../common/errors.js';
import {
    buildGuideCallbackData,
    buildStrategyCallbackData,
    MAX_CALLBACK_DATA_BYTES,
} from './callbackData.js';
import { MAX_TOWN_HALL, MIN_TOWN_HALL } from './validation.js';

export interface AttackGuide {
    readonly id: string;
    readonly armyId: string;
    readonly armyTitle: string;
    readonly variantId: string;
    readonly variantTitle: string;
    readonly title: string;
    readonly townHalls: readonly number[];
    readonly youtubeUrl: string;
    readonly sortOrder: number;
    readonly enabled: boolean;
}

export interface AttackStrategy {
    readonly id: string;
    readonly title: string;
}

function isValidHttpUrl(value: string): boolean {
    if (value.length === 0 || value !== value.trim()) {
        return false;
    }

    try {
        const parsed = new URL(value);
        return (
            (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            parsed.hostname.length > 0
        );
    } catch {
        return false;
    }
}

const callbackIdentifierSchema = z
    .string()
    .refine((value) => value.trim().length > 0, {
        message: 'must be a non-empty string',
    })
    .refine((value) => !value.includes(':'), {
        message: 'must not contain ":"',
    });

const rawAttackGuideSchema = z.object({
    id: callbackIdentifierSchema,
    army_id: callbackIdentifierSchema,
    army_title: z.string().optional(),
    variant_id: z.string(),
    variant_title: z.string(),
    title: z.string(),
    town_halls: z.array(z.number().int().min(MIN_TOWN_HALL).max(MAX_TOWN_HALL)),
    youtube_url: z.string().refine(isValidHttpUrl, {
        message: 'must be a valid http(s) URL',
    }),
    sort_order: z.number().int().default(0),
    enabled: z.boolean().default(true),
});

export const attackGuideCatalogSchema = z
    .object({
        guides: z.array(rawAttackGuideSchema),
    })
    .superRefine((catalog, ctx) => {
        const seenIds = new Set<string>();

        for (let index = 0; index < catalog.guides.length; index += 1) {
            const guide = catalog.guides[index];
            if (guide === undefined) {
                continue;
            }

            if (seenIds.has(guide.id)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['guides', index, 'id'],
                    message: `duplicate guide id "${guide.id}"`,
                });
            } else {
                seenIds.add(guide.id);
            }

            const townHallsToCheck =
                guide.town_halls.length > 0 ? guide.town_halls : [MAX_TOWN_HALL];

            for (const townHall of townHallsToCheck) {
                const guideCallbackData = buildGuideCallbackData(townHall, guide.id);
                const guideCallbackBytes = Buffer.byteLength(guideCallbackData, 'utf8');
                if (guideCallbackBytes > MAX_CALLBACK_DATA_BYTES) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['guides', index, 'id'],
                        message: `callback_data "${guideCallbackData}" exceeds ${String(MAX_CALLBACK_DATA_BYTES)} bytes (${String(guideCallbackBytes)} bytes)`,
                    });
                    break;
                }
            }

            for (const townHall of townHallsToCheck) {
                const strategyCallbackData = buildStrategyCallbackData(townHall, guide.army_id);
                const strategyCallbackBytes = Buffer.byteLength(strategyCallbackData, 'utf8');
                if (strategyCallbackBytes > MAX_CALLBACK_DATA_BYTES) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['guides', index, 'army_id'],
                        message: `callback_data "${strategyCallbackData}" exceeds ${String(MAX_CALLBACK_DATA_BYTES)} bytes (${String(strategyCallbackBytes)} bytes)`,
                    });
                    break;
                }
            }
        }
    });

function isAvailableForTownHall(guide: AttackGuide, townHall: number): boolean {
    return guide.townHalls.length === 0 || guide.townHalls.includes(townHall);
}

export class AttackGuideCatalog {
    readonly #guides: readonly AttackGuide[];

    private constructor(guides: readonly AttackGuide[]) {
        this.#guides = guides;
    }

    static fromJson(rawJson: unknown, sourceLabel = '<inline>'): AttackGuideCatalog {
        const result = attackGuideCatalogSchema.safeParse(rawJson);
        if (!result.success) {
            const details = result.error.issues
                .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
                .join('; ');
            throw new ConfigError(`Invalid attack guides catalog in ${sourceLabel}: ${details}`, {
                cause: result.error,
                context: { sourceLabel },
            });
        }

        const guides: AttackGuide[] = result.data.guides.map((item) => ({
            id: item.id,
            armyId: item.army_id,
            armyTitle: item.army_title ?? item.army_id,
            variantId: item.variant_id,
            variantTitle: item.variant_title,
            title: item.title,
            townHalls: [...item.town_halls],
            youtubeUrl: item.youtube_url,
            sortOrder: item.sort_order,
            enabled: item.enabled,
        }));

        // Array.prototype.sort is guaranteed stable since ES2019.
        guides.sort((left, right) => left.sortOrder - right.sortOrder);

        return new AttackGuideCatalog(guides);
    }

    static fromFile(filePath: string): AttackGuideCatalog {
        const resolvedPath = path.resolve(filePath);

        let rawContent: string;
        try {
            rawContent = fs.readFileSync(resolvedPath, 'utf8');
        } catch (error: unknown) {
            throw new ConfigError(`Failed to open attack guides catalog: ${filePath}`, {
                cause: error,
                context: { filePath: resolvedPath },
            });
        }

        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(rawContent);
        } catch (error: unknown) {
            throw new ConfigError(`Invalid JSON in attack guides catalog: ${filePath}`, {
                cause: error,
                context: { filePath: resolvedPath },
            });
        }

        return AttackGuideCatalog.fromJson(parsedJson, filePath);
    }

    getAll(): readonly AttackGuide[] {
        return this.#guides;
    }

    getStrategiesForTownHall(townHall: number): AttackStrategy[] {
        const strategies: AttackStrategy[] = [];
        const seenArmyIds = new Set<string>();

        for (const guide of this.#guides) {
            if (!guide.enabled || !isAvailableForTownHall(guide, townHall)) {
                continue;
            }

            if (!seenArmyIds.has(guide.armyId)) {
                seenArmyIds.add(guide.armyId);
                strategies.push({
                    id: guide.armyId,
                    title: guide.armyTitle,
                });
            }
        }

        return strategies;
    }

    getGuidesForStrategy(townHall: number, armyId: string): AttackGuide[] {
        const guides: AttackGuide[] = [];

        for (const guide of this.#guides) {
            if (
                guide.enabled &&
                guide.armyId === armyId &&
                isAvailableForTownHall(guide, townHall)
            ) {
                guides.push(guide);
            }
        }

        return guides;
    }

    findById(guideId: string, townHall?: number): AttackGuide | null {
        for (const guide of this.#guides) {
            if (
                guide.enabled &&
                guide.id === guideId &&
                (townHall === undefined || isAvailableForTownHall(guide, townHall))
            ) {
                return guide;
            }
        }

        return null;
    }
}

export function loadAttackGuideCatalog(filePath: string): AttackGuideCatalog {
    return AttackGuideCatalog.fromFile(filePath);
}
