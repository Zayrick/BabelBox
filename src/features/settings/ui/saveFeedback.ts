import {browser} from 'wxt/browser';
import {ElMessage} from 'element-plus';
import {requestConfigSave} from '@/src/services/config/store';

export function notifyConfigSaveFailed(error: unknown): void {
    console.warn('[BabelBox] 保存设置失败', error);
    ElMessage.error(`保存设置失败：${error instanceof Error ? error.message : '请稍后重试'}`);
}

export async function saveSettingsConfig(value: unknown): Promise<void> {
    await requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime));
}
