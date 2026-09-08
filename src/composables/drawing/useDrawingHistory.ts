import { ref } from 'vue'
import type { DrawingAction } from '../../types/drawing'

export function useDrawingHistory(initial: DrawingAction[] = []) {
  const actions = ref<DrawingAction[]>([...initial])
  const redoStack = ref<DrawingAction[]>([])

  function commit(action: DrawingAction) {
    actions.value = [...actions.value, action]
    redoStack.value = []
  }

  function undo() {
    const action = actions.value.at(-1)
    if (!action) return
    actions.value = actions.value.slice(0, -1)
    redoStack.value = [...redoStack.value, action]
  }

  function redo() {
    const action = redoStack.value.at(-1)
    if (!action) return
    redoStack.value = redoStack.value.slice(0, -1)
    actions.value = [...actions.value, action]
  }

  function clear() {
    if (!actions.value.length) return
    redoStack.value = [...actions.value].reverse()
    actions.value = []
  }

  function reset() {
    actions.value = []
    redoStack.value = []
  }

  function replace(next: DrawingAction[]) {
    actions.value = [...next]
    redoStack.value = []
  }

  return { actions, redoStack, commit, undo, redo, clear, reset, replace }
}
