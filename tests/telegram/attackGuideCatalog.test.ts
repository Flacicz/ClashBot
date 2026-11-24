import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError } from '../../src/common/errors.js';
import {
    AttackGuideCatalog,
    loadAttackGuideCatalog,
} from '../../src/telegram/attackGuideCatalog.js';

const tempDirs: string[] = [];

function createTempJsonFile(content: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clashbot-guides-test-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'attack_guides.json');
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(filePath, text, 'utf8');
    return filePath;
}

function makeGuideJson(
    id: string,
    armyId: string,
    armyTitle: string,
    townHalls: number[],
    sortOrder: number,
    enabled: boolean,
): Record<string, unknown> {
    return {
        id,
        army_id: armyId,
        army_title: armyTitle,
        variant_id: 'classic',
        variant_title: 'Классический вариант',
        title: `Видео ${id}`,
        town_halls: townHalls,
        youtube_url: `https://example.com/${id}`,
        sort_order: sortOrder,
        enabled,
    };
}

function makeCatalogJson(): { version: number; guides: Record<string, unknown>[] } {
    return {
        version: 1,
        guides: [
            makeGuideJson('disabled', 'disabled_army', 'Отключенная стратегия', [7], 5, false),
            makeGuideJson('shared_early', 'shared_army', 'Общая стратегия — ранняя', [8], 10, true),
            makeGuideJson('global', 'global_army', 'Глобальная стратегия', [], 20, true),
            makeGuideJson(
                'shared_late',
                'shared_army',
                'Общая стратегия — поздняя',
                [7, 8],
                30,
                true,
            ),
            makeGuideJson('other', 'other_army', 'Другая стратегия', [8], 40, true),
            makeGuideJson(
                'same_order_first',
                'same_order_first_army',
                'Первая стратегия',
                [7],
                50,
                true,
            ),
            makeGuideJson(
                'same_order_second',
                'same_order_second_army',
                'Вторая стратегия',
                [7],
                50,
                true,
            ),
        ],
    };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir !== undefined) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('AttackGuideCatalog', () => {
    it('throws ConfigError for nonexistent file path', () => {
        const missingPath = path.join(os.tmpdir(), 'nonexistent-clashbot-guides-file.json');

        expect(() => loadAttackGuideCatalog(missingPath)).toThrow(ConfigError);
    });

    it('loads guide fields and sorts stably by sort_order', () => {
        const catalogJson = makeCatalogJson();
        const [g0, g1, g2, g3, g4, g5, g6] = catalogJson.guides;
        if (
            g0 === undefined ||
            g1 === undefined ||
            g2 === undefined ||
            g3 === undefined ||
            g4 === undefined ||
            g5 === undefined ||
            g6 === undefined
        ) {
            throw new Error('Expected 7 guides in fixture');
        }
        // Shuffle input order to verify sorting
        catalogJson.guides = [g4, g5, g1, g6, g0, g3, g2];
        const filePath = createTempJsonFile(catalogJson);
        const catalog = AttackGuideCatalog.fromFile(filePath);

        const guides = catalog.getAll();

        expect(guides.map((g) => g.id)).toEqual([
            'disabled',
            'shared_early',
            'global',
            'shared_late',
            'other',
            'same_order_first',
            'same_order_second',
        ]);

        const guide = guides[1];
        expect(guide).toEqual({
            id: 'shared_early',
            armyId: 'shared_army',
            armyTitle: 'Общая стратегия — ранняя',
            variantId: 'classic',
            variantTitle: 'Классический вариант',
            title: 'Видео shared_early',
            townHalls: [8],
            youtubeUrl: 'https://example.com/shared_early',
            sortOrder: 10,
            enabled: true,
        });
    });

    it('keeps stable order for equal sort_order values', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);
        const guides = catalog.getAll();

        expect(guides[5]?.sortOrder).toBe(50);
        expect(guides[6]?.sortOrder).toBe(50);
        expect(guides[5]?.id).toBe('same_order_first');
        expect(guides[6]?.id).toBe('same_order_second');
    });

    it('uses defaults for optional guide fields (army_title, sort_order, enabled)', () => {
        const filePath = createTempJsonFile({
            guides: [
                {
                    id: 'minimal',
                    army_id: 'minimal_army',
                    variant_id: 'classic',
                    variant_title: 'Классический вариант',
                    title: 'Минимальный гайд',
                    town_halls: [],
                    youtube_url: 'https://example.com/minimal',
                },
            ],
        });

        const catalog = loadAttackGuideCatalog(filePath);
        const guide = catalog.getAll()[0];

        expect(guide?.armyTitle).toBe('minimal_army');
        expect(guide?.sortOrder).toBe(0);
        expect(guide?.enabled).toBe(true);
    });

    it('handles empty guides array', () => {
        const filePath = createTempJsonFile({ guides: [] });
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getAll()).toEqual([]);
        expect(catalog.getStrategiesForTownHall(10)).toEqual([]);
        expect(catalog.getGuidesForStrategy(10, 'any_army')).toEqual([]);
        expect(catalog.findById('any_guide')).toBeNull();
    });

    it('throws ConfigError when guides field is missing, not an array, or JSON is invalid', () => {
        const missingGuides = createTempJsonFile({ version: 1 });
        expect(() => loadAttackGuideCatalog(missingGuides)).toThrow(ConfigError);

        const nonArrayGuides = createTempJsonFile({ guides: {} });
        expect(() => loadAttackGuideCatalog(nonArrayGuides)).toThrow(ConfigError);

        const invalidJson = createTempJsonFile('{"guides":[');
        expect(() => loadAttackGuideCatalog(invalidJson)).toThrow(ConfigError);
    });

    it('throws ConfigError when any required guide field is missing', () => {
        const requiredFields = [
            'id',
            'army_id',
            'variant_id',
            'variant_title',
            'title',
            'town_halls',
            'youtube_url',
        ] as const;

        for (const field of requiredFields) {
            const json = makeCatalogJson();
            const firstGuide = json.guides[0];
            if (firstGuide === undefined) {
                throw new Error('Expected guide fixture');
            }
            json.guides[0] = Object.fromEntries(
                Object.entries(firstGuide).filter(([key]) => key !== field),
            );
            const filePath = createTempJsonFile(json);

            expect(() => loadAttackGuideCatalog(filePath), `Missing field: ${field}`).toThrow(
                ConfigError,
            );
        }
    });

    it('throws ConfigError when any required guide field has wrong type', () => {
        const requiredFields = [
            'id',
            'army_id',
            'variant_id',
            'variant_title',
            'title',
            'town_halls',
            'youtube_url',
        ] as const;

        for (const field of requiredFields) {
            const json = makeCatalogJson();
            const firstGuide = json.guides[0];
            if (firstGuide === undefined) {
                throw new Error('Expected guide fixture');
            }
            firstGuide[field] = field === 'town_halls' ? 'not-an-array' : 123;
            const filePath = createTempJsonFile(json);

            expect(() => loadAttackGuideCatalog(filePath), `Wrong type: ${field}`).toThrow(
                ConfigError,
            );
        }
    });

    it('throws ConfigError when any optional guide field has wrong type', () => {
        const optionalFields = ['army_title', 'sort_order', 'enabled'] as const;

        for (const field of optionalFields) {
            const json = makeCatalogJson();
            const firstGuide = json.guides[0];
            if (firstGuide === undefined) {
                throw new Error('Expected guide fixture');
            }
            firstGuide[field] = field === 'army_title' ? 123 : 'invalid';
            const filePath = createTempJsonFile(json);

            expect(() => loadAttackGuideCatalog(filePath), `Wrong optional type: ${field}`).toThrow(
                ConfigError,
            );
        }
    });

    it('returns unique strategies available for a town hall preserving first title and sort order', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getStrategiesForTownHall(8)).toEqual([
            { id: 'shared_army', title: 'Общая стратегия — ранняя' },
            { id: 'global_army', title: 'Глобальная стратегия' },
            { id: 'other_army', title: 'Другая стратегия' },
        ]);
    });

    it('excludes disabled and unavailable strategies', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getStrategiesForTownHall(7).map((s) => s.id)).toEqual([
            'global_army',
            'shared_army',
            'same_order_first_army',
            'same_order_second_army',
        ]);
    });

    it('returns empty strategies when no guide matches town hall', () => {
        const json = makeCatalogJson();
        json.guides.splice(2, 1); // remove global guide
        const filePath = createTempJsonFile(json);
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getStrategiesForTownHall(99)).toEqual([]);
    });

    it('returns enabled guides for strategy and town hall', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        const guides = catalog.getGuidesForStrategy(8, 'shared_army');
        expect(guides.map((g) => g.id)).toEqual(['shared_early', 'shared_late']);
    });

    it('supports global guides (empty town_halls) and excludes other town halls or unknown strategies', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        const globalGuides = catalog.getGuidesForStrategy(99, 'global_army');
        expect(globalGuides.map((g) => g.id)).toEqual(['global']);
        expect(catalog.getGuidesForStrategy(7, 'other_army')).toEqual([]);
        expect(catalog.getGuidesForStrategy(8, 'unknown_army')).toEqual([]);
    });

    it('finds enabled guide by id and ignores disabled, unknown, or incompatible town hall guides', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        const found = catalog.findById('shared_early');
        expect(found?.id).toBe('shared_early');
        expect(found?.armyId).toBe('shared_army');
        expect(found?.title).toBe('Видео shared_early');
        expect(found?.townHalls).toEqual([8]);

        expect(catalog.findById('shared_early', 8)?.id).toBe('shared_early');
        expect(catalog.findById('shared_early', 7)).toBeNull();
        expect(catalog.findById('global', 14)?.id).toBe('global');

        expect(catalog.findById('disabled')).toBeNull();
        expect(catalog.findById('disabled', 7)).toBeNull();
        expect(catalog.findById('unknown')).toBeNull();
        expect(catalog.findById('unknown', 8)).toBeNull();
    });

    describe('semantic validation', () => {
        it('rejects empty, whitespace-only, or colon-containing id and army_id', () => {
            const invalidCases: {
                readonly label: string;
                readonly id: string;
                readonly armyId: string;
            }[] = [
                { label: 'empty id', id: '', armyId: 'valid_army' },
                { label: 'whitespace id', id: '   ', armyId: 'valid_army' },
                { label: 'colon in id', id: 'th14:zap', armyId: 'valid_army' },
                { label: 'empty army_id', id: 'valid_id', armyId: '' },
                { label: 'whitespace army_id', id: 'valid_id', armyId: '   ' },
                { label: 'colon in army_id', id: 'valid_id', armyId: 'zap:dragons' },
            ];

            for (const testCase of invalidCases) {
                expect(
                    () =>
                        AttackGuideCatalog.fromJson({
                            guides: [
                                makeGuideJson(
                                    testCase.id,
                                    testCase.armyId,
                                    'Strategy',
                                    [14],
                                    10,
                                    true,
                                ),
                            ],
                        }),
                    testCase.label,
                ).toThrow(ConfigError);
            }
        });

        it('rejects duplicate guide ids including disabled entries', () => {
            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [
                        makeGuideJson('dup_id', 'army_a', 'Army A', [14], 10, true),
                        makeGuideJson('dup_id', 'army_b', 'Army B', [15], 20, false),
                    ],
                }),
            ).toThrow(ConfigError);
        });

        it('rejects invalid or non-http(s) youtube_url values and accepts valid http(s) URLs', () => {
            const invalidUrls = [
                '',
                '   ',
                'not-a-url',
                'javascript:alert(1)',
                'ftp://example.com/guide',
                ' https://www.youtube.com/watch?v=abc ',
            ];

            for (const url of invalidUrls) {
                const guide = makeGuideJson('valid_id', 'valid_army', 'Strategy', [14], 10, true);
                guide.youtube_url = url;
                expect(
                    () => AttackGuideCatalog.fromJson({ guides: [guide] }),
                    `Invalid URL: ${url}`,
                ).toThrow(ConfigError);
            }

            const validGuide = makeGuideJson('valid_id', 'valid_army', 'Strategy', [14], 10, true);
            validGuide.youtube_url = 'https://www.youtube.com/watch?v=abc&t=42';
            const catalog = AttackGuideCatalog.fromJson({ guides: [validGuide] });
            expect(catalog.findById('valid_id', 14)?.youtubeUrl).toBe(
                'https://www.youtube.com/watch?v=abc&t=42',
            );
        });

        it('rejects town_halls outside TH7-TH18 and accepts boundary values and empty array', () => {
            const invalidTownHalls = [[6], [19], [0], [-7], [7, 19]];
            for (const townHalls of invalidTownHalls) {
                expect(
                    () =>
                        AttackGuideCatalog.fromJson({
                            guides: [
                                makeGuideJson(
                                    'valid_id',
                                    'valid_army',
                                    'Strategy',
                                    townHalls,
                                    10,
                                    true,
                                ),
                            ],
                        }),
                    `Invalid town_halls: ${JSON.stringify(townHalls)}`,
                ).toThrow(ConfigError);
            }

            const validCatalog = AttackGuideCatalog.fromJson({
                guides: [
                    makeGuideJson('th7_id', 'army_a', 'Army A', [7], 10, true),
                    makeGuideJson('th18_id', 'army_b', 'Army B', [18], 20, true),
                    makeGuideJson('universal_id', 'army_c', 'Army C', [], 30, true),
                ],
            });
            expect(validCatalog.getAll()).toHaveLength(3);
        });

        it('enforces Telegram 64-byte UTF-8 limit on guide and strategy callback_data', () => {
            // "guides:guide:14:" is 16 bytes -> 48 ASCII bytes id = 64 bytes (valid), 49 bytes = 65 bytes (invalid)
            const exactGuideId = 'g'.repeat(48);
            const tooLongGuideId = 'g'.repeat(49);
            // 25 Cyrillic chars = 50 UTF-8 bytes -> 16 + 50 = 66 bytes (> 64) despite string length 41
            const multibyteTooLongGuideId = 'г'.repeat(25);

            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [makeGuideJson(exactGuideId, 'army', 'Army', [14], 10, true)],
                }),
            ).not.toThrow();

            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [makeGuideJson(tooLongGuideId, 'army', 'Army', [14], 10, true)],
                }),
            ).toThrow(ConfigError);

            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [
                        makeGuideJson(multibyteTooLongGuideId, 'army', 'Army', [14], 10, true),
                    ],
                }),
            ).toThrow(ConfigError);

            // Universal guide (empty town_halls) must fit for 2-digit MAX_TOWN_HALL (18)
            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [makeGuideJson(tooLongGuideId, 'army', 'Army', [], 10, true)],
                }),
            ).toThrow(ConfigError);

            // "guides:strategy:14:" is 19 bytes -> 45 ASCII bytes army_id = 64 bytes (valid), 46 bytes = 65 bytes (invalid)
            const exactArmyId = 'a'.repeat(45);
            const tooLongArmyId = 'a'.repeat(46);
            const multibyteTooLongArmyId = 'а'.repeat(23); // 46 UTF-8 bytes -> 19 + 46 = 65 bytes

            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [makeGuideJson('guide_ok', exactArmyId, 'Army', [14], 10, true)],
                }),
            ).not.toThrow();

            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [makeGuideJson('guide_ok', tooLongArmyId, 'Army', [14], 10, true)],
                }),
            ).toThrow(ConfigError);

            expect(() =>
                AttackGuideCatalog.fromJson({
                    guides: [
                        makeGuideJson('guide_ok', multibyteTooLongArmyId, 'Army', [14], 10, true),
                    ],
                }),
            ).toThrow(ConfigError);
        });
    });

    it('is idempotent across repeated loads and queries', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const first = loadAttackGuideCatalog(filePath);
        const second = loadAttackGuideCatalog(filePath);

        expect(second.getAll()).toEqual(first.getAll());
        expect(second.getStrategiesForTownHall(8)).toEqual(first.getStrategiesForTownHall(8));
        expect(second.getGuidesForStrategy(8, 'shared_army')).toEqual(
            first.getGuidesForStrategy(8, 'shared_army'),
        );
    });

    it('loads the real repository resources/telegram/attack_guides.json with TH7-TH18 coverage', () => {
        const repoGuidesPath = path.resolve(
            import.meta.dirname,
            '../../resources/telegram/attack_guides.json',
        );
        const catalog = loadAttackGuideCatalog(repoGuidesPath);

        expect(catalog.getAll().length).toBeGreaterThan(0);

        for (let th = 7; th <= 18; th += 1) {
            const strategies = catalog.getStrategiesForTownHall(th);
            expect(strategies.length, `Expected strategies for TH${String(th)}`).toBeGreaterThan(0);
        }
    });
});
