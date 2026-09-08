import type { Point } from '../../types/drawing'

export function useBrushTool() {
  function start(id: string, point: Point, color: string, width: number) {
    return { id, type: 'stroke' as const, points: [point], color, width }
  }

  function append(action: ReturnType<typeof start>, point: Point) {
    return { ...action, points: [...action.points, point] }
  }

  return { start, append }
}
