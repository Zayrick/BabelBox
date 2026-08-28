import {
  onBeforeUnmount,
  onMounted,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import {resolvesToDarkTheme} from '@/src/ui/theme/theme'

/** 统一 extension page 的 html.dark 状态，供 Element Plus 官方暗色变量使用。 */
export function useDocumentTheme(theme: MaybeRefOrGetter<string | undefined>): Readonly<Ref<boolean>> {
  const isDark = ref(false)
  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined

  const applyTheme = () => {
    const nextDark = resolvesToDarkTheme(toValue(theme), media?.matches ?? false)
    isDark.value = nextDark
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('dark', nextDark)
  }

  const stopThemeWatch = watch(() => toValue(theme), applyTheme, {immediate: true})

  onMounted(() => {
    media?.addEventListener('change', applyTheme)
  })

  onBeforeUnmount(() => {
    stopThemeWatch()
    media?.removeEventListener('change', applyTheme)
  })

  return readonly(isDark)
}
