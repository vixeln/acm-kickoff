<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const name = ref('')
const roomCode = ref('')
const errorMessage = ref('')
const isJoining = ref(false)

onMounted(() => {
  roomCode.value = String(router.currentRoute.value.query.room ?? '').toUpperCase()
})

/** Validates and normalizes player input before entering the local joined-state route. */
async function join() {
  const playerName = name.value.trim()
  const code = roomCode.value.trim().toUpperCase()

  if (!playerName || !code) return

  errorMessage.value = ''
  isJoining.value = true
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playerName }),
    })
    const data = (await response.json()) as { player?: { id: string; token: string }; error?: string }
    if (!response.ok || !data.player) {
      errorMessage.value = data.error ?? 'Could not join that room.'
      return
    }
    router.push({ name: 'play', query: { name: playerName, room: code, player: data.player.id, token: data.player.token } })
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Could not reach the server. Try again.'
  } finally {
    isJoining.value = false
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="card" aria-labelledby="login-title">
      <div class="mark" aria-hidden="true">D</div>
      <p class="eyebrow">Draw together</p>
      <h1 id="login-title">Join the game</h1>
      <p class="subtitle">Enter the details shown on the host device.</p>

      <form class="login-form" @submit.prevent="join">
        <label for="name">Your name</label>
        <input
          id="name"
          v-model="name"
          name="name"
          autocomplete="nickname"
          maxlength="24"
          placeholder="e.g. Alex"
          required
        />

        <label for="room-code">Room code</label>
        <input
          id="room-code"
          v-model="roomCode"
          class="room-code"
          name="room-code"
          autocomplete="off"
          autocapitalize="characters"
          maxlength="8"
          placeholder="ABCD"
          required
        />

        <button type="submit" :disabled="isJoining">
          {{ isJoining ? 'Joining…' : 'Join room' }}
        </button>
      </form>

      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      <p class="fine-print">Ask the host for the room code shown on their screen.</p>
    </section>
  </main>
</template>
