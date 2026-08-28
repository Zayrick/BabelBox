<template>
  <div class="settings-app">
    <aside class="sidebar">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div><strong>流畅阅读</strong><small>FluentRead · V{{ version }}</small></div>
      </div>

      <nav aria-label="设置分类">
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
      </nav>
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

      <section class="settings-card" :class="{ 'services-view': activeSection === 'settings-services', 'translation-center-view': activeSection === 'settings-translation-center', 'vocabulary-view': activeSection === 'settings-vocabulary' }" :aria-label="activeItem.title">
        <section v-if="activeSection === 'settings-about'" id="settings-about" class="about-page" aria-labelledby="about-title">
          <div class="about-summary">
            <img class="about-logo" src="/icon/128.png" alt="流畅阅读图标" />
            <div>
              <h2 id="about-title">流畅阅读</h2>
              <span class="about-version">FluentRead · V{{ version }}</span>
            </div>
          </div>
          <p class="about-description">一款提供网页双语翻译、划词翻译与多翻译服务支持的开源浏览器扩展。</p>
          <div class="about-links">
            <a href="https://github.com/Bistutu/FluentRead" target="_blank" rel="noreferrer">开源项目 <ExternalLink :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
            <a href="https://fluent.thinkstu.com/" target="_blank" rel="noreferrer">使用文档 <ExternalLink :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
            <a href="https://github.com/Bistutu/FluentRead/issues" target="_blank" rel="noreferrer">问题反馈 <ExternalLink :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" /></a>
          </div>
        </section>
        <VocabularyBook v-else-if="activeSection === 'settings-vocabulary'" @navigate="selectSection" />
        <SettingsSections v-else :active-section="activeSection" />
      </section>

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function selectResult(id: string) {
  selectSection(id)
}

onMounted(() => {
  activeSection.value = resolveRequestedSection(window.location.hash)
})
</script>
