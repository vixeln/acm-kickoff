import type { Point } from '../../types/drawing'

export function useCircleTool() {
  function preview(id: string, start: Point, end: Point, color: string, width: number, filled: boolean) {
    return { id, type: 'circle' as const, start, end, color, width, filled }
  }

  return { preview }
}
