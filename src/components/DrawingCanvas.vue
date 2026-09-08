<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DrawingAction, Point } from '../types/drawing'

const props = withDefaults(
  defineProps<{
    modelValue?: DrawingAction[]
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
const tool = ref<'brush' | 'eraser' | 'line' | 'rectangle' | 'circle' | 'fill'>('brush')
const filled = ref(false)
const actions = ref<DrawingAction[]>([...props.modelValue])
const redoStack = ref<DrawingAction[]>([])
const currentColor = ref(props.color)
const currentLineWidth = ref(props.lineWidth)
const preview = ref<DrawingAction | null>(null)
const isDrawing = ref(false)
const startPoint = ref<Point | null>(null)
let resizeObserver: ResizeObserver | undefined
let actionCounter = 0

function isShape(action: DrawingAction): action is Extract<DrawingAction, { start: Point; end: Point }> {
  return action.type === 'line' || action.type === 'rectangle' || action.type === 'circle'
}

const toolLabel = computed(() => tool.value.charAt(0).toUpperCase() + tool.value.slice(1))

function makeId() {
  actionCounter += 1
  return `drawing-${Date.now()}-${actionCounter}`
}

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

function pointFromEvent(event: PointerEvent): Point {
  const bounds = canvas.value!.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  }
}

function toPixels(point: Point) {
  return { x: point.x * props.width, y: point.y * props.height }
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

function begin(event: PointerEvent) {
  if (props.readonly) return
  event.preventDefault()
  canvas.value?.setPointerCapture(event.pointerId)
  isDrawing.value = true
  const point = pointFromEvent(event)
  startPoint.value = point
  if (tool.value === 'fill') {
    commit({ id: makeId(), type: 'fill', point, color: currentColor.value })
  } else if (tool.value === 'brush' || tool.value === 'eraser') {
    updatePreview({ id: makeId(), type: tool.value === 'eraser' ? 'eraser' : 'stroke', points: [point], color: currentColor.value, width: currentLineWidth.value })
  }
}

function move(event: PointerEvent) {
  if (!isDrawing.value || !startPoint.value || tool.value === 'fill') return
  const point = pointFromEvent(event)
  if (tool.value === 'brush' || tool.value === 'eraser') {
    const current = preview.value
    if (current && (current.type === 'stroke' || current.type === 'eraser')) updatePreview({ ...current, points: [...current.points, point] })
  } else {
    updatePreview({ id: preview.value?.id ?? makeId(), type: tool.value, start: startPoint.value, end: point, color: currentColor.value, width: currentLineWidth.value, filled: filled.value } as DrawingAction)
  }
}

function end(event: PointerEvent) {
  if (!isDrawing.value) return
  event.preventDefault()
  canvas.value?.releasePointerCapture(event.pointerId)
  isDrawing.value = false
  if (preview.value) commit(preview.value)
  startPoint.value = null
  updatePreview(null)
}

function updatePreview(value: DrawingAction | null) {
  preview.value = value
  redraw()
  emit('preview', value)
}

function commit(action: DrawingAction) {
  actions.value = [...actions.value, action]
  redoStack.value = []
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function undo() {
  const action = actions.value.at(-1)
  if (!action) return
  actions.value = actions.value.slice(0, -1)
  redoStack.value = [...redoStack.value, action]
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function redo() {
  const action = redoStack.value.at(-1)
  if (!action) return
  redoStack.value = redoStack.value.slice(0, -1)
  actions.value = [...actions.value, action]
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function clear() {
  if (!actions.value.length) return
  redoStack.value = [...redoStack.value, ...actions.value].reverse()
  actions.value = []
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

function reset() {
  redoStack.value = []
  actions.value = []
  updatePreview(null)
  emit('update:modelValue', actions.value)
  emit('change', actions.value)
  redraw()
}

defineExpose({ undo, redo, clear, reset, redraw, getActions: () => actions.value })

watch(() => props.modelValue, (value) => {
  if (value !== actions.value) {
    actions.value = [...(value ?? [])]
    redraw()
  }
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
      <button v-for="item in ['brush', 'eraser', 'line', 'rectangle', 'circle', 'fill']" :key="item" type="button" :class="{ active: tool === item }" @click="tool = item as typeof tool">{{ item }}</button>
      <label v-if="tool === 'rectangle' || tool === 'circle'" class="fill-toggle"><input v-model="filled" type="checkbox" /> Filled</label>
      <input v-model="currentColor" type="color" aria-label="Drawing color" />
      <label class="width-control">Size <input v-model.number="currentLineWidth" type="range" min="1" max="32" /></label>
      <button type="button" :disabled="!actions.length" @click="undo">Undo</button>
      <button type="button" :disabled="!redoStack.length" @click="redo">Redo</button>
      <button type="button" :disabled="!actions.length" @click="clear">Clear</button>
    </div>
    <canvas ref="canvas" :aria-label="`${toolLabel} drawing canvas`" @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="end" />
  </div>
</template>
