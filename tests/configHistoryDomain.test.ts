import {describe, expect, it} from 'vitest';

import {
    CONFIG_HISTORY_LIMIT,
    appendConfigHistorySnapshot,
    cloneConfigHistory,
    createBaselineConfigHistory,
    parseConfigHistory,
    resolveConfigHistoryTargetIndex,
    serializeConfigHistory,
    toPublicConfig,
    type ConfigHistoryState,
} from '@/src/services/config/history';
import {
    CONFIG_REVISION_FIELD,
    getStoredConfigRevision,
    isConfigRecord,
    parseStoredConfig,
    serializeConfig,
} from '@/src/services/config/schema';

const baseConfig = {
    on: true,
    service: 'freeTranslation',
    from: 'auto',
    to: 'zh-Hans',
};

function entry(version: number, to = 'zh-Hans') {
    return {
        version,
        savedAt: `2026-08-25T00:00:0${version}.000Z`,
        config: toPublicConfig({...baseConfig, to}),
    };
}

function history(overrides: Partial<ConfigHistoryState> = {}): ConfigHistoryState {
    return {
        schemaVersion: 1,
        entries: [entry(1), entry(2, 'en')],
        cursor: 1,
        nextVersion: 3,
        ...overrides,
    };
}

describe('配置 schema 与历史纯状态机', () => {
    it('存储 schema 只接受完整对象或合法旧 JSON，并规范化 revision', () => {
        expect(isConfigRecord({})).toBe(true);
        expect(isConfigRecord(null)).toBe(false);
        expect(isConfigRecord([])).toBe(false);
        expect(getStoredConfigRevision(null)).toBe(0);
        expect(getStoredConfigRevision({[CONFIG_REVISION_FIELD]: 7})).toBe(7);
        expect(getStoredConfigRevision({[CONFIG_REVISION_FIELD]: -1})).toBe(0);
        expect(getStoredConfigRevision({[CONFIG_REVISION_FIELD]: 1.5})).toBe(0);
        expect(parseStoredConfig('')).toBeNull();
        expect(parseStoredConfig('{bad-json')).toBeNull();
        expect(parseStoredConfig('[]')).toBeNull();
        expect(parseStoredConfig({on: true})).toBeNull();
        expect(parseStoredConfig(JSON.stringify(baseConfig))).toEqual(baseConfig);
        expect(parseStoredConfig(baseConfig)).toBe(baseConfig);
        expect(serializeConfig({on: true})).toBe('{"on":true}');
    });

    it('公开快照与克隆始终移除凭据且不共享可变引用', () => {
        const publicConfig = toPublicConfig({...baseConfig, token: {openai: 'secret'}});
        expect((publicConfig as Record<string, unknown>).token).toBeUndefined();

        const source = history({
            entries: [{...entry(1), config: {...baseConfig, token: {openai: 'secret'}} as never}],
            cursor: 0,
            nextVersion: 2,
        });
        const cloned = cloneConfigHistory(source);
        expect(cloned).not.toBe(source);
        expect(cloned.entries[0]).not.toBe(source.entries[0]);
        expect((cloned.entries[0]?.config as Record<string, unknown>).token).toBeUndefined();
        expect(serializeConfigHistory(cloned)).toBe(JSON.stringify(cloned));
    });

    it('基线版本尊重持久化 revision，并支持显式或默认保存时间', () => {
        const fixed = createBaselineConfigHistory(baseConfig, 4, 'fixed-time');
        expect(fixed).toMatchObject({
            entries: [{version: 4, savedAt: 'fixed-time'}],
            cursor: 0,
            nextVersion: 5,
        });
        const fallback = createBaselineConfigHistory(baseConfig, 0);
        expect(fallback.entries[0]?.version).toBe(1);
        expect(fallback.entries[0]?.savedAt).toEqual(expect.any(String));
    });

    it('历史解析过滤损坏条目、限制十条，并修正游标与 nextVersion', () => {
        expect(parseConfigHistory(null)).toBeNull();
        expect(parseConfigHistory({entries: 'bad'})).toBeNull();
        expect(parseConfigHistory({schemaVersion: 2, entries: [entry(1)]})).toBeNull();
        expect(parseConfigHistory({entries: [null, {version: '1', savedAt: 'x', config: baseConfig}]})).toBeNull();
        expect(parseConfigHistory({entries: [{version: -1, savedAt: 'x', config: baseConfig}]})).toBeNull();
        expect(parseConfigHistory({entries: [{version: 1.5, savedAt: 'x', config: baseConfig}]})).toBeNull();
        expect(parseConfigHistory({entries: [{version: 1, savedAt: 123, config: baseConfig}]})).toBeNull();
        expect(parseConfigHistory({entries: [{version: 1, savedAt: 'x', config: {on: true}}]})).toBeNull();

        const parsed = parseConfigHistory({
            entries: Array.from({length: 12}, (_, index) => entry(index + 1, `lang-${index}`)),
            cursor: -5,
            nextVersion: 2,
        });
        expect(parsed?.entries).toHaveLength(CONFIG_HISTORY_LIMIT);
        expect(parsed?.entries[0]?.version).toBe(3);
        expect(parsed?.cursor).toBe(0);
        expect(parsed?.nextVersion).toBe(13);

        const defaults = parseConfigHistory({entries: [entry(9)]});
        expect(defaults).toMatchObject({cursor: 0, nextVersion: 10});
        const upperBound = parseConfigHistory({entries: [entry(1)], cursor: 99, nextVersion: 20});
        expect(upperBound).toMatchObject({cursor: 0, nextVersion: 20});

        const retainedCursor = parseConfigHistory({
            entries: Array.from({length: 12}, (_, index) => entry(index + 1)),
            cursor: 3,
            nextVersion: -2,
        });
        expect(retainedCursor).toMatchObject({cursor: 1, nextVersion: 13});

        const cursorAfterCorruptEntry = parseConfigHistory({
            entries: [entry(1), {version: 'bad'}, entry(2), entry(3)],
            cursor: 1,
        });
        expect(cursorAfterCorruptEntry).toMatchObject({cursor: 0, nextVersion: 4});
    });

    it('追加会去重、丢弃 redo 分支、限制容量并递增唯一版本', () => {
        const current = history();
        expect(appendConfigHistorySnapshot(current, {...baseConfig, to: 'en'}, 'same')).toBeNull();

        const branched = appendConfigHistorySnapshot(
            history({cursor: 0}),
            {...baseConfig, to: 'ja'},
            'branch-time',
        );
        expect(branched?.entries.map((item) => item.config.to)).toEqual(['zh-Hans', 'ja']);
        expect(branched).toMatchObject({cursor: 1, nextVersion: 4});
        expect(branched?.entries[1]).toMatchObject({version: 3, savedAt: 'branch-time'});

        let bounded = createBaselineConfigHistory(baseConfig, 1, 'baseline');
        for (let index = 0; index < 12; index += 1) {
            bounded = appendConfigHistorySnapshot(
                bounded,
                {...baseConfig, to: `target-${index}`},
                `time-${index}`,
            )!;
        }
        expect(bounded.entries).toHaveLength(CONFIG_HISTORY_LIMIT);
        expect(bounded.entries.at(-1)?.config.to).toBe('target-11');
    });

    it('撤销、重做和版本恢复在边界处保持稳定游标', () => {
        const state = history();
        expect(resolveConfigHistoryTargetIndex(state, 'undo')).toBe(0);
        expect(resolveConfigHistoryTargetIndex({...state, cursor: 0}, 'undo')).toBe(0);
        expect(resolveConfigHistoryTargetIndex({...state, cursor: 0}, 'redo')).toBe(1);
        expect(resolveConfigHistoryTargetIndex(state, 'redo')).toBe(1);
        expect(resolveConfigHistoryTargetIndex(state, 'restore')).toBe(1);
        expect(resolveConfigHistoryTargetIndex(state, 'restore', 1)).toBe(0);
        expect(resolveConfigHistoryTargetIndex(state, 'restore', 99)).toBe(1);
    });
});
