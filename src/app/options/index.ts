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
import {
  CircleCheckFilled,
  Coffee,
  Download,
  Edit,
  InfoFilled,
  Loading,
  Refresh,
  Setting,
  Star,
  Upload,
  Warning,
  WarningFilled,
} from '@element-plus/icons-vue'
import OptionsApp from './OptionsApp.vue'
import 'element-plus/dist/index.css'
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

const ELEMENT_ICONS: Record<string, Component> = {
  CircleCheckFilled,
  Coffee,
  Download,
  Edit,
  InfoFilled,
  Loading,
  Refresh,
  Setting,
  Star,
  Upload,
  Warning,
  WarningFilled,
}

/** options 的唯一组装入口：注册页面依赖后挂载 Vue 根组件。 */
export function mountOptionsApp(selector: string): void {
  const app = createApp(OptionsApp)

  for (const component of ELEMENT_COMPONENTS) {
    if (component.name) app.component(component.name, component)
  }
  for (const [name, component] of Object.entries(ELEMENT_ICONS)) {
    app.component(name, component)
  }

  app.mount(selector)
}
