import type { Point } from '../../types/drawing'

export function useRectangleTool() {
  function preview(id: string, start: Point, end: Point, color: string, width: number, filled: boolean) {
    return { id, type: 'rectangle' as const, start, end, color, width, filled }
  }

  return { preview }
}
