import {browser} from 'wxt/browser';
import {ElMessage, type MessageHandler} from 'element-plus';
import {requestConfigSave} from '@/src/services/config/store';

const SAVED_MESSAGE_DURATION_MS = 1500;

let savedMessage: MessageHandler | null = null;
let savedMessageTimer: ReturnType<typeof setTimeout> | undefined;

// 连续输入会逐字保存；复用同一条提示并在最后一次保存后计时关闭，避免提示堆叠。
function notifyConfigSaved(): void {
    savedMessage ??= ElMessage({
        message: '设置已保存',
        type: 'success',
        duration: 0,
        onClose: () => {
            savedMessage = null;
        },
    });
    clearTimeout(savedMessageTimer);
    savedMessageTimer = setTimeout(() => savedMessage?.close(), SAVED_MESSAGE_DURATION_MS);
}

export function notifyConfigSaveFailed(error: unknown): void {
    console.warn('[BabelBox] 保存设置失败', error);
    ElMessage.error(`保存设置失败：${error instanceof Error ? error.message : '请稍后重试'}`);
}

/** 设置页的所有保存都经过这里，确保实际写入后给出提示。 */
export async function saveSettingsConfig(value: unknown): Promise<void> {
    if (await requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime))) {
        notifyConfigSaved();
    }
}
