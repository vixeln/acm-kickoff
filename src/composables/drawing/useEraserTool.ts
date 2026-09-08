import type { Point } from '../../types/drawing'

export function useEraserTool() {
  function start(id: string, point: Point, width: number) {
    return { id, type: 'eraser' as const, points: [point], color: '#000000', width }
  }

  function append(action: ReturnType<typeof start>, point: Point) {
    return { ...action, points: [...action.points, point] }
  }

  return { start, append }
}
