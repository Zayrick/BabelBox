import {createApp} from 'vue';
import './popup.css';
import App from './PopupApp.vue';
import 'element-plus/dist/index.css'

import {
  ElRow,
  ElCol,
  ElContainer,
  ElHeader,
  ElMain,
  ElFooter,
  ElSelect,
  ElOption,
  ElOptionGroup,
  ElInput,
  ElSwitch,
  ElCollapse,
  ElCollapseItem,
  ElTooltip,
  ElEmpty,
  ElLink,
  ElText,
  ElButton,
  ElDialog,
  ElDivider,
  ElInputNumber,
  ElDrawer
} from 'element-plus'

const ELEMENT_COMPONENTS = [
  ElRow,
  ElCol,
  ElContainer,
  ElHeader,
  ElMain,
  ElFooter,
  ElSelect,
  ElOption,
  ElOptionGroup,
  ElInput,
  ElSwitch,
  ElCollapse,
  ElCollapseItem,
  ElTooltip,
  ElEmpty,
  ElLink,
  ElText,
  ElButton,
  ElDialog,
  ElDivider,
  ElInputNumber,
  ElDrawer
] as const

/** Popup 的唯一组装入口：注册页面依赖后挂载 Vue 根组件。 */
export function mountPopupApp(selector: string): void {
  const app = createApp(App)

  // 只注册 Popup 模板真正使用的 Element Plus 组件。
  for (const component of ELEMENT_COMPONENTS) {
    if (component.name) app.component(component.name, component)
  }

  // 由唯一的 WXT 启动入口提供挂载目标，避免 app 层假定页面结构。
  app.mount(selector)
}
