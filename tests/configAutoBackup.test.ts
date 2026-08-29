import {describe, expect, it, vi} from 'vitest';
import {
    CONFIG_AUTO_BACKUP_LIMIT,
    appendConfigAutoBackup,
    createBaselineConfigAutoBackups,
} from '@/src/services/config/autoBackup';
import {
    CONFIG_AUTO_BACKUP_ALARM,
    CONFIG_AUTO_BACKUP_INTERVAL_MINUTES,
    CONFIG_AUTO_BACKUP_INTERVAL_MS,
    installConfigAutoBackupRuntime,
} from '@/src/app/background/configAutoBackupRuntime';

const baseConfig = {
    on: true,
    service: 'freeTranslation',
    display: 1,
    from: 'auto',
    to: 'zh-Hans',
};

describe('配置定时备份', () => {
    it('只保留最近十份可恢复配置', () => {
        let state = createBaselineConfigAutoBackups({
            ...baseConfig,
            count: 9,
            token: {freeTranslation: 'secret'},
        }, 'baseline');
        const baseline = state.entries[0].config as Record<string, unknown>;
        expect(['count', 'token'].some((field) => field in baseline)).toBe(false);

        for (let index = 0; index < 11; index += 1) {
            state = appendConfigAutoBackup(state, {...baseConfig, to: `lang-${index}`}, `time-${index}`);
        }

        expect(state.entries).toHaveLength(CONFIG_AUTO_BACKUP_LIMIT);
        expect(state.entries.at(-1)).toMatchObject({version: 12, config: {to: 'lang-10'}});
    });

    it('每六小时通过持久 alarm 捕获一次', async () => {
        let now = Date.parse('2026-08-28T00:00:00.000Z');
        let state = createBaselineConfigAutoBackups(baseConfig, new Date(now).toISOString());
        let onAlarm: ((alarm: {name: string}) => void) | undefined;
        const capture = vi.fn(async ({savedAt}: {savedAt: string}) => {
            state = appendConfigAutoBackup(state, baseConfig, savedAt);
            return state;
        });
        const create = vi.fn();

        const runtimeReady = installConfigAutoBackupRuntime({
            alarms: {
                onAlarm: {addListener: (listener) => { onAlarm = listener; }},
                get: vi.fn(async () => undefined),
                create,
            },
            ready: Promise.resolve(),
            getSnapshot: () => state,
            capture,
            now: () => now,
            warn: vi.fn(),
        });
        await runtimeReady;

        expect(capture).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith(CONFIG_AUTO_BACKUP_ALARM, {
            delayInMinutes: CONFIG_AUTO_BACKUP_INTERVAL_MINUTES,
            periodInMinutes: CONFIG_AUTO_BACKUP_INTERVAL_MINUTES,
        });

        now += CONFIG_AUTO_BACKUP_INTERVAL_MS;
        onAlarm?.({name: CONFIG_AUTO_BACKUP_ALARM});
        await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
    });
});
