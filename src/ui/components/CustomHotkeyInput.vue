<template>
  <Teleport to="body">
    <div
      v-if="dialogVisible"
      class="custom-hotkey-overlay"
      role="presentation"
      @keydown.esc="handleCancel"
    >
      <section
        ref="dialogRoot"
        class="custom-hotkey-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-hotkey-title"
        aria-describedby="custom-hotkey-description"
        tabindex="-1"
        @click.stop
      >
        <header class="dialog-header">
          <div class="dialog-heading">
            <h2 id="custom-hotkey-title">自定义快捷键</h2>
            <p id="custom-hotkey-description">支持 Ctrl、Alt、Shift 与字母或功能键组合；不支持 CMD/Meta。</p>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭自定义快捷键" @click="handleCancel">
            <X aria-hidden="true" />
          </button>
        </header>

        <div class="dialog-body">
          <section class="recording-card" :class="{ 'is-recording': isRecording }">
            <div class="section-heading">
              <div>
                <h3>按下你想使用的快捷键</h3>
              </div>
              <span class="state-badge" :class="{ active: isRecording, ready: !!currentHotkey && !isRecording }">
                {{ isRecording ? '录制中' : currentHotkey ? '已设置' : '待设置' }}
              </span>
            </div>

            <button
              ref="inputField"
              type="button"
              class="hotkey-input-field"
              :class="{
                recording: isRecording,
                error: !!errorMessage,
                warning: !!conflictWarning,
                success: isValidHotkey
              }"
              :aria-label="isRecording ? '正在录制快捷键，请按下组合键' : currentHotkey ? `当前快捷键为 ${displayHotkey}` : '点击开始录制快捷键'"
              @click="startRecording"
              @keydown="handleKeyDown"
              @keyup="handleKeyUp"
            >
              <span v-if="!isRecording && !currentHotkey" class="placeholder">
                点击后按下快捷键组合
              </span>
              <span v-else-if="isRecording" class="recording-text">
                <el-icon class="recording-icon"><Loading /></el-icon>
                正在录制，请按下快捷键…
              </span>
              <span v-else class="hotkey-display">
                <kbd>{{ displayHotkey }}</kbd>
              </span>
            </button>
          </section>

          <div
            v-if="errorMessage || conflictWarning || isValidHotkey"
            class="hotkey-status"
            :class="{ error: !!errorMessage, warning: !!conflictWarning && !errorMessage, success: isValidHotkey }"
            :role="errorMessage ? 'alert' : 'status'"
            aria-live="polite"
          >
            <el-icon v-if="errorMessage"><WarningFilled /></el-icon>
            <el-icon v-else-if="conflictWarning"><Warning /></el-icon>
            <el-icon v-else><CircleCheckFilled /></el-icon>
            <span>{{ errorMessage || conflictWarning || '快捷键有效，可以使用' }}</span>
          </div>

          <section class="preset-section">
            <div class="section-heading preset-heading">
              <div>
                <h3>推荐快捷键</h3>
              </div>
              <span class="section-note">也可以直接录制</span>
            </div>
            <div class="preset-buttons">
              <button
                v-for="preset in recommendedHotkeys"
                :key="preset.value"
                type="button"
                class="preset-button"
                :class="{ selected: currentHotkey === preset.value }"
                :aria-label="preset.label"
                :aria-pressed="currentHotkey === preset.value"
                @click="selectPreset(preset.value)"
              >
                <span class="preset-label">{{ currentHotkey === preset.value ? '当前选择' : '使用' }}</span>
                <kbd>{{ preset.label }}</kbd>
              </button>
            </div>
          </section>

        </div>

        <footer class="dialog-footer">
          <button v-if="currentHotkey" class="clear-button" type="button" @click="clearHotkey"><Trash2 aria-hidden="true" />清除快捷键</button>
          <div class="dialog-actions">
            <button class="secondary-button" type="button" @click="handleCancel">取消</button>
            <button class="primary-button" type="button" :disabled="!canConfirm" @click="handleConfirm">确认</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts" name="CustomHotkeyInput">
import { ref, computed, nextTick, watch } from 'vue';
import { ElIcon } from 'element-plus';
import {
  CircleAlert as WarningFilled,
  CircleCheck as CircleCheckFilled,
  LoaderCircle as Loading,
  Trash2,
  TriangleAlert as Warning,
  X,
} from '@lucide/vue';
import { parseHotkey, validateHotkeyConflicts, type ParsedHotkey } from '@/src/core/hotkey';

// Props
interface Props {
  modelValue: boolean;
  currentValue?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currentValue: ''
});

// Emits
interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm', hotkey: string): void;
  (e: 'cancel'): void;
}

const emit = defineEmits<Emits>();

// 响应式数据
const dialogVisible = computed(() => props.modelValue);

const currentHotkey = ref(props.currentValue || '');
const isRecording = ref(false);
const pressedKeys = ref(new Set<string>());
const errorMessage = ref('');
const conflictWarning = ref('');
const inputField = ref<HTMLElement>();
const dialogRoot = ref<HTMLElement>();

// 解析当前快捷键
const parsedHotkey = computed<ParsedHotkey | null>(() => {
  if (!currentHotkey.value || currentHotkey.value === 'none') return null;
  return parseHotkey(currentHotkey.value);
});

const isValidHotkey = computed(() => Boolean(
  parsedHotkey.value?.isValid && !errorMessage.value && !conflictWarning.value,
));

const displayHotkey = computed(() => {
  if (currentHotkey.value === 'none') return '已禁用';
  return parsedHotkey.value?.displayName || currentHotkey.value;
});

// 检查是否可以确认
const canConfirm = computed(() => {
  return currentHotkey.value === 'none' || 
         Boolean(parsedHotkey.value?.isValid && !errorMessage.value);
});

// 推荐的快捷键
const recommendedHotkeys = [
  { value: 'Alt+T', label: 'Alt+T' },
  { value: 'Alt+Q', label: 'Alt+Q' },
  { value: 'Alt+D', label: 'Alt+D' },
  { value: 'F9', label: 'F9' },
  { value: 'F10', label: 'F10' },
];

// 监听当前值变化
watch(() => props.currentValue, (newValue) => {
  currentHotkey.value = newValue || '';
});

watch(dialogVisible, (visible) => {
  if (visible) {
    nextTick(() => dialogRoot.value?.focus({ preventScroll: true }));
  }
});

// 监听快捷键变化，进行验证
watch(currentHotkey, (newValue) => {
  validateCurrentHotkey(newValue);
});

// 验证当前快捷键
function validateCurrentHotkey(hotkeyString: string) {
  errorMessage.value = '';
  conflictWarning.value = '';
  
  if (!hotkeyString || hotkeyString === 'none') return;
  
  const parsed = parseHotkey(hotkeyString);
  
  if (!parsed.isValid) {
    errorMessage.value = parsed.errorMessage || '无效的快捷键';
    return;
  }
  
  // 检查冲突
  const conflictCheck = validateHotkeyConflicts(parsed);
  if (conflictCheck.hasConflict) {
    conflictWarning.value = conflictCheck.conflictDescription || '可能存在冲突';
  }
}

// 开始录制快捷键
async function startRecording() {
  if (isRecording.value) return;
  
  isRecording.value = true;
  pressedKeys.value.clear();
  errorMessage.value = '';
  conflictWarning.value = '';
  
  // 聚焦输入框
  await nextTick();
  inputField.value?.focus();
}

// 处理按键按下
function handleKeyDown(event: KeyboardEvent) {
  if (!isRecording.value) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  // 记录按下的键
  if (event.ctrlKey) pressedKeys.value.add('ctrl');
  if (event.altKey) pressedKeys.value.add('alt');
  if (event.shiftKey) pressedKeys.value.add('shift');
  if (event.metaKey) pressedKeys.value.add('meta');
  
  // 处理普通按键
  const key = event.key.toLowerCase();
  const code = event.code?.toLowerCase();
  
  // 忽略单独的修饰键
  if (['control', 'alt', 'shift', 'meta'].includes(key)) {
    return;
  }
  
  // 记录普通按键
  if (key.length === 1) {
    pressedKeys.value.add(key);
  } else if (code?.startsWith('key')) {
    pressedKeys.value.add(code.slice(3));
  } else if (/^f\d+$/.test(key)) {
    pressedKeys.value.add(key);
  } else {
    // 特殊键处理
    const specialKeys = {
      'escape': 'escape',
      'enter': 'enter',
      'space': 'space',
      'tab': 'tab',
      'backspace': 'backspace',
      'delete': 'delete',
      'arrowup': 'arrowup',
      'arrowdown': 'arrowdown',
      'arrowleft': 'arrowleft',
      'arrowright': 'arrowright'
    };
    
    if (specialKeys[key as keyof typeof specialKeys]) {
      pressedKeys.value.add(specialKeys[key as keyof typeof specialKeys]);
    }
  }
}

// 处理按键释放
function handleKeyUp(event: KeyboardEvent) {
  if (!isRecording.value) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  // 延迟一点再生成快捷键，确保所有键都被记录
  setTimeout(() => {
    if (pressedKeys.value.size > 0) {
      generateHotkeyFromKeys();
    }
  }, 100);
}

// 从按键生成快捷键字符串
function generateHotkeyFromKeys() {
  const modifiers: string[] = [];
  let regularKey = '';
  
  // 提取修饰键
  if (pressedKeys.value.has('ctrl')) modifiers.push('Ctrl');
  if (pressedKeys.value.has('alt')) modifiers.push('Alt');
  if (pressedKeys.value.has('shift')) modifiers.push('Shift');
  if (pressedKeys.value.has('meta')) modifiers.push('Meta');
  
  // 提取普通按键（找到最后一个非修饰键）
  for (const key of pressedKeys.value) {
    if (!['ctrl', 'alt', 'shift', 'meta'].includes(key)) {
      regularKey = key.toUpperCase();
    }
  }
  
  if (regularKey) {
    currentHotkey.value = [...modifiers, regularKey].join('+');
  }
  
  isRecording.value = false;
  pressedKeys.value.clear();
}

// 选择预设快捷键
function selectPreset(value: string) {
  currentHotkey.value = value;
  isRecording.value = false;
  pressedKeys.value.clear();
}

// 清除快捷键
function clearHotkey() {
  currentHotkey.value = '';
  isRecording.value = false;
  pressedKeys.value.clear();
  errorMessage.value = '';
  conflictWarning.value = '';
}

// 确认
function handleConfirm() {
  if (!canConfirm.value) return;
  
  emit('confirm', currentHotkey.value);
  emit('update:modelValue', false);
}

// 取消
function handleCancel() {
  currentHotkey.value = props.currentValue || '';
  isRecording.value = false;
  pressedKeys.value.clear();
  errorMessage.value = '';
  conflictWarning.value = '';
  emit('cancel');
  emit('update:modelValue', false);
}
</script>

<style scoped>
.custom-hotkey-overlay {
  position: fixed;
  z-index: 3000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 20px;
  background: var(--mask);
  font-family: inherit;
}

.custom-hotkey-dialog {
  display: flex;
  width: min(560px, 100%);
  max-height: min(760px, calc(100vh - 32px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-overlay);
  outline: none;
  background: var(--surface);
  box-shadow: var(--el-box-shadow);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.dialog-heading,
.section-heading {
  min-width: 0;
}

.dialog-heading h2,
.section-heading h3 {
  margin: 0;
  color: var(--ink);
  letter-spacing: -.03em;
}

.dialog-heading h2 {
  font-size: var(--font-title);
  line-height: var(--line-height-tight);
}

.dialog-heading p {
  max-width: 410px;
  margin: 5px 0 0;
  color: var(--muted);
  font-size: var(--font-small);
  line-height: var(--line-height-body);
}

.dialog-close {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  margin: -4px -6px 0 0;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
  line-height: 1;
  transition: color 160ms ease, background 160ms ease, border-color 160ms ease;
}

.dialog-close svg {
  width: 18px;
  height: 18px;
}

.dialog-close:hover,
.dialog-close:focus-visible {
  border-color: var(--el-color-primary-light-7);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.dialog-body {
  display: grid;
  gap: 14px;
  min-height: 0;
  padding: 18px 22px;
  overflow-y: auto;
}

.recording-card {
  display: grid;
  gap: 12px;
  padding: 0 0 16px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
}

.recording-card.is-recording {
  border-color: var(--el-color-primary-light-5);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-heading h3 {
  font-size: var(--font-subtitle);
  line-height: var(--line-height-tight);
}

.state-badge {
  flex: 0 0 auto;
  padding: 5px 9px;
  border-radius: 6px;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: var(--font-caption);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.state-badge.active,
.state-badge.ready {
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.hotkey-input-field {
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 14px 18px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-control);
  color: var(--muted);
  background: var(--surface-soft);
  cursor: pointer;
  font: inherit;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.hotkey-input-field:hover {
  border-color: var(--el-color-primary-light-3);
  color: var(--brand-strong);
  background: var(--surface);
}

.hotkey-input-field:focus-visible {
  border-color: var(--brand);
  outline: 3px solid var(--brand-soft);
  outline-offset: 2px;
}

.hotkey-input-field.recording {
  border-style: solid;
  border-color: var(--brand);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.hotkey-input-field.error {
  border-style: solid;
  border-color: var(--danger-border);
  color: var(--danger);
  background: var(--danger-soft);
}

.hotkey-input-field.warning {
  border-style: solid;
  border-color: var(--warning-border);
  color: var(--warning);
  background: var(--warning-soft);
}

.hotkey-input-field.success {
  border-style: solid;
  border-color: var(--success-border);
  color: var(--success);
  background: var(--success-soft);
}

.placeholder {
  font-size: var(--font-body);
}

.recording-text {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-body);
  font-weight: var(--weight-medium);
}

.recording-icon {
  animation: hotkey-spin 1s linear infinite;
}

@keyframes hotkey-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.hotkey-display kbd,
.preset-button kbd {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height-small);
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 6px;
  color: var(--ink);
  background: var(--surface);
  font-family: 'SFMono-Regular', 'SF Mono', 'Cascadia Code', 'Roboto Mono', monospace;
  font-size: var(--font-body);
  font-weight: var(--weight-semibold);
  letter-spacing: .02em;
}

.hotkey-display kbd {
  padding: 8px 15px;
  border-color: var(--el-color-primary-light-5);
  color: var(--brand-strong);
  background: var(--brand-soft);
  font-size: var(--font-subtitle);
}

.section-note {
  color: var(--muted);
  font-size: var(--font-small);
  line-height: var(--line-height-body);
  padding-top: 2px;
  white-space: nowrap;
}

.hotkey-status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid;
  border-radius: var(--radius-control);
  font-size: var(--font-small);
  line-height: var(--line-height-body);
}

.hotkey-status.error {
  border-color: var(--danger-border);
  color: var(--danger);
  background: var(--danger-soft);
}

.hotkey-status.warning {
  border-color: var(--warning-border);
  color: var(--warning);
  background: var(--warning-soft);
}

.hotkey-status.success {
  border-color: var(--success-border);
  color: var(--success);
  background: var(--success-soft);
}

.preset-section {
  display: grid;
  gap: 10px;
}

.preset-buttons {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.preset-button {
  display: flex;
  min-height: 50px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  color: var(--muted);
  background: var(--surface);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
}

.preset-button:hover,
.preset-button:focus-visible {
  border-color: var(--el-color-primary-light-3);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.preset-button.selected {
  border-color: var(--el-color-primary-light-5);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.preset-button kbd {
  flex: 0 0 auto;
  color: var(--ink);
  font-size: var(--font-small);
}

.preset-button.selected kbd {
  border-color: var(--el-color-primary-light-5);
  color: var(--brand-strong);
}

.preset-label {
  overflow: hidden;
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}

.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-left: auto;
}

.clear-button,
.secondary-button,
.primary-button {
  min-height: var(--control-height);
  padding: 0 16px;
  border-radius: var(--radius-control);
  cursor: pointer;
  font: inherit;
  font-size: var(--font-small);
  font-weight: var(--weight-semibold);
  transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
}

.clear-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  color: var(--danger);
  background: transparent;
}

.clear-button svg {
  width: 15px;
  height: 15px;
}

.clear-button:hover,
.clear-button:focus-visible {
  color: var(--danger);
  text-decoration: underline;
}

.secondary-button {
  border: 1px solid var(--line);
  color: var(--ink);
  background: var(--surface);
}

.secondary-button:hover,
.secondary-button:focus-visible {
  border-color: var(--el-border-color-dark);
  background: var(--surface-soft);
}

.primary-button {
  border: 1px solid var(--brand);
  color: var(--on-brand);
  background: var(--brand);
}

.primary-button:hover:not(:disabled),
.primary-button:focus-visible:not(:disabled) {
  border-color: var(--brand-strong);
  background: var(--brand-strong);
}

.primary-button:disabled {
  border-color: var(--line);
  color: var(--muted);
  background: var(--surface-soft);
  box-shadow: none;
  cursor: not-allowed;
}

@media (max-width: 560px) {
  .custom-hotkey-overlay {
    align-items: flex-start;
    padding: 14px;
  }

  .custom-hotkey-dialog {
    max-height: calc(100vh - 28px);
    border-radius: 14px;
  }

  .dialog-header {
    padding: 18px 20px 14px;
  }

  .dialog-body {
    padding: 16px 20px;
  }

  .preset-buttons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dialog-footer {
    padding: 13px 20px 16px;
  }
}

@media (max-width: 380px) {
  .custom-hotkey-overlay {
    padding: 8px;
  }

  .custom-hotkey-dialog {
    max-height: calc(100vh - 16px);
  }

  .dialog-header,
  .dialog-body,
  .dialog-footer {
    padding-right: 15px;
    padding-left: 15px;
  }

  .section-note {
    display: none;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .dialog-actions {
    width: 100%;
  }

  .secondary-button,
  .primary-button {
    flex: 1 1 0;
  }

  .clear-button {
    align-self: flex-start;
  }
}
</style>
