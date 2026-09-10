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
const sessionEnded = ref(false)
const isSending = ref(false)
const gamePhase = ref<'waiting' | 'word-pick' | 'drawing' | 'round-break' | 'finished'>('waiting')
const currentRound = ref(0)
const totalRounds = ref(3)
const score = ref(0)
const roundScore = ref(0)
let guessesPoll: ReturnType<typeof setInterval> | undefined

function markSessionEnded() {
  sessionEnded.value = true
  if (guessesPoll) {
    clearInterval(guessesPoll)
    guessesPoll = undefined
  }
}

async function refreshGuesses() {
  if (!roomCode.value || !playerId.value || !sessionToken.value) return
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomCode.value)}/guesses?player=${encodeURIComponent(playerId.value)}&token=${encodeURIComponent(sessionToken.value)}`,
  )
  if (response.status === 404) {
    markSessionEnded()
    return
  }
  if (!response.ok) return
  const data = (await response.json()) as { guesses: typeof guesses.value }
  guesses.value = data.guesses
  const roomResponse = await fetch(`/api/rooms/${encodeURIComponent(roomCode.value)}`)
  if (roomResponse.ok) {
    const roomData = (await roomResponse.json()) as { room: { game?: { phase: typeof gamePhase.value; currentRound: number; settings: { rounds: number }; scoreboard?: Array<{ playerId: string; score: number }>; roundScores?: Array<{ playerId: string; score: number }> } } }
    if (roomData.room.game) {
      gamePhase.value = roomData.room.game.phase
      currentRound.value = roomData.room.game.currentRound
      totalRounds.value = roomData.room.game.settings.rounds
      score.value = roomData.room.game.scoreboard?.find((player) => player.playerId === playerId.value)?.score ?? 0
      roundScore.value = roomData.room.game.roundScores?.find((player) => player.playerId === playerId.value)?.score ?? 0
    }
  }
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
    if (response.status === 404) {
      markSessionEnded()
      return
    }
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
      <div class="status-dot" :class="{ ended: sessionEnded }" aria-hidden="true"></div>
      <p class="eyebrow">Room {{ roomCode }}</p>
      <template v-if="sessionEnded">
        <h1 id="connected-title">Session ended</h1>
        <p class="subtitle">The host has ended this drawing session. Your room is no longer available.</p>
      </template>
      <template v-else>
        <h1 id="connected-title">You're in, {{ playerName }}.</h1>
        <p class="subtitle">{{ gamePhase === 'waiting' ? 'The host is getting the game ready.' : gamePhase === 'word-pick' ? 'The host is choosing a word for the round.' : gamePhase === 'finished' ? 'Final scores are being shown.' : gamePhase === 'round-break' ? 'Round results are in.' : `Round ${currentRound} of ${totalRounds} is live. Send your guesses below.` }}</p>
        <div class="player-score" aria-live="polite"><span>Your score</span><strong>{{ score }}</strong><small v-if="gamePhase === 'round-break' || gamePhase === 'finished'">+{{ roundScore }} this round</small></div>
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
      </template>
      <RouterLink class="text-link" to="/login">Join a different room</RouterLink>
    </section>
  </main>
</template>
