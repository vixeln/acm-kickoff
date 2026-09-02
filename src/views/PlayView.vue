<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const playerName = computed(() => String(route.query.name ?? 'Player'))
const roomCode = computed(() => String(route.query.room ?? ''))
const playerId = computed(() => String(route.query.player ?? ''))
const sessionToken = computed(() => String(route.query.token ?? ''))
const guess = ref('')
const guesses = ref<Array<{ id: string; text: string; createdAt: number }>>([])
const errorMessage = ref('')
const isSending = ref(false)
let guessesPoll: ReturnType<typeof setInterval> | undefined

async function refreshGuesses() {
  if (!roomCode.value || !playerId.value || !sessionToken.value) return
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomCode.value)}/guesses?player=${encodeURIComponent(playerId.value)}&token=${encodeURIComponent(sessionToken.value)}`,
  )
  if (!response.ok) return
  const data = (await response.json()) as { guesses: typeof guesses.value }
  guesses.value = data.guesses
}

async function sendGuess() {
  const text = guess.value.trim()
  if (!text || isSending.value) return
  errorMessage.value = ''
  isSending.value = true
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode.value)}/guesses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: playerId.value, token: sessionToken.value, text }),
    })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) {
      errorMessage.value = data.error ?? 'Could not send your guess.'
      return
    }
    guess.value = ''
    await refreshGuesses()
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Could not reach the server. Try again.'
  } finally {
    isSending.value = false
  }
}

onMounted(() => {
  refreshGuesses()
  guessesPoll = setInterval(refreshGuesses, 1000)
})
onBeforeUnmount(() => {
  if (guessesPoll) clearInterval(guessesPoll)
})
</script>

<template>
  <main class="page-shell">
    <section class="card play-card" aria-labelledby="connected-title">
      <div class="status-dot" aria-hidden="true"></div>
      <p class="eyebrow">Room {{ roomCode }}</p>
      <h1 id="connected-title">You're in, {{ playerName }}.</h1>
      <p class="subtitle">Send a word guess below. Only you can see your guesses.</p>
      <form class="guess-form" @submit.prevent="sendGuess">
        <label for="guess">Your word guess</label>
        <div class="guess-entry">
          <input id="guess" v-model="guess" maxlength="80" placeholder="Type a word…" required />
          <button type="submit" :disabled="isSending">{{ isSending ? 'Sending…' : 'Guess' }}</button>
        </div>
      </form>
      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      <div class="guess-list" aria-live="polite">
        <strong>Your guesses</strong>
        <span v-if="!guesses.length" class="empty-state">No guesses yet.</span>
        <span v-for="item in guesses" :key="item.id" class="guess-item">{{ item.text }}</span>
      </div>
      <RouterLink class="text-link" to="/login">Join a different room</RouterLink>
    </section>
  </main>
</template>
