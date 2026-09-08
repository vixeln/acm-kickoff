<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { Brush, Circle, CircleDot, Eraser, Minus, PaintBucket, Redo2, Square, Trash2, Undo2 } from '@lucide/vue'
import { useDrawingHistory } from '../composables/drawing/useDrawingHistory'
import { useDrawingPointer } from '../composables/drawing/useDrawingPointer'
import { useDrawingTools, type DrawingTool } from '../composables/drawing/useDrawingTools'
import type { DrawingAction, Point } from '../types/drawing'

const props = withDefaults(
  defineProps<{
    modelValue?: DrawingAction[]
    preview?: DrawingAction | null
    width?: number
    height?: number
    color?: string
    lineWidth?: number
    readonly?: boolean
  }>(),
  { modelValue: () => [], width: 900, height: 600, color: '#202124', lineWidth: 5, readonly: false },
)

const emit = defineEmits<{
  'update:modelValue': [DrawingAction[]]
  change: [DrawingAction[]]
  preview: [DrawingAction | null]
}>()

const canvas = ref<HTMLCanvasElement>()
const history = useDrawingHistory(props.modelValue)
const { actions, redoStack } = history
const currentColor = ref(props.color)
const currentLineWidth = ref(props.lineWidth)
const canvasWidth = computed(() => props.width)
const canvasHeight = computed(() => props.height)
const pointer = useDrawingPointer(canvas, canvasWidth, canvasHeight)
const { toPixels } = pointer
const tools = useDrawingTools({
  canvas,
  color: currentColor,
  lineWidth: currentLineWidth,
  readonly: computed(() => props.readonly),
  pointFromEvent: pointer.pointFromEvent,
  onCommit: (action) => commit(action),
  onPreview: (action) => updatePreview(action),
})
const { tool, preview } = tools
const presetColors = [
  '#202124', '#ffffff', '#a23b2a', '#d65a31',
  '#f3c969', '#218c4c', '#4267d5', '#7b61a8',
  '#e87ea1', '#8b5e3c', '#85878b', '#d8d4cb',
]
const customColors = ref<string[]>([])
const customColor = ref(currentColor.value)
const toolButtons: Array<{ value: DrawingTool; label: string; icon: Component }> = [
  { value: 'brush', label: 'Brush', icon: Brush },
  { value: 'eraser', label: 'Eraser', icon: Eraser },
  { value: 'rectangle', label: 'Rectangle', icon: Square },
  { value: 'filledRectangle', label: 'Filled rectangle', icon: Square },
  { value: 'circle', label: 'Circle', icon: Circle },
  { value: 'filledCircle', label: 'Filled circle', icon: CircleDot },
  { value: 'line', label: 'Line', icon: Minus },
  { value: 'fill', label: 'Fill', icon: PaintBucket },
]
let resizeObserver: ResizeObserver | undefined

function selectCustomColor(color: string) {
  const normalized = color.toLowerCase()
  currentColor.value = normalized
  customColor.value = normalized
  if (presetColors.includes(normalized) || customColors.value.includes(normalized)) return
  customColors.value = [...customColors.value.slice(-3), normalized]
}

function selectCustomSlot(index: number) {
  const color = customColors.value[index]
  if (color) currentColor.value = color
}

function isShape(action: DrawingAction): action is Extract<DrawingAction, { start: Point; end: Point }> {
  return action.type === 'line' || action.type === 'rectangle' || action.type === 'circle'
}

const toolLabel = computed(() => tool.value.charAt(0).toUpperCase() + tool.value.slice(1))

function context() {
  return canvas.value?.getContext('2d') ?? null
}

function resize() {
  const element = canvas.value
  if (!element) return
  const ratio = window.devicePixelRatio || 1
  element.width = props.width * ratio
  element.height = props.height * ratio
  element.style.aspectRatio = `${props.width} / ${props.height}`
  context()?.setTransform(ratio, 0, 0, ratio, 0, 0)
  redraw()
}

function styleFor(action: DrawingAction) {
  const ctx = context()!
  ctx.lineWidth = 'width' in action ? action.width : currentLineWidth.value
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'color' in action ? action.color : currentColor.value
  ctx.fillStyle = 'color' in action ? action.color : currentColor.value
}

function drawAction(action: DrawingAction) {
  const ctx = context()
  if (!ctx) return
  styleFor(action)
  if (action.type === 'fill') {
    floodFill(toPixels(action.point), action.color)
    return
  }
  if (action.type === 'stroke' || action.type === 'eraser') {
    if (!action.points.length) return
    ctx.save()
    if (action.type === 'eraser') ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    const firstPoint = action.points[0]
    if (!firstPoint) return
    const first = toPixels(firstPoint)
    ctx.moveTo(first.x, first.y)
    action.points.slice(1).forEach((point) => {
      const next = toPixels(point)
      ctx.lineTo(next.x, next.y)
    })
    if (action.points.length === 1) ctx.lineTo(first.x + 0.01, first.y)
    ctx.stroke()
    ctx.restore()
    return
  }
  if (!isShape(action)) return
  const start = toPixels(action.start)
  const end = toPixels(action.end)
  ctx.beginPath()
  if (action.type === 'line') {
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
  } else if (action.type === 'rectangle') {
    const width = end.x - start.x
    const height = end.y - start.y
    action.filled ? ctx.fillRect(start.x, start.y, width, height) : ctx.strokeRect(start.x, start.y, width, height)
  } else {
    const radius = Math.hypot(end.x - start.x, end.y - start.y)
    ctx.arc(start.x, start.y, radius, 0, Math.PI * 2)
    action.filled ? ctx.fill() : ctx.stroke()
  }
}

function redraw() {
  const ctx = context()
  if (!ctx) return
  ctx.clearRect(0, 0, props.width, props.height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, props.width, props.height)
  actions.value.forEach(drawAction)
  if (preview.value) drawAction(preview.value)
}

function floodFill(point: { x: number; y: number }, color: string) {
  const ctx = context()
  if (!ctx) return
  const pixelWidth = canvas.value?.width ?? props.width
  const pixelHeight = canvas.value?.height ?? props.height
  const image = ctx.getImageData(0, 0, pixelWidth, pixelHeight)
  const pixelX = Math.max(0, Math.min(pixelWidth - 1, Math.floor((point.x / props.width) * pixelWidth)))
  const pixelY = Math.max(0, Math.min(pixelHeight - 1, Math.floor((point.y / props.height) * pixelHeight)))
  const target = (pixelY * pixelWidth + pixelX) * 4
  const original = image.data.slice(target, target + 4)
  const replacement = hexToRgba(color)
  if (original.every((value, index) => value === replacement[index])) return
  const stack: Array<[number, number]> = [[pixelX, pixelY]]
  const matches = (x: number, y: number) => {
    const i = (y * pixelWidth + x) * 4
    return image.data[i] === original[0] && image.data[i + 1] === original[1] && image.data[i + 2] === original[2] && image.data[i + 3] === original[3]
  }
  while (stack.length) {
    const next = stack.pop()
    if (!next) continue
    const [x, y] = next
    if (x < 0 || y < 0 || x >= pixelWidth || y >= pixelHeight || !matches(x, y)) continue
    const i = (y * pixelWidth + x) * 4
    replacement.forEach((value, index) => (image.data[i + index] = value))
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  ctx.putImageData(image, 0, 0)
}

function hexToRgba(value: string) {
  const hex = value.replace('#', '')
  const normalized = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex
  return [parseInt(normalized.slice(0, 2), 16), parseInt(normalized.slice(2, 4), 16), parseInt(normalized.slice(4, 6), 16), 255]
}

function updatePreview(value: DrawingAction | null) {
  preview.value = value
  redraw()
  emit('preview', value)
}

function commit(action: DrawingAction) {
  history.commit(action)
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function undo() {
  history.undo()
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function redo() {
  history.redo()
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function clear() {
  history.clear()
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function reset() {
  history.reset()
  updatePreview(null)
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

defineExpose({ undo, redo, clear, reset, redraw, getActions: () => actions.value })

watch(() => props.modelValue, (value) => {
  if (value !== actions.value) {
    history.replace(value ?? [])
    redraw()
  }
}, { deep: true })

watch(() => props.preview, (value) => {
  preview.value = value ?? null
  redraw()
}, { deep: true })

onMounted(async () => {
  await nextTick()
  resize()
  resizeObserver = new ResizeObserver(resize)
  if (canvas.value) resizeObserver.observe(canvas.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="drawing-canvas" :style="{ '--canvas-width': `${width}px` }">
    <div v-if="!readonly" class="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
      <div class="toolbar-section tool-selection" aria-label="Tool selection">
        <button v-for="item in toolButtons" :key="item.value" type="button" :class="{ active: tool === item.value }" :aria-label="item.label" :title="item.label" @click="tool = item.value">
          <component :is="item.icon" :size="18" :stroke-width="2" aria-hidden="true" />
          <span class="sr-only">{{ item.label }}</span>
        </button>
        <div class="history-controls">
          <button type="button" aria-label="Undo" title="Undo" :disabled="!actions.length" @click="undo"><Undo2 :size="18" :stroke-width="2" aria-hidden="true" /><span class="sr-only">Undo</span></button>
          <button type="button" aria-label="Redo" title="Redo" :disabled="!redoStack.length" @click="redo"><Redo2 :size="18" :stroke-width="2" aria-hidden="true" /><span class="sr-only">Redo</span></button>
          <button type="button" aria-label="Clear canvas" title="Clear canvas" :disabled="!actions.length" @click="clear"><Trash2 :size="18" :stroke-width="2" aria-hidden="true" /><span class="sr-only">Clear</span></button>
        </div>
      </div>
      <div class="toolbar-section tool-settings" aria-label="Tool settings">
        <div class="color-palette" role="group" aria-label="Preset colors">
          <button
            v-for="color in presetColors"
            :key="color"
            type="button"
            class="color-swatch"
            :class="{ active: currentColor.toLowerCase() === color }"
            :style="{ '--swatch-color': color }"
            :aria-label="`Use ${color}`"
            :title="color"
            @click="currentColor = color"
          ></button>
          <template v-for="slot in 4" :key="`custom-slot-${slot}`">
            <button
              v-if="customColors[slot - 1]"
              type="button"
              class="color-swatch custom-swatch"
              :class="{ active: currentColor.toLowerCase() === customColors[slot - 1] }"
              :style="{ '--swatch-color': customColors[slot - 1] }"
              :aria-label="`Use custom color ${customColors[slot - 1]}`"
              :title="customColors[slot - 1]"
              @click="selectCustomSlot(slot - 1)"
            ></button>
            <span v-else class="custom-slot" aria-hidden="true"></span>
          </template>
        </div>
        <label class="custom-color-row">
          <span>Custom</span>
          <input v-model="customColor" type="color" aria-label="Custom drawing color" @change="selectCustomColor(customColor)" />
          <span class="color-value">{{ currentColor }}</span>
        </label>
        <label class="width-control">Size <input v-model.number="currentLineWidth" type="range" min="1" max="32" /></label>
      </div>
    </div>
    <canvas ref="canvas" :aria-label="`${toolLabel} drawing canvas`" @pointerdown="tools.begin" @pointermove="tools.move" @pointerup="tools.end" @pointercancel="tools.end" />
  </div>
</template>
