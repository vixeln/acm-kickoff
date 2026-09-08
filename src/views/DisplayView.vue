<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DrawingCanvas from '../components/DrawingCanvas.vue'
import type { DrawingAction } from '../types/drawing'

const route = useRoute()
const roomCode = String(route.params.room ?? '').toUpperCase()
const players = ref<Array<{ id: string; name: string }>>([])
const errorMessage = ref('')
const drawingActions = ref<DrawingAction[]>([])
const drawingPreview = ref<DrawingAction | null>(null)
let drawingSocket: WebSocket | undefined
let roomPoll: ReturnType<typeof setInterval> | undefined

async function refreshRoom() {
  if (!roomCode) return
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}`)
  if (!response.ok) {
    errorMessage.value = 'That room is not available.'
    return
  }
  const data = (await response.json()) as { room: { players: typeof players.value } }
  players.value = data.room.players
}

onMounted(() => {
  refreshRoom()
  roomPoll = setInterval(refreshRoom, 2000)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  drawingSocket = new WebSocket(`${protocol}//${window.location.host}/ws?role=display&room=${encodeURIComponent(roomCode)}`)
  drawingSocket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string
        actions?: DrawingAction[]
        preview?: DrawingAction | null
        action?: DrawingAction | null
      }
      if (message.type === 'drawing-state' && Array.isArray(message.actions)) {
        drawingActions.value = message.actions
        drawingPreview.value = message.preview ?? null
      } else if (message.type === 'drawing-preview') {
        drawingPreview.value = message.action ?? null
      }
    } catch {
      // Ignore malformed messages; the server validates all drawing broadcasts.
    }
  })
})
onBeforeUnmount(() => {
  if (roomPoll) clearInterval(roomPoll)
  drawingSocket?.close()
})
</script>

<template>
  <main class="display-shell">
    <header class="display-header">
      <div>
        <p class="eyebrow">Draw live</p>
        <h1>Room {{ roomCode }}</h1>
      </div>
      <div class="display-players">{{ players.length }} player{{ players.length === 1 ? '' : 's' }}</div>
    </header>
    <section v-if="!errorMessage" class="display-stage" aria-label="Audience drawing display">
      <DrawingCanvas :model-value="drawingActions" :preview="drawingPreview" readonly />
      <div class="display-word" aria-label="The drawing word is hidden from the audience">••••••••</div>
    </section>
    <p v-else class="display-error">{{ errorMessage }}</p>
  </main>
</template>
