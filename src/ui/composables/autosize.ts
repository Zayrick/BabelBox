import type { Directive } from 'vue'

interface AutosizeState {
  observer: ResizeObserver | null
  width: number
}

const states = new WeakMap<HTMLTextAreaElement, AutosizeState>()

/** 高度随内容增长，CSS 的 min-height 即最小高度；用户不能手动拖拽。 */
function fit(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  const borders = el.offsetHeight - el.clientHeight
  el.style.height = `${el.scrollHeight + borders}px`
}

export const vAutosize: Directive<HTMLTextAreaElement> = {
  mounted(el) {
    el.style.resize = 'none'
    el.style.overflowY = 'hidden'
    const state: AutosizeState = { observer: null, width: -1 }
    // 宽度变化（换行变化）或从折叠容器中展开时重新计算。
    if (typeof ResizeObserver !== 'undefined') {
      state.observer = new ResizeObserver(() => {
        const width = el.clientWidth
        if (width === state.width) return
        state.width = width
        fit(el)
      })
      state.observer.observe(el)
    }
    el.addEventListener('input', () => fit(el))
    states.set(el, state)
    fit(el)
  },
  updated(el) {
    fit(el)
  },
  unmounted(el) {
    states.get(el)?.observer?.disconnect()
    states.delete(el)
  },
}
