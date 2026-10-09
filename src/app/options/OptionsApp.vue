<template>
  <div class="settings-app">
    <aside class="sidebar">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <strong>翻译机</strong>
        <code class="brand-version">v{{ version }}</code>
      </div>

      <label class="search-box">
        <Search :size="15" :stroke-width="1.8" aria-hidden="true" focusable="false" />
        <input v-model.trim="query" type="search" aria-label="搜索设置" placeholder="搜索设置" />
      </label>

      <nav class="sidebar-navigation" aria-label="设置分类">
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
            <component :is="navigationIcons[item.icon]" class="nav-icon" :size="17" :stroke-width="1.7" aria-hidden="true" focusable="false" />
            <span class="nav-title">{{ item.label }}</span>
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </button>
        </section>
      </nav>
    </aside>

    <main
      ref="workspace"
      class="workspace"
      :class="{ 'is-services': !query && activeSection === 'settings-services' }"
    >
      <div class="workspace-column">
        <template v-if="query">
          <header class="page-header">
            <h1>搜索结果</h1>
            <p>“{{ query }}”</p>
          </header>
          <div v-if="filteredResults.length" class="search-results">
            <button v-for="result in filteredResults" :key="result.id" type="button" @click="selectResult(result.id)">
              <span><strong>{{ result.label }}</strong><small>{{ result.searchDescription }}</small></span>
              <ArrowRight :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" />
            </button>
          </div>
          <p v-else class="search-empty">没有找到相关设置。</p>
        </template>

        <template v-else>
          <header class="page-header">
            <h1>{{ activeItem.title }}</h1>
          </header>

          <section
            class="settings-card"
            :class="{ 'services-view': activeSection === 'settings-services', 'translation-center-view': activeSection === 'settings-translation-center', 'vocabulary-view': activeSection === 'settings-vocabulary' }"
            :aria-label="activeItem.title"
          >
            <div class="settings-card-view">
              <section v-if="activeSection === 'settings-about'" id="settings-about" class="about-page" aria-labelledby="about-title">
                <div class="about-summary">
                  <img class="about-logo" src="/icon/128.png" alt="翻译机图标" />
                  <div>
                    <h2 id="about-title">翻译机</h2>
                    <code class="about-version">BabelBox v{{ version }}</code>
                  </div>
                </div>
                <p class="about-description">开源的浏览器翻译扩展，支持网页双语对照、划词翻译和多种翻译服务。</p>
                <div class="about-links">
                  <a href="https://github.com/Zayrick/BabelBox" target="_blank" rel="noreferrer">开源项目 <ExternalLink :size="15" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
                  <a href="https://github.com/Zayrick/BabelBox/tree/main/docs" target="_blank" rel="noreferrer">使用文档 <ExternalLink :size="15" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
                  <a href="https://github.com/Zayrick/BabelBox/issues" target="_blank" rel="noreferrer">问题反馈 <ExternalLink :size="15" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
                </div>
              </section>
              <VocabularyBook v-else-if="activeSection === 'settings-vocabulary'" @navigate="selectSection" />
              <SettingsSections v-else :active-section="activeSection" />
            </div>
          </section>
        </template>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
const workspace = ref<HTMLElement | null>(null)
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
  void nextTick(() => workspace.value?.scrollTo({ top: 0, left: 0 }))
}

function selectResult(id: string) {
  selectSection(id)
}

// hash 同时是分区 id，浏览器加载时会把滚动区跳到该锚点；分区切换后应始终从页首开始。
function resetWorkspaceScroll() {
  workspace.value?.scrollTo({ top: 0, left: 0 })
  window.scrollTo({ top: 0, left: 0 })
}

onMounted(() => {
  activeSection.value = resolveRequestedSection(window.location.hash)
  requestAnimationFrame(resetWorkspaceScroll)
  if (document.readyState !== 'complete') window.addEventListener('load', resetWorkspaceScroll, { once: true })
})

onBeforeUnmount(unsubscribeTheme)
</script>
