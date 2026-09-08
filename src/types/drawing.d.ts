export type Point = {
  x: number
  y: number
}

export type DrawingAction =
  | { id: string; type: 'stroke' | 'eraser'; points: Point[]; color: string; width: number }
  | { id: string; type: 'line'; start: Point; end: Point; color: string; width: number }
  | {
      id: string
      type: 'rectangle' | 'circle'
      start: Point
      end: Point
      color: string
      width: number
      filled: boolean
    }
  | { id: string; type: 'fill'; point: Point; color: string }
