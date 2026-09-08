<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const toolButtons: Array<{ value: DrawingTool; label: string }> = [
  { value: 'brush', label: 'Brush' },
  { value: 'eraser', label: 'Eraser' },
  { value: 'line', label: 'Line' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'filledRectangle', label: 'Filled rectangle' },
  { value: 'circle', label: 'Circle' },
  { value: 'filledCircle', label: 'Filled circle' },
  { value: 'fill', label: 'Fill' },
]
let resizeObserver: ResizeObserver | undefined

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
      <button v-for="item in toolButtons" :key="item.value" type="button" :class="{ active: tool === item.value }" @click="tool = item.value">{{ item.label }}</button>
      <input v-model="currentColor" type="color" aria-label="Drawing color" />
      <label class="width-control">Size <input v-model.number="currentLineWidth" type="range" min="1" max="32" /></label>
      <button type="button" :disabled="!actions.length" @click="undo">Undo</button>
      <button type="button" :disabled="!redoStack.length" @click="redo">Redo</button>
      <button type="button" :disabled="!actions.length" @click="clear">Clear</button>
    </div>
    <canvas ref="canvas" :aria-label="`${toolLabel} drawing canvas`" @pointerdown="tools.begin" @pointermove="tools.move" @pointerup="tools.end" @pointercancel="tools.end" />
  </div>
</template>
