import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {
        on: true,
        service: 'microsoft',
        translationServices: [] as Array<{
            id: string;
            provider: string;
            name: string;
            enabled: boolean;
            kind: 'machine' | 'ai';
            modelId: string;
        }>,
        model: {} as Record<string, string>,
        customModel: {} as Record<string, string>,
        display: 1,
    },
    sendErrorMessage: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/features/page-notice/public', () => ({sendErrorMessage: mocks.sendErrorMessage}));

import {customModelString, services} from '@/src/core/config/catalog';
import {checkConfig} from '@/src/features/full-page-translation/content/configCheck';

describe('translation configuration guard', () => {
    beforeEach(() => {
        mocks.config.on = true;
        mocks.config.service = services.microsoft;
        mocks.config.translationServices = [];
        mocks.config.model = {};
        mocks.config.customModel = {};
        mocks.config.display = 1;
        mocks.sendErrorMessage.mockReset();
    });

    it('插件关闭时直接停止且不显示误导提示', () => {
        mocks.config.on = false;

        expect(checkConfig()).toBe(false);
        expect(mocks.sendErrorMessage).not.toHaveBeenCalled();
    });

    it('AI 服务实例缺少模型时给出可执行提示', () => {
        mocks.config.service = 'service:openai:missing-model';
        mocks.config.translationServices = [{
            id: mocks.config.service,
            provider: services.openai,
            name: '未配置模型',
            enabled: true,
            kind: 'ai',
            modelId: '',
        }];

        expect(checkConfig()).toBe(false);
        expect(mocks.sendErrorMessage).toHaveBeenCalledWith('模型尚未配置，请前往设置页配置');
    });

    it('旧配置中的空自定义模型按供应商默认模型归一化', () => {
        mocks.config.service = services.openai;
        mocks.config.model[services.openai] = customModelString;
        mocks.config.customModel[services.openai] = '';

        expect(checkConfig()).toBe(true);
    });

    it('Coze 不要求通用模型配置', () => {
        mocks.config.service = services.cozecom;

        expect(checkConfig()).toBe(true);
        expect(mocks.sendErrorMessage).not.toHaveBeenCalled();
    });

    it('谷歌翻译在仅译文模式下拒绝并说明原因', () => {
        mocks.config.service = services.google;
        mocks.config.display = 0;

        expect(checkConfig()).toBe(false);
        expect(mocks.sendErrorMessage).toHaveBeenCalledWith('「谷歌翻译」仅支持双语模式，请切换翻译服务');
    });

    it('有效配置通过，并复用纯思考标签清理器', () => {
        mocks.config.service = services.openai;
        mocks.config.model[services.openai] = 'model-1';

        expect(checkConfig()).toBe(true);
    });

    it('按实例解引用供应商和模型，而不是把实例 ID 当供应商', () => {
        mocks.config.service = 'service:openai:document';
        mocks.config.translationServices = [{
            id: mocks.config.service,
            provider: services.openai,
            name: '文档模型',
            enabled: true,
            kind: 'ai',
            modelId: 'gpt-document',
        }];

        expect(checkConfig()).toBe(true);
        expect(mocks.sendErrorMessage).not.toHaveBeenCalled();
    });
});
