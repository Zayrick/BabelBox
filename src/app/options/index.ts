import { createApp, type Component } from 'vue'
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElCol,
  ElDialog,
  ElDivider,
  ElEmpty,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElOption,
  ElOptionGroup,
  ElRow,
  ElSelect,
  ElSwitch,
  ElText,
  ElTooltip,
} from 'element-plus'
import OptionsApp from './OptionsApp.vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@/src/features/settings/ui/settings-page.css'

const ELEMENT_COMPONENTS: Component[] = [
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElCol,
  ElDialog,
  ElDivider,
  ElEmpty,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElOption,
  ElOptionGroup,
  ElRow,
  ElSelect,
  ElSwitch,
  ElText,
  ElTooltip,
]

/** options 的唯一组装入口：注册页面依赖后挂载 Vue 根组件。 */
export function mountOptionsApp(selector: string): void {
  const app = createApp(OptionsApp)

  for (const component of ELEMENT_COMPONENTS) {
    if (component.name) app.component(component.name, component)
  }
  app.mount(selector)
}
