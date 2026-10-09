import { describe, expect, it } from 'vitest';

import {
    Config,
    DEFAULT_MOUSE_HOVER_TRANSLATION_DELAY,
    DEFAULT_SELECTION_TRANSLATOR_DELAY,
    MOUSE_HOVER_TRANSLATION_DELAY_MAX,
    MOUSE_HOVER_TRANSLATION_DELAY_MIN,
    SELECTION_TRANSLATOR_DELAY_MAX,
    SELECTION_TRANSLATOR_DELAY_MIN,
    normalizeConfig,
} from '@/src/core/config/model';
import {getMimoEndpoint, MIMO_ENDPOINTS, MINIMAX_ENDPOINTS, tongyiTokenPlanUrl, urls} from '@/src/core/config/constants';
import {defaultOption, options, services, servicesType} from '@/src/core/config/catalog';

describe('服务目录', () => {
    it('AI 智能上下文默认关闭，且只对使用提示词的 AI 服务生效', () => {
        expect(new Config().enableAIContext).toBe(false);
        expect(normalizeConfig({}).enableAIContext).toBe(false);
        expect(normalizeConfig({enableAIContext: true}).enableAIContext).toBe(true);
        expect(servicesType.isUseAIContext(services.openai)).toBe(true);
        expect(servicesType.isUseAIContext(services.microsoft)).toBe(false);
        expect(servicesType.isUseAIContext(services.huanYuanTranslation)).toBe(false);
        expect(servicesType.isUseAIContext(services.tongyi, 'qwen-mt-plus')).toBe(false);
    });

    it('使用用户可读的供应商名称，并默认选择微软翻译', () => {
        expect(options.services.find(option => option.value === services.zhipu)?.label).toBe('智谱');
        expect(options.services.find(option => option.value === services.mimo)?.label).toBe('小米 MiMo');
        expect(options.services.every(option => !/[🌟⭐★]/u.test(option.label))).toBe(true);
        expect(defaultOption.service).toBe(services.microsoft);
    });
});

describe('图片翻译配置', () => {
    it('默认关闭，并保留用户主动启用或关闭的状态', () => {
        expect(normalizeConfig({}).disableImageTranslator).toBe(true);
        expect(normalizeConfig({disableImageTranslator: false}).disableImageTranslator).toBe(false);
        expect(normalizeConfig({disableImageTranslator: true}).disableImageTranslator).toBe(true);
    });
});

describe('翻译中心配置', () => {
    it('默认使用服务列表，保存后保留去重后的服务顺序和语言选择', () => {
        expect(new Config().translationCenterServices).toEqual([]);
        expect(normalizeConfig({
            translationCenterServices: ['google', 'microsoft', 'google', ' ', 12],
            translationCenterSourceLanguage: ' en ',
            translationCenterTargetLanguage: ' ja ',
        })).toMatchObject({
            translationCenterServices: ['google', 'microsoft'],
            translationCenterSourceLanguage: 'en',
            translationCenterTargetLanguage: 'ja',
        });
    });

    it('旧配置或非法值安全回退为空服务配置', () => {
        expect(normalizeConfig({
            translationCenterServices: 'google',
            translationCenterSourceLanguage: 12,
            translationCenterTargetLanguage: null,
        })).toMatchObject({
            translationCenterServices: [],
            translationCenterSourceLanguage: '',
            translationCenterTargetLanguage: '',
        });
    });
});

describe('圈选翻译配置', () => {
    it('默认关闭，并保留用户主动启用的状态', () => {
        expect(new Config().selectionAreaEnabled).toBe(false);
        expect(normalizeConfig({}).selectionAreaEnabled).toBe(false);
        expect(normalizeConfig({selectionAreaEnabled: true}).selectionAreaEnabled).toBe(true);
        expect(normalizeConfig({selectionAreaEnabled: 'true'}).selectionAreaEnabled).toBe(false);
    });
});

describe('右键全文翻译配置', () => {
    it('默认开启，并保留用户主动关闭的状态', () => {
        expect(new Config().contextMenuEnabled).toBe(true);
        expect(normalizeConfig({}).contextMenuEnabled).toBe(true);
        expect(normalizeConfig({contextMenuEnabled: false}).contextMenuEnabled).toBe(false);
        expect(normalizeConfig({contextMenuEnabled: 'false'}).contextMenuEnabled).toBe(true);
    });
});

describe('全文翻译范围配置', () => {
    it('默认按阅读进度翻译，并保留立即翻译整页的选择', () => {
        expect(new Config().fullPageTranslationMode).toBe('viewport');
        expect(normalizeConfig({}).fullPageTranslationMode).toBe('viewport');
        expect(normalizeConfig({fullPageTranslationMode: 'all'}).fullPageTranslationMode).toBe('all');
        expect(normalizeConfig({fullPageTranslationMode: 'invalid'}).fullPageTranslationMode).toBe('viewport');
    });
});

describe('全文翻译显示配置', () => {
    it('缺省配置仅显示译文', () => {
        expect(normalizeConfig({}).display).toBe(0);
    });
});

describe('翻译进度面板配置', () => {
    it('默认关闭，并保留用户主动启用的状态', () => {
        expect(new Config().translationProgressPanelEnabled).toBe(false);
        expect(normalizeConfig({}).translationProgressPanelEnabled).toBe(false);
        expect(normalizeConfig({translationProgressPanelEnabled: true}).translationProgressPanelEnabled).toBe(true);
        expect(normalizeConfig({translationProgressPanelEnabled: false}).translationProgressPanelEnabled).toBe(false);
        expect(normalizeConfig({translationProgressPanelEnabled: 'false'}).translationProgressPanelEnabled).toBe(false);
    });

    it('迁移旧 translationStatus 布尔值并移除旧字段', () => {
        const enabled = normalizeConfig({translationStatus: true});
        const disabled = normalizeConfig({translationStatus: false});

        expect(enabled.translationProgressPanelEnabled).toBe(true);
        expect(disabled.translationProgressPanelEnabled).toBe(false);
        expect((enabled as unknown as Record<string, unknown>).translationStatus).toBeUndefined();
        expect((disabled as unknown as Record<string, unknown>).translationStatus).toBeUndefined();
    });

    it('移除旧版全局启用开关，残留的关闭状态不再写回配置', () => {
        expect('on' in normalizeConfig({on: false})).toBe(false);
    });
});

describe('动画模式配置', () => {
    it('缺省使用文字流光，并保留显式选择的模式', () => {
        expect(options.animationModes.map(({value}) => value)).toEqual(['default', 'shimmer', 'static']);
        expect(normalizeConfig({}).animationMode).toBe('shimmer');
        expect(normalizeConfig({animationMode: 'default'}).animationMode).toBe('default');
        expect(normalizeConfig({animationMode: 'static'}).animationMode).toBe('static');
    });

    it('迁移旧动画开关并移除旧字段', () => {
        const enabled = normalizeConfig({animations: true});
        const disabled = normalizeConfig({animations: false});

        expect(enabled.animationMode).toBe('shimmer');
        expect(disabled.animationMode).toBe('static');
        expect((enabled as unknown as Record<string, unknown>).animations).toBeUndefined();
        expect((disabled as unknown as Record<string, unknown>).animations).toBeUndefined();
    });
});

describe('鼠标悬浮翻译延迟配置', () => {
    it('默认保留现有 50ms 行为，并归一化用户设置', () => {
        expect(new Config().mouseHoverTranslationDelay).toBe(DEFAULT_MOUSE_HOVER_TRANSLATION_DELAY);
        expect(normalizeConfig({}).mouseHoverTranslationDelay).toBe(DEFAULT_MOUSE_HOVER_TRANSLATION_DELAY);
        expect(normalizeConfig({mouseHoverTranslationDelay: 235}).mouseHoverTranslationDelay).toBe(240);
        expect(normalizeConfig({mouseHoverTranslationDelay: '120'}).mouseHoverTranslationDelay).toBe(120);
    });

    it('将越界或非法值限制在安全范围内', () => {
        expect(normalizeConfig({mouseHoverTranslationDelay: -100}).mouseHoverTranslationDelay)
            .toBe(MOUSE_HOVER_TRANSLATION_DELAY_MIN);
        expect(normalizeConfig({mouseHoverTranslationDelay: 99999}).mouseHoverTranslationDelay)
            .toBe(MOUSE_HOVER_TRANSLATION_DELAY_MAX);
        expect(normalizeConfig({mouseHoverTranslationDelay: 'invalid'}).mouseHoverTranslationDelay)
            .toBe(DEFAULT_MOUSE_HOVER_TRANSLATION_DELAY);
    });
});

describe('划词翻译显示延迟配置', () => {
    it('默认等待 300ms，并归一化用户设置', () => {
        expect(new Config().selectionTranslatorDelay).toBe(DEFAULT_SELECTION_TRANSLATOR_DELAY);
        expect(normalizeConfig({}).selectionTranslatorDelay).toBe(DEFAULT_SELECTION_TRANSLATOR_DELAY);
        expect(normalizeConfig({selectionTranslatorDelay: 326}).selectionTranslatorDelay).toBe(350);
        expect(normalizeConfig({selectionTranslatorDelay: '150'}).selectionTranslatorDelay).toBe(150);
    });

    it('允许显式立即显示，并限制越界或非法值', () => {
        expect(normalizeConfig({selectionTranslatorDelay: 0}).selectionTranslatorDelay)
            .toBe(SELECTION_TRANSLATOR_DELAY_MIN);
        expect(normalizeConfig({selectionTranslatorDelay: -100}).selectionTranslatorDelay)
            .toBe(SELECTION_TRANSLATOR_DELAY_MIN);
        expect(normalizeConfig({selectionTranslatorDelay: 99999}).selectionTranslatorDelay)
            .toBe(SELECTION_TRANSLATOR_DELAY_MAX);
        expect(normalizeConfig({selectionTranslatorDelay: 'invalid'}).selectionTranslatorDelay)
            .toBe(DEFAULT_SELECTION_TRANSLATOR_DELAY);
        for (const value of [null, false, '', '   ']) {
            expect(normalizeConfig({selectionTranslatorDelay: value}).selectionTranslatorDelay)
                .toBe(DEFAULT_SELECTION_TRANSLATOR_DELAY);
        }
    });
});

describe('划词翻译配置兼容', () => {
    it('为旧配置补齐可发现的触发方式，并清理非法值', () => {
        expect(normalizeConfig({selectionTranslatorMode: 'bilingual'})).toMatchObject({
            selectionTranslatorMode: 'bilingual',
            selectionTranslatorTrigger: 'icon',
            disableSelectionTranslator: false,
        });

        expect(normalizeConfig({selectionTranslatorMode: 'invalid', selectionTranslatorTrigger: 'invalid'})).toMatchObject({
            selectionTranslatorMode: 'disabled',
            selectionTranslatorTrigger: 'icon',
            disableSelectionTranslator: true,
        });
    });

    it('将划词触发方式规范化为互斥触发选项，并兼容旧快捷键配置', () => {
        expect(new Config().selectionTranslatorTrigger).toBe('icon');
        expect(new Config().selectionTranslatorHotkey).toBe('none');
        expect(new Config().customSelectionTranslatorHotkey).toBe('');
        expect(normalizeConfig({selectionTranslatorTrigger: 'Control'})).toMatchObject({
            selectionTranslatorTrigger: 'Control',
            selectionTranslatorHotkey: 'Control',
        });
        expect(normalizeConfig({selectionTranslatorTrigger: 'icon', selectionTranslatorHotkey: 'Control'})).toMatchObject({
            selectionTranslatorTrigger: 'icon',
            selectionTranslatorHotkey: 'none',
        });
        expect(normalizeConfig({selectionTranslatorHotkey: 'Control'})).toMatchObject({
            selectionTranslatorTrigger: 'Control',
            selectionTranslatorHotkey: 'Control',
        });
        expect(normalizeConfig({selectionTranslatorTrigger: 'custom', selectionTranslatorHotkey: 'custom', customSelectionTranslatorHotkey: 'Ctrl+Shift+Y'})).toMatchObject({
            selectionTranslatorTrigger: 'custom',
            selectionTranslatorHotkey: 'custom',
            customSelectionTranslatorHotkey: 'Ctrl+Shift+Y',
        });
        expect(normalizeConfig({selectionTranslatorTrigger: 'invalid', selectionTranslatorHotkey: 'invalid', customSelectionTranslatorHotkey: 42})).toMatchObject({
            selectionTranslatorTrigger: 'icon',
            selectionTranslatorHotkey: 'none',
            customSelectionTranslatorHotkey: '',
        });
    });

    it('保留三种视觉触发方式，并为每个预设快捷键镜像字段', () => {
        for (const trigger of ['direct', 'icon', 'dot']) {
            expect(normalizeConfig({selectionTranslatorTrigger: trigger, selectionTranslatorHotkey: 'Control'})).toMatchObject({
                selectionTranslatorTrigger: trigger,
                selectionTranslatorHotkey: 'none',
            });
            expect(normalizeConfig({selectionTranslatorTrigger: trigger, selectionTranslatorHotkey: 'none'})).toMatchObject({
                selectionTranslatorTrigger: trigger,
                selectionTranslatorHotkey: 'none',
            });
        }
        for (const trigger of ['Alt', 'Shift']) {
            expect(normalizeConfig({selectionTranslatorTrigger: trigger})).toMatchObject({
                selectionTranslatorTrigger: trigger,
                selectionTranslatorHotkey: trigger,
            });
        }
    });

    it('normalizes and persists the optional TTS voice fallback order', () => {
        expect(new Config().selectionTtsVoices).toEqual([]);
        expect(normalizeConfig({selectionTtsVoices: [
            'en-US-JennyNeural',
            'invalid',
            'en-US-JennyNeural',
            'zh-CN-XiaoyiNeural',
        ]}).selectionTtsVoices).toEqual([
            'en-US-JennyNeural',
            'zh-CN-XiaoyiNeural',
        ]);
    });

    it('keeps the vocabulary book beta opt-in and normalizes invalid values', () => {
        expect(new Config().vocabularyBookEnabled).toBe(false);
        expect(normalizeConfig({vocabularyBookEnabled: true}).vocabularyBookEnabled).toBe(true);
        expect(normalizeConfig({vocabularyBookEnabled: 'yes'}).vocabularyBookEnabled).toBe(false);
    });
});

describe('OpenAI 兼容服务端点', () => {
    it('使用服务商当前公开的统一 Chat Completions 端点', () => {
        expect(urls[services.yiyan]).toBe('https://qianfan.bj.baidubce.com/v2/chat/completions');
        expect(urls[services.minimax]).toBe('https://api.minimaxi.com/v1/chat/completions');
        expect(MINIMAX_ENDPOINTS.payg.cn).toBe('https://api.minimaxi.com/v1/chat/completions');
        expect(MINIMAX_ENDPOINTS['token-plan'].global).toBe('https://api.minimax.io/v1/chat/completions');
        expect(urls[services.infini]).toBe('https://cloud.infini-ai.com/maas/v1/chat/completions');
        expect(urls[services.huanYuan]).toBe('https://api.tokenhub.tencent.com/v1/chat/completions');
        expect(tongyiTokenPlanUrl).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    });

    it('MiMo 按量付费与三套 Token Plan 集群使用不同端点', () => {
        expect(MIMO_ENDPOINTS.payg.cn).toBe('https://api.xiaomimimo.com/v1/chat/completions');
        expect(getMimoEndpoint('token-plan', 'cn')).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
        expect(getMimoEndpoint('token-plan', 'sgp')).toBe('https://token-plan-sgp.xiaomimimo.com/v1/chat/completions');
        expect(getMimoEndpoint('token-plan', 'ams')).toBe('https://token-plan-ams.xiaomimimo.com/v1/chat/completions');
        expect(getMimoEndpoint('payg', 'ams')).toBe('https://api.xiaomimimo.com/v1/chat/completions');
        expect(getMimoEndpoint('token-plan', 'invalid')).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
    });

    it('文心一言使用 Bearer Token', () => {
        expect(servicesType.isUseToken(services.yiyan)).toBe(true);
    });
});
