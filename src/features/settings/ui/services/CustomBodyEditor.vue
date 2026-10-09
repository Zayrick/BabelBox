<template>
  <div class="custom-body-editor" :class="{ 'is-invalid': invalid }">
    <div class="custom-body-toolbar">
      <span>自定义请求体</span>
      <el-tooltip content="Shift+Alt+F" :show-after="300" placement="top">
        <el-button type="primary" link size="small" :disabled="!formattable" @click="formatDocument()">
          <el-icon><Braces /></el-icon>格式化
        </el-button>
      </el-tooltip>
    </div>
    <div ref="host" class="custom-body-editor-host" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Braces } from '@lucide/vue'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { type Diagnostic, linter, lintGutter, lintKeymap } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { isValidCustomBody } from '@/src/core/config/customBody'

const props = withDefaults(defineProps<{
  modelValue: string
  invalid?: boolean
}>(), {
  invalid: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const host = ref<HTMLElement>()
let view: EditorView | undefined

const formattable = computed(() => parseJson(props.modelValue) !== undefined)

function parseJson(text: string): { value: unknown } | undefined {
  if (!text.trim()) return undefined
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

// 重新序列化不会改变实际请求：发送前同样经过 JSON.parse。
function formatDocument(target: EditorView | undefined = view): boolean {
  if (!target) return false
  const text = target.state.doc.toString()
  const parsed = parseJson(text)
  if (!parsed) return false
  const formatted = JSON.stringify(parsed.value, null, 2)
  if (formatted !== text) {
    target.dispatch({
      changes: { from: 0, to: target.state.doc.length, insert: formatted },
      userEvent: 'input.format',
    })
  }
  return true
}

const syntaxLinter = jsonParseLinter()

function customBodyLinter(target: EditorView): Diagnostic[] {
  const text = target.state.doc.toString()
  if (!text.trim()) return []
  const syntaxErrors = syntaxLinter(target)
  if (syntaxErrors.length) return syntaxErrors
  if (isValidCustomBody(text)) return []
  return [{ from: 0, to: target.state.doc.length, severity: 'error', message: '顶层必须是 JSON 对象' }]
}

// 颜色取自组件 CSS 变量，随扩展页明暗主题切换。
const highlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--babelbox-code-property)' },
  { tag: tags.string, color: 'var(--babelbox-code-string)' },
  { tag: tags.number, color: 'var(--babelbox-code-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--babelbox-code-keyword)' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: 'var(--muted)' },
])

const editorTheme = EditorView.theme({
  '&': {
    maxHeight: '320px',
    color: 'var(--ink)',
    backgroundColor: 'var(--el-fill-color-blank)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { minHeight: '84px', caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': {
    color: 'var(--muted)',
    backgroundColor: 'var(--surface-soft)',
    borderRight: '1px solid var(--line)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--brand) 6%, transparent)' },
  '.cm-activeLineGutter': { color: 'var(--ink)', backgroundColor: 'color-mix(in srgb, var(--brand) 10%, transparent)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--brand) 22%, transparent)',
  },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--brand) 18%, transparent)', outline: 'none' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-tooltip': {
    color: 'var(--ink)',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-control)',
  },
})

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        EditorState.tabSize.of(2),
        indentUnit.of('  '),
        EditorView.lineWrapping,
        json(),
        syntaxHighlighting(highlightStyle),
        linter(customBodyLinter, { delay: 300 }),
        lintGutter(),
        placeholder('JSON 对象，如 {"temperature": 0}'),
        EditorView.contentAttributes.of({ 'aria-label': '自定义请求体' }),
        keymap.of([
          { key: 'Shift-Alt-f', run: formatDocument, preventDefault: true },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
  })
})

// 切换服务实例或重置配置时，外部值会整体替换编辑器内容。
watch(() => props.modelValue, (value) => {
  if (!view || value === view.state.doc.toString()) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = undefined
})
</script>

<style scoped>
.custom-body-editor {
  --babelbox-code-property: #0a5fb4;
  --babelbox-code-string: #1a7f37;
  --babelbox-code-number: #b35900;
  --babelbox-code-keyword: #8250df;
  display: grid;
  gap: 8px;
}

:root.dark .custom-body-editor {
  --babelbox-code-property: #79c0ff;
  --babelbox-code-string: #7ee787;
  --babelbox-code-number: #ffa657;
  --babelbox-code-keyword: #d2a8ff;
}

.custom-body-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.custom-body-toolbar .el-icon {
  margin-right: 4px;
}

.custom-body-editor-host {
  overflow: hidden;
  border-radius: var(--radius-control);
  border: 1px solid var(--el-border-color);
  font-weight: normal;
}

.custom-body-editor-host:hover {
  border-color: var(--el-border-color-hover);
}

.custom-body-editor-host:focus-within {
  border-color: var(--el-color-primary);
}

.is-invalid .custom-body-editor-host {
  border-color: var(--el-color-danger);
}
</style>
