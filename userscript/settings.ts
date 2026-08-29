import SettingsPanel from './SettingsPanel.vue';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';
import type {ShadowRootContentScriptUi} from 'wxt/utils/content-script-ui/shadow-root';

let settingsUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;

export async function openUserscriptSettings(ctx: unknown): Promise<void> {
    if (settingsUi) return;
    let ui: ShadowRootContentScriptUi<VueShadowMount> | null = null;
    const close = () => {
        ui?.remove();
        if (settingsUi === ui) settingsUi = null;
    };
    ui = await createVueShadowUi(ctx as never, {
        name: 'babelbox-userscript-settings-ui',
        hostId: 'babelbox-userscript-settings-container',
        component: SettingsPanel,
        props: {onClose: close},
        zIndex: 2_147_483_647,
        mode: 'closed',
    });
    settingsUi = ui;
}

export function closeUserscriptSettings(): void {
    settingsUi?.remove();
    settingsUi = null;
}
