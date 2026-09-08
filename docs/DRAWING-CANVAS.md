# Drawing canvas

`DrawingCanvas.vue` is the host drawing surface. It combines a native HTML canvas with Vue state,
serializable drawing actions, tool-specific composables, and undo/redo history. The component is
intentionally self-contained so a projector or another client can later render the same action
list without receiving canvas screenshots.

## Component location

```text
src/components/DrawingCanvas.vue
├── src/types/drawing.d.ts
└── src/composables/drawing/
    ├── useDrawingTools.ts       # Tool coordinator and pointer lifecycle
    ├── useBrushTool.ts          # Freehand strokes
    ├── useEraserTool.ts         # Destination-out strokes
    ├── useLineTool.ts           # Line previews and actions
    ├── useRectangleTool.ts      # Rectangle previews and actions
    ├── useCircleTool.ts         # Circle previews and actions
    ├── useFillTool.ts           # Flood-fill actions
    ├── useDrawingHistory.ts     # Undo/redo/clear/reset
    └── useDrawingPointer.ts     # Normalized pointer coordinates
```

The individual tool composables create or update actions. `useDrawingTools` coordinates the active
tool and pointer lifecycle; the component owns rendering because all tools draw onto the same
canvas.

## Basic usage

```vue
<script setup lang="ts">
import { ref } from 'vue'
import DrawingCanvas from '@/components/DrawingCanvas.vue'
import type { DrawingAction } from '@/types/drawing'

const actions = ref<DrawingAction[]>([])
</script>

<template>
  <DrawingCanvas v-model="actions" />
</template>
```

The host currently uses this pattern in `HostView.vue`. `actions` is the complete committed
drawing and can be serialized as JSON for persistence or WebSocket messages.

## Props

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `modelValue` | `DrawingAction[]` | `[]` | Initial or externally supplied committed actions; supports `v-model`. |
| `width` | `number` | `900` | Logical canvas width in pixels. |
| `height` | `number` | `600` | Logical canvas height in pixels. |
| `color` | `string` | `#202124` | Initial color used by new actions. |
| `lineWidth` | `number` | `5` | Initial brush, eraser, and shape outline width. |
| `readonly` | `boolean` | `false` | Renders the canvas without the toolbar and ignores pointer input. |

`width` and `height` define the logical coordinate system. The canvas is scaled for
`devicePixelRatio`, while action coordinates remain normalized, so the same action list can render
at different display sizes.

## Events

### `update:modelValue`

Emitted after a committed action, undo, redo, clear, or reset. This is the event used by `v-model`.

### `change`

Emitted with the complete committed `DrawingAction[]` after any history change. Use this for
persistence or sending a committed state update to the server.

### `preview`

Emitted while a brush stroke or geometric shape is in progress. It receives the current temporary
action and then `null` when the pointer interaction ends. Preview actions are not included in
`modelValue` until committed.

For real-time projector updates, send previews separately from committed actions:

```text
preview action → projector overlay
completed action → shared committed action list
```

## Tools

### Brush

Creates a `stroke` action containing normalized pointer points. Points are appended during pointer
movement and committed on pointer release.

### Eraser

Creates an `eraser` action with the same point format as a brush stroke. Rendering uses
`destination-out`, so the eraser removes pixels from the white canvas.

### Line

Uses the initial pointer position as `start` and the current pointer position as `end`. The line is
previewed during dragging and committed on release.

### Rectangle

Uses `start` and `end` as opposite corners. The toolbar's `Filled` option controls whether the
rectangle is filled or outlined.

### Circle

Uses `start` as the center. The distance from `start` to `end` becomes the radius. The `Filled`
option controls whether the circle is filled or outlined.

### Fill

Creates a `fill` action at the clicked point. The renderer performs a pixel flood fill against the
current canvas image. This means fill order matters: during redraw, earlier actions are rendered
before later fill actions.

## Drawing action format

All points use normalized coordinates between `0` and `1`. This avoids coupling synchronized
drawing data to a particular browser's canvas dimensions.

```ts
type Point = {
  x: number
  y: number
}

type DrawingAction =
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
```

Example rectangle:

```json
{
  "id": "drawing-1710000000000-1",
  "type": "rectangle",
  "start": { "x": 0.2, "y": 0.25 },
  "end": { "x": 0.65, "y": 0.7 },
  "color": "#202124",
  "width": 5,
  "filled": false
}
```

## History behavior

`useDrawingHistory` stores two stacks:

```text
actions    = committed drawing actions
redoStack  = actions removed by undo
```

- A new commit appends to `actions` and clears `redoStack`.
- Undo moves the latest action to `redoStack`.
- Redo moves the latest undone action back to `actions`.
- A new action after undo permanently clears the redo path.
- Clear removes all actions but keeps them redoable.
- Reset removes all actions and all redo history.

## Rendering and previews

There is one canvas element. On every redraw, the component:

1. Clears and paints a white background.
2. Replays committed actions in order.
3. Draws the current temporary preview, if one exists.

This avoids a second canvas layer while still allowing shapes to be previewed without permanently
modifying the committed drawing. The `preview` event exposes that temporary action to a future
projector client.

## WebSocket integration guidance

The component does not open a WebSocket itself. Keeping transport outside the component makes it
usable for local rendering, projector rendering, and future persistence.

Recommended message categories:

```text
preview-start / preview-update / preview-cancel
commit(action)
history(undo | redo | clear)
snapshot(actions)
```

Preview updates can be throttled or batched because they are transient. Completed actions and
history changes should be sent reliably. A projector that reconnects should receive a complete
`snapshot(actions)` before applying new preview messages.

## Extension points

When adding a tool:

1. Add its action shape to `src/types/drawing.d.ts`.
2. Add a dedicated composable under `src/composables/drawing/`.
3. Register it in `useDrawingTools.ts`.
4. Add its name to the toolbar in `DrawingCanvas.vue`.
5. Add rendering logic to `drawAction()`.
6. Document its pointer semantics and serialized action format here.

Keep actions deterministic and serializable. Do not store canvas contexts, DOM nodes, or image data
inside an action; those cannot be sent safely over WebSockets or replayed by another client.
