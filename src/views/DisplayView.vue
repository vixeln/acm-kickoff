<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const roomCode = String(route.params.room ?? '').toUpperCase()
const players = ref<Array<{ id: string; name: string }>>([])
const errorMessage = ref('')
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
})
onBeforeUnmount(() => {
  if (roomPoll) clearInterval(roomPoll)
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
      <div class="display-canvas-placeholder">Drawing area</div>
      <div class="display-word" aria-label="The drawing word is hidden from the audience">••••••••</div>
    </section>
    <p v-else class="display-error">{{ errorMessage }}</p>
  </main>
</template>
