import type { Point } from '../../types/drawing'

export function useLineTool() {
  function preview(id: string, start: Point, end: Point, color: string, width: number) {
    return { id, type: 'line' as const, start, end, color, width }
  }

  return { preview }
}
