import type { Ref } from 'vue'
import type { Point } from '../../types/drawing'

export function useDrawingPointer(canvas: Ref<HTMLCanvasElement | undefined>, width: Ref<number>, height: Ref<number>) {
  function pointFromEvent(event: PointerEvent): Point {
    const bounds = canvas.value!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  function toPixels(point: Point) {
    return { x: point.x * width.value, y: point.y * height.value }
  }

  return { pointFromEvent, toPixels }
}
