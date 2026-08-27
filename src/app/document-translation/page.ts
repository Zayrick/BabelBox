import {createApp, type Component} from 'vue';
import {ElOption, ElSelect} from 'element-plus';
import DocumentApp from './DocumentApp.vue';
import 'element-plus/es/components/select/style/css';
import './document-page.css';

const ELEMENT_COMPONENTS: Component[] = [ElSelect, ElOption];

/** 文档翻译 WXT 页面唯一挂载入口。 */
export function mountDocumentTranslationApp(selector: string): void {
    const app = createApp(DocumentApp);
    for (const component of ELEMENT_COMPONENTS) {
        if (component.name) app.component(component.name, component);
    }
    app.mount(selector);
}
