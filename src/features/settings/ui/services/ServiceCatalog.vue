<template>
  <section
    class="service-catalog"
    aria-label="翻译服务配置"
    :data-default-service="defaultService"
    :data-editing-service="service"
    :data-presentation-mode="presentation.mode"
  >
    <div class="catalog-layout">
      <aside class="service-rail" aria-label="翻译服务列表">
        <div class="catalog-search-row">
          <label class="catalog-search">
            <Search :size="16" :stroke-width="1.8" aria-hidden="true" focusable="false" />
            <input v-model.trim="serviceQuery" type="search" placeholder="搜索翻译服务" />
          </label>
          <button
            type="button"
            class="catalog-add-button"
            aria-label="添加翻译服务"
            title="添加翻译服务"
            @click="$emit('add')"
          >
            <Plus :size="18" :stroke-width="2" aria-hidden="true" focusable="false" />
          </button>
        </div>

        <div v-if="filteredGroups.length" class="service-groups">
          <section v-for="group in filteredGroups" :key="group.id" class="service-group">
            <div class="group-heading">
              <strong>{{ group.label }}</strong>
              <span>{{ group.items.length }} 项</span>
            </div>
            <div
              v-for="item in group.items"
              :key="item.value"
              class="service-item"
              :data-service-value="item.value"
              :data-service-enabled="serviceEnabled(item) ? 'true' : 'false'"
              :class="{
                active: service === item.value,
                'is-disabled': !serviceEnabled(item),
              }"
            >
              <button
                type="button"
                class="service-select"
                :aria-pressed="service === item.value"
                @click="$emit('update:service', item.value)"
              >
                <ServiceIcon :service="serviceProvider(item)" :label="item.label" />
                <span class="service-copy">
                  <strong>{{ item.label }}</strong>
                  <span v-if="serviceModelId(item) || defaultService === item.value" class="service-meta">
                    <small v-if="serviceModelId(item)" :title="serviceModelId(item)">{{ serviceModelId(item) }}</small>
                    <small v-if="defaultService === item.value" class="default-service-label">默认</small>
                  </span>
                </span>
              </button>
              <span class="service-row-actions">
                <el-switch
                  class="service-enabled-switch"
                  size="small"
                  :model-value="serviceEnabled(item)"
                  :aria-label="`${serviceEnabled(item) ? '禁用' : '启用'}${item.label}`"
                  @click.stop
                  @update:model-value="updateServiceEnabled(item, $event)"
                />
              </span>
            </div>
          </section>
        </div>
        <p v-else class="catalog-empty">没有匹配的翻译服务</p>
      </aside>

      <section class="service-detail" aria-label="当前翻译服务详情">
        <div class="detail-hero">
          <ServiceIcon :service="selectedService ? serviceProvider(selectedService) : service" :label="selectedService?.label" size="large" />
          <div class="detail-hero-copy">
            <h4>{{ selectedService?.label || '尚未配置服务' }}</h4>
            <small v-if="selectedService && serviceModelId(selectedService)" :title="serviceModelId(selectedService)">
              {{ serviceModelId(selectedService) }}
            </small>
          </div>
          <div class="detail-hero-actions">
            <button
              v-if="selectedService && serviceRemovable(selectedService)"
              type="button"
              class="service-remove-button"
              :aria-label="`删除${selectedService.label}`"
              :title="`删除${selectedService.label}`"
              @click="$emit('remove', selectedService.value)"
            >
              <Trash2 :size="16" aria-hidden="true" focusable="false" />
            </button>
          </div>
        </div>

        <div
          v-if="presentation.showConnectionConfiguration"
          class="service-configuration-slot"
          aria-label="当前服务配置"
        >
          <slot name="configuration" />
        </div>
        <div v-else class="service-action-host">
          <slot name="configuration" />
        </div>

        <div v-if="presentation.showReadyState" class="service-ready-state" role="status">
          <div class="service-ready-content">
            <span class="service-ready-icon" aria-hidden="true">
              <CircleCheck :size="30" :stroke-width="2" focusable="false" />
            </span>
            <div>
              <strong>{{ presentation.readyState.title }}</strong>
              <p>{{ presentation.readyState.description }}</p>
            </div>
          </div>
        </div>
        <div
          v-if="presentation.showUnavailableState"
          class="service-ready-state is-unavailable"
          role="status"
        >
          <div class="service-ready-content">
            <span class="service-ready-icon" aria-hidden="true">
              <CircleX :size="30" :stroke-width="2" focusable="false" />
            </span>
            <div>
              <strong>{{ presentation.unavailableState.title }}</strong>
              <p>{{ presentation.unavailableState.description }}</p>
            </div>
          </div>
        </div>

      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CircleCheck, CircleX, Plus, Search, Trash2 } from '@lucide/vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import {
  buildServiceGroups,
  filterServiceGroups,
} from '@/src/ui/view-model/serviceCatalog'
import type {TranslationServiceOption} from '@/src/core/config/translationServices'
import type {ServiceConfigurationPresentation} from '@/src/features/settings/model/serviceConfiguration'

const props = defineProps<{
  service: string
  defaultService: string
  services: TranslationServiceOption[]
  presentation: ServiceConfigurationPresentation
}>()

const emit = defineEmits<{
  'update:service': [value: string]
  'update:enabled': [id: string, enabled: boolean]
  remove: [id: string]
  add: []
}>()

const serviceQuery = ref('')

const groups = computed(() => buildServiceGroups(props.services))
const filteredGroups = computed(() => filterServiceGroups(groups.value, serviceQuery.value))
const selectedService = computed(() => groups.value
  .flatMap((group) => group.items)
  .find((item) => item.value === props.service))

function serviceProvider(item: TranslationServiceOption): string {
  return item.provider
}

function serviceEnabled(item: TranslationServiceOption): boolean {
  return item.enabled
}

function serviceModelId(item: TranslationServiceOption): string {
  return item.modelId || ''
}

function serviceRemovable(item: TranslationServiceOption): boolean {
  return item.kind === 'ai'
}

function updateServiceEnabled(item: TranslationServiceOption, value: boolean | string | number): void {
  emit('update:enabled', item.value, Boolean(value))
}

</script>

<style scoped>
.service-catalog { display: flex; height: clamp(520px, calc(100vh - 270px), 760px); min-height: 520px; margin: 0; border: 1px solid #e4e7ef; border-radius: 12px; overflow: hidden; background: #fff; flex-direction: column; }
.catalog-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
.service-rail { min-height: 0; padding: 12px 10px 14px; border-right: 1px solid #eceef3; background: #fafbfc; overflow-y: auto; }
.catalog-search-row { display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 8px; }
.catalog-search { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border: 1px solid #dfe3eb; border-radius: 8px; background: #fff; box-sizing: border-box; }
.catalog-search > svg { flex: 0 0 auto; color: #8991a2; }
.catalog-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: #172033; background: transparent; font-size: 13px; }
.catalog-search:focus-within { border-color: #ef4776; box-shadow: 0 0 0 3px rgba(239, 71, 118, .1); }
.catalog-add-button { display: grid; width: 36px; height: 36px; padding: 0; place-items: center; border: 1px solid #efadc0; border-radius: 8px; color: #c72a56; background: #fff4f7; cursor: pointer; }
.catalog-add-button:hover { border-color: #ef4776; color: #fff; background: #ef4776; }
.catalog-add-button:focus-visible, .service-select:focus-visible, .service-remove-button:focus-visible { outline: 2px solid #ef4776; outline-offset: 1px; }
.service-groups { display: grid; gap: 12px; margin-top: 12px; }
.group-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; padding: 7px 6px 5px; border-bottom: 1px solid #e5e8ef; color: #667187; background: transparent; }
.group-heading strong { color: #46526a; font-size: 12px; letter-spacing: .05em; }
.group-heading span { font-size: 10px; }
.service-group { min-width: 0; }
.service-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px; width: 100%; padding: 2px 7px 2px 2px; border: 1px solid transparent; border-radius: 8px; color: #172033; background: transparent; transition: background 150ms ease, border-color 150ms ease; }
.service-item:hover { border-color: #e2e5ec; background: #fff; }
.service-item.active { border-color: #f3c4d1; background: #fff0f4; }
.service-select { display: grid; min-width: 0; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 9px; padding: 6px; border: 0; border-radius: 7px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.service-item.is-disabled .service-select { opacity: .54; }
.service-enabled-switch { flex: none; }
.service-row-actions { display: inline-flex; align-items: center; gap: 5px; }
.service-copy { display: flex; min-width: 0; flex-direction: column; }
.service-copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.service-meta { display: flex; min-width: 0; align-items: center; gap: 5px; margin-top: 3px; }
.service-meta small { min-width: 0; overflow: hidden; color: #9299a8; font-size: 10px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.service-meta .default-service-label { flex: none; padding: 1px 4px; border-radius: 999px; color: #b52b52; background: #ffe4ec; font-size: 8px; font-weight: 750; }
.service-detail { display: flex; min-width: 0; min-height: 0; margin: 0; padding: 18px 20px; background: #fff; flex-direction: column; overflow: hidden; }
.service-detail > .detail-hero,
.service-detail > .service-configuration-slot { width: min(100%, 1080px); }
.detail-hero { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #eceef3; }
.detail-hero-copy { display: flex; min-width: 0; flex-direction: column; }
.detail-hero-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: 0 0 auto; }
.service-remove-button { display: grid; width: 34px; height: 34px; padding: 0; place-items: center; border: 1px solid #e4c3cc; border-radius: 9px; color: #a63a57; background: #fff; cursor: pointer; transition: 160ms ease; }
.service-remove-button:hover { border-color: #d45c70; color: #fff; background: #d45c70; }
.detail-hero h4 { min-width: 0; margin: 0; overflow: hidden; color: #172033; font-size: 20px; text-overflow: ellipsis; white-space: nowrap; }
.detail-hero-copy small { overflow: hidden; margin-top: 4px; color: #8991a2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.service-configuration-slot { min-height: 0; margin-top: 16px; overflow-y: auto; flex: 1; }
.service-action-host { display: contents; }
.service-ready-state { display: grid; width: 100%; min-height: 220px; flex: 1; place-items: center; }
.service-ready-content { display: flex; align-items: center; justify-content: center; gap: 14px; max-width: 460px; padding: 24px; flex-direction: column; text-align: center; }
.service-ready-icon { display: grid; width: 52px; height: 52px; border-radius: 50%; color: #fff; background: #28aa79; flex: 0 0 auto; place-items: center; }
.service-ready-content strong { color: #185d46; font-size: 16px; }
.service-ready-content p { margin: 5px 0 0; color: #628074; font-size: 12px; line-height: 1.6; }
.service-ready-state.is-unavailable .service-ready-icon { background: #d45c70; }
.service-ready-state.is-unavailable .service-ready-content strong { color: #8e2c42; }
.service-ready-state.is-unavailable .service-ready-content p { color: #805d66; }
.catalog-empty { margin: 20px 8px; color: #9299a8; font-size: 10px; text-align: center; }
@media (max-width: 900px) {
  .catalog-layout { grid-template-columns: 220px minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .service-catalog { height: auto; min-height: 0; }
  .catalog-layout { display: block; flex: 0 0 auto; }
  .service-rail { border-right: 0; border-bottom: 1px solid #eceef3; }
  .service-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .service-detail { padding: 16px; }
  .service-detail { min-height: 520px; margin: 0; padding: 18px; border: 0; border-radius: 0; overflow: visible; }
  .detail-hero { flex-wrap: wrap; }
  .service-configuration-slot { max-height: none; overflow: visible; }
  .service-ready-state { min-height: 0; }
}
</style>
