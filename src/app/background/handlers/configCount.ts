import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
} from '@/src/services/config/count';
import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';

export interface ConfigCountIncrementMessage {
    type: typeof CONFIG_COUNT_INCREMENT_MESSAGE;
    delta?: unknown;
}

export type ConfigCountIncrementResponse =
    | {success: true; count: number}
    | {success: false; error: string};

export function createConfigCountIncrementHandler(
    incrementConfigCount: (delta: number) => Promise<number>,
): BackgroundMessageHandler<unknown, ConfigCountIncrementMessage, ConfigCountIncrementResponse> {
    return {
        type: CONFIG_COUNT_INCREMENT_MESSAGE,
        async handle(message) {
            const delta = parseConfigCountIncrement(message.delta);
            if (delta === null) return {success: false, error: '无效的翻译计数增量'};
            return {success: true, count: await incrementConfigCount(delta)};
        },
    };
}
