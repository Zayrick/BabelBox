import {describe, expect, it, vi} from 'vitest';

import {createTranslationModelCatalogHandler} from '@/src/app/background/handlers/modelCatalog';
import {createBackgroundMessageRouter} from '@/src/platform/browser/messageRouter';
import {TRANSLATION_MODEL_CATALOG_MESSAGE} from '@/src/services/translation/modelCatalog';

describe('background translation model catalog handler', () => {
    it('等待配置完成后按服务实例获取模型', async () => {
        const listModels = vi.fn(async () => ['model-a', 'model-b']);
        const router = createBackgroundMessageRouter([
            createTranslationModelCatalogHandler({
                ready: Promise.resolve(),
                listModels,
                formatError: (error) => String(error),
            }),
        ]);

        await expect(router.dispatch({
            type: TRANSLATION_MODEL_CATALOG_MESSAGE,
            service: 'service:openai:first',
        }, undefined)).resolves.toEqual({
            handled: true,
            response: {success: true, models: ['model-a', 'model-b']},
        });
        expect(listModels).toHaveBeenCalledWith('service:openai:first');
    });

    it('把接口失败和非法 service 收敛为错误响应', async () => {
        const listModels = vi.fn(async () => { throw new Error('provider unavailable'); });
        const handler = createTranslationModelCatalogHandler({
            ready: Promise.resolve(),
            listModels,
            formatError: (error) => error instanceof Error ? error.message : String(error),
        });

        await expect(handler.handle({
            type: TRANSLATION_MODEL_CATALOG_MESSAGE,
            service: 'service:openai:first',
        }, undefined)).resolves.toEqual({success: false, error: 'provider unavailable'});
        await expect(handler.handle({
            type: TRANSLATION_MODEL_CATALOG_MESSAGE,
            service: '   ',
        }, undefined)).resolves.toEqual({success: false, error: '模型列表 service 必须是非空字符串'});
    });
});
