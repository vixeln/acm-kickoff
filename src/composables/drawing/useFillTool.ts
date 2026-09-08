import type { Point } from '../../types/drawing'

export function useFillTool() {
  function createAction(id: string, point: Point, color: string) {
    return { id, type: 'fill' as const, point, color }
  }

  return { createAction }
}
