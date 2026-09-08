import { ref, type Ref } from 'vue'
import type { DrawingAction, Point } from '../../types/drawing'
import { useBrushTool } from './useBrushTool'
import { useCircleTool } from './useCircleTool'
import { useEraserTool } from './useEraserTool'
import { useFillTool } from './useFillTool'
import { useLineTool } from './useLineTool'
import { useRectangleTool } from './useRectangleTool'

export type DrawingTool = 'brush' | 'eraser' | 'line' | 'rectangle' | 'circle' | 'fill'

type DrawingToolOptions = {
  canvas: Ref<HTMLCanvasElement | undefined>
  color: Ref<string>
  lineWidth: Ref<number>
  readonly: Ref<boolean>
  pointFromEvent: (event: PointerEvent) => Point
  onCommit: (action: DrawingAction) => void
  onPreview: (action: DrawingAction | null) => void
}

export function useDrawingTools(options: DrawingToolOptions) {
  const brush = useBrushTool()
  const eraser = useEraserTool()
  const line = useLineTool()
  const rectangle = useRectangleTool()
  const circle = useCircleTool()
  const fill = useFillTool()
  const tool = ref<DrawingTool>('brush')
  const filled = ref(false)
  const preview = ref<DrawingAction | null>(null)
  const startPoint = ref<Point | null>(null)
  const isDrawing = ref(false)
  let actionCounter = 0

  function makeId() {
    actionCounter += 1
    return `drawing-${Date.now()}-${actionCounter}`
  }

  function updatePreview(action: DrawingAction | null) {
    preview.value = action
    options.onPreview(action)
  }

  function begin(event: PointerEvent) {
    if (options.readonly.value) return
    event.preventDefault()
    options.canvas.value?.setPointerCapture(event.pointerId)
    isDrawing.value = true
    const point = options.pointFromEvent(event)
    startPoint.value = point

    if (tool.value === 'fill') {
      options.onCommit(fill.createAction(makeId(), point, options.color.value))
    } else if (tool.value === 'brush' || tool.value === 'eraser') {
      updatePreview(tool.value === 'eraser'
        ? eraser.start(makeId(), point, options.lineWidth.value)
        : brush.start(makeId(), point, options.color.value, options.lineWidth.value))
    }
  }

  function move(event: PointerEvent) {
    if (!isDrawing.value || !startPoint.value || tool.value === 'fill') return
    const point = options.pointFromEvent(event)

    if (tool.value === 'brush' || tool.value === 'eraser') {
      const current = preview.value
      if (current && (current.type === 'stroke' || current.type === 'eraser')) {
        updatePreview(current.type === 'eraser'
          ? eraser.append(current as ReturnType<typeof eraser.start>, point)
          : brush.append(current as ReturnType<typeof brush.start>, point))
      }
      return
    }

    const id = preview.value?.id ?? makeId()
    const shape = tool.value === 'line'
      ? line.preview(id, startPoint.value, point, options.color.value, options.lineWidth.value)
      : tool.value === 'rectangle'
        ? rectangle.preview(id, startPoint.value, point, options.color.value, options.lineWidth.value, filled.value)
        : circle.preview(id, startPoint.value, point, options.color.value, options.lineWidth.value, filled.value)
    updatePreview(shape)
  }

  function end(event: PointerEvent) {
    if (!isDrawing.value) return
    event.preventDefault()
    if (options.canvas.value?.hasPointerCapture(event.pointerId)) {
      options.canvas.value.releasePointerCapture(event.pointerId)
    }
    isDrawing.value = false
    if (preview.value) options.onCommit(preview.value)
    startPoint.value = null
    updatePreview(null)
  }

  return { tool, filled, preview, begin, move, end, updatePreview }
}
