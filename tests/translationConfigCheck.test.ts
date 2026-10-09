import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {TranslationServiceInstance} from '@/src/core/config/translationServices';

const mocks = vi.hoisted(() => ({
    config: {
        service: 'microsoft',
        translationServices: [] as TranslationServiceInstance[],
        display: 1,
    },
    sendErrorMessage: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/features/page-notice/public', () => ({sendErrorMessage: mocks.sendErrorMessage}));

import {services} from '@/src/core/config/catalog';
import {checkConfig} from '@/src/features/full-page-translation/content/configCheck';
import {serviceInstance} from './fixtures/translationService';

function select(provider: string, modelId = ''): void {
    const instance = serviceInstance(provider, {modelId});
    mocks.config.service = instance.id;
    mocks.config.translationServices = [instance];
}

describe('translation configuration guard', () => {
    beforeEach(() => {
        select(services.microsoft);
        mocks.config.display = 1;
        mocks.sendErrorMessage.mockReset();
    });

    it('AI 服务实例缺少模型时给出可执行提示', () => {
        select(services.openai);

        expect(checkConfig()).toBe(false);
        expect(mocks.sendErrorMessage).toHaveBeenCalledWith('模型尚未配置，请前往设置页配置');
    });

    it('Coze 不要求通用模型配置', () => {
        select(services.cozecom);

        expect(checkConfig()).toBe(true);
        expect(mocks.sendErrorMessage).not.toHaveBeenCalled();
    });

    it('谷歌翻译在仅译文模式下拒绝并说明原因', () => {
        select(services.google);
        mocks.config.display = 0;

        expect(checkConfig()).toBe(false);
        expect(mocks.sendErrorMessage).toHaveBeenCalledWith('「谷歌翻译」仅支持双语模式，请切换翻译服务');
    });

    it('已配置模型的 AI 服务通过', () => {
        select(services.openai, 'model-1');

        expect(checkConfig()).toBe(true);
    });
});
