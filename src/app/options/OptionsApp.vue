<template>
  <div class="settings-app">
    <aside class="sidebar">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div><strong>翻译机</strong><small>BabelBox · V{{ version }}</small></div>
      </div>

      <el-scrollbar
        class="sidebar-navigation"
        tag="nav"
        aria-label="设置分类"
        view-class="sidebar-navigation-view"
      >
        <section v-for="group in navigationGroups" :key="group.label" class="nav-group">
          <span class="nav-group-label">{{ group.label }}</span>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            :data-section="item.id"
            :class="{ active: activeSection === item.id }"
            :aria-current="activeSection === item.id ? 'page' : undefined"
            @click="selectSection(item.id)"
          >
            <span class="nav-icon" aria-hidden="true">
              <component :is="navigationIcons[item.icon]" :size="18" :stroke-width="1.9" focusable="false" />
            </span>
            <span class="nav-title">
              <strong>{{ item.label }}</strong>
              <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
            </span>
          </button>
        </section>
      </el-scrollbar>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <h1>{{ activeItem.title }}</h1>
        <label class="search-box">
          <Search :size="17" :stroke-width="1.8" aria-hidden="true" focusable="false" />
          <input v-model.trim="query" type="search" placeholder="搜索设置，例如：快捷键、缓存、OpenAI" />
        </label>
      </header>

      <div v-if="query && filteredResults.length" class="search-results">
        <button v-for="result in filteredResults" :key="result.id" type="button" @click="selectResult(result.id)">
          <span><strong>{{ result.label }}</strong><small>{{ result.searchDescription }}</small></span>
          <b>打开 <ArrowRight :size="13" :stroke-width="2" aria-hidden="true" focusable="false" /></b>
        </button>
      </div>
      <div v-else-if="query" class="search-empty">没有找到“{{ query }}”相关设置</div>

      <el-scrollbar
        ref="settingsScrollbar"
        class="settings-card"
        :class="{ 'services-view': activeSection === 'settings-services', 'translation-center-view': activeSection === 'settings-translation-center', 'vocabulary-view': activeSection === 'settings-vocabulary' }"
        tag="section"
        :aria-label="activeItem.title"
        view-class="settings-card-view"
      >
        <section v-if="activeSection === 'settings-about'" id="settings-about" class="about-page" aria-labelledby="about-title">
          <div class="about-summary">
            <img class="about-logo" src="/icon/128.png" alt="翻译机图标" />
            <div>
              <h2 id="about-title">翻译机</h2>
              <span class="about-version">BabelBox · V{{ version }}</span>
            </div>
          </div>
          <p class="about-description">一款提供网页双语翻译、划词翻译与多翻译服务支持的开源浏览器扩展。</p>
          <div class="about-links">
            <a href="https://github.com/Zayrick/BabelBox" target="_blank" rel="noreferrer">开源项目 <ExternalLink :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
            <a href="https://github.com/Zayrick/BabelBox/tree/main/docs" target="_blank" rel="noreferrer">使用文档 <ExternalLink :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
            <a href="https://github.com/Zayrick/BabelBox/issues" target="_blank" rel="noreferrer">问题反馈 <ExternalLink :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
          </div>
        </section>
        <VocabularyBook v-else-if="activeSection === 'settings-vocabulary'" @navigate="selectSection" />
        <SettingsSections v-else :active-section="activeSection" />
      </el-scrollbar>

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElScrollbar, type ScrollbarInstance } from 'element-plus'
import {
  ArrowRight,
  BookMarked,
  Captions,
  CircleQuestionMark,
  DatabaseBackup,
  ExternalLink,
  Globe,
  House,
  Keyboard,
  Languages,
  ScanText,
  Search,
  ServerCog,
  SlidersHorizontal,
  type LucideIcon,
} from '@lucide/vue'
import SettingsSections from '@/src/features/settings/ui/SettingsSections.vue'
import VocabularyBook from '@/src/features/vocabulary/ui/VocabularyBook.vue'
import {
  config as runtimeConfig,
  configReady,
  subscribeConfig,
} from '@/src/services/config/store'
import { useDocumentTheme } from '@/src/ui/composables/useDocumentTheme'
import {
  filterNavigationItems,
  navigationGroups,
  navigationItems,
  resolveNavigationItem,
  resolveRequestedSection,
  type NavigationIconKey,
} from '@/src/features/settings/model/navigation'

const version = process.env.VUE_APP_VERSION
const query = ref('')
const activeSection = ref('settings-general')
const settingsScrollbar = ref<ScrollbarInstance | null>(null)
const theme = ref(runtimeConfig.theme || 'auto')
const unsubscribeTheme = subscribeConfig((nextConfig) => {
  theme.value = nextConfig.theme || 'auto'
})

useDocumentTheme(theme)
void configReady.then(() => {
  theme.value = runtimeConfig.theme || 'auto'
})

const navigationIcons: Record<NavigationIconKey, LucideIcon> = {
  general: House,
  services: ServerCog,
  'translation-center': Languages,
  vocabulary: BookMarked,
  shortcuts: Keyboard,
  sites: Globe,
  'image-translation': ScanText,
  video: Captions,
  advanced: SlidersHorizontal,
  data: DatabaseBackup,
  about: CircleQuestionMark,
}

const navigation = navigationItems
const activeItem = computed(() => resolveNavigationItem(activeSection.value))

const filteredResults = computed(() => {
  return filterNavigationItems(query.value)
})

function selectSection(id: string) {
  if (!navigation.some((item) => item.id === id)) return
  activeSection.value = id
  query.value = ''
  history.replaceState(null, '', `#${id}`)
  void nextTick(() => settingsScrollbar.value?.scrollTo({ top: 0, left: 0, behavior: 'smooth' }))
}

function selectResult(id: string) {
  selectSection(id)
}

onMounted(() => {
  activeSection.value = resolveRequestedSection(window.location.hash)
})

onBeforeUnmount(unsubscribeTheme)
</script>
