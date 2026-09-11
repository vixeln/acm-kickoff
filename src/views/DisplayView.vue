<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DrawingCanvas from '../components/DrawingCanvas.vue'
import type { DrawingAction } from '../types/drawing'

const route = useRoute()
const roomCode = String(route.params.room ?? '').toUpperCase()
const players = ref<Array<{ id: string; name: string }>>([])
const guesses = ref<Array<{ id: string; playerName: string; text: string; isCorrect?: boolean; scoreAwarded?: number; playerHasSolved?: boolean }>>([])
const qrCode = ref('')
const errorMessage = ref('')
const drawingActions = ref<DrawingAction[]>([])
const drawingPreview = ref<DrawingAction | null>(null)
const gamePhase = ref<'waiting' | 'word-pick' | 'drawing' | 'round-break' | 'finished'>('waiting')
const currentRound = ref(0)
const rounds = ref(3)
const scoreboard = ref<Array<{ playerId: string; playerName: string; score: number }>>([])
const roundScores = ref<Array<{ playerId: string; playerName: string; score: number }>>([])
const wordClue = ref('')
const scoreAnimationProgress = ref(1)
const finalRevealPlace = ref(0)
let scoreAnimationFrame = 0
let finalRevealTimers: ReturnType<typeof setTimeout>[] = []
const podiumPlayers = computed(() => scoreboard.value.slice(0, 3))
const roundLeaderboard = computed(() => scoreboard.value.slice(0, 10).map((player) => {
  const roundScore = roundScores.value.find((entry) => entry.playerId === player.playerId)?.score ?? 0
  const before = Math.max(0, player.score - roundScore)
  return {
    ...player,
    roundScore,
    before,
    displayedScore: Math.round(before + (player.score - before) * scoreAnimationProgress.value),
  }
}))
let latestDrawingSequence = -1
let drawingSocket: WebSocket | undefined
let drawingReconnectTimer: ReturnType<typeof setTimeout> | undefined
let displayUnmounted = false
let roomPoll: ReturnType<typeof setInterval> | undefined
let guessesPoll: ReturnType<typeof setInterval> | undefined
let latestGuessesRequest = 0

async function refreshRoom() {
  if (!roomCode) return
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}?role=display`, { cache: 'no-store' })
  if (!response.ok) {
    errorMessage.value = 'That room is not available.'
    return
  }
  const data = (await response.json()) as { room: { players: typeof players.value; game?: { phase: typeof gamePhase.value; currentRound: number; settings: { rounds: number }; wordClue?: string; scoreboard?: typeof scoreboard.value; roundScores?: typeof roundScores.value } } }
  players.value = data.room.players
  if (data.room.game) {
    gamePhase.value = data.room.game.phase
    currentRound.value = data.room.game.currentRound
    rounds.value = data.room.game.settings.rounds
    wordClue.value = data.room.game.wordClue ?? ''
    scoreboard.value = data.room.game.scoreboard ?? []
    roundScores.value = data.room.game.roundScores ?? []
  }
}

async function refreshGuesses() {
  if (!roomCode) return
  const requestId = ++latestGuessesRequest
  let response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/display-guesses`, { cache: 'no-store' })
  // Support servers running the previous API while they are being restarted or redeployed.
  if (response.status === 404) {
    response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/guesses?role=display`, { cache: 'no-store' })
  }
  if (!response.ok || requestId !== latestGuessesRequest) return
  const data = (await response.json()) as { guesses: typeof guesses.value }
  if (requestId === latestGuessesRequest) guesses.value = data.guesses
}

async function loadQrCode() {
  try {
    let address = `${window.location.origin}/login`
    if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
      const response = await fetch('/api/network-info')
      if (!response.ok) return
      const data = (await response.json()) as { urls?: string[] }
      if (!data.urls?.[0]) return
      address = data.urls[0]
    }
    qrCode.value = await QRCode.toDataURL(`${address}?room=${roomCode}`, {
      errorCorrectionLevel: 'M', margin: 2, width: 72,
      color: { dark: '#202124', light: '#ffffff' },
    })
  } catch {
    // The room display remains usable if a QR code cannot be generated.
  }
}

onMounted(() => {
  displayUnmounted = false
  refreshRoom()
  refreshGuesses()
  loadQrCode()
  roomPoll = setInterval(refreshRoom, 2000)
  guessesPoll = setInterval(refreshGuesses, 500)
  connectDisplaySocket()
})

function connectDisplaySocket() {
  if (!roomCode || displayUnmounted) return
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  drawingSocket = new WebSocket(`${protocol}//${window.location.host}/ws?role=display&room=${encodeURIComponent(roomCode)}`)
  drawingSocket.addEventListener('open', () => { refreshRoom() })
  drawingSocket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string
        sequence?: number
        actions?: DrawingAction[]
        preview?: DrawingAction | null
        action?: DrawingAction | null
        guess?: { id: string; playerName: string; text: string; isCorrect?: boolean; scoreAwarded?: number; playerHasSolved?: boolean }
      }
      if (message.type === 'guess' && message.guess) {
        if (!guesses.value.some((guess) => guess.id === message.guess?.id)) guesses.value.push(message.guess)
        return
      }
      if (typeof message.sequence !== 'number' || !Number.isInteger(message.sequence) || message.sequence <= latestDrawingSequence) return
      latestDrawingSequence = message.sequence
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
  drawingSocket.addEventListener('close', () => {
    drawingSocket = undefined
    if (!displayUnmounted) drawingReconnectTimer = setTimeout(connectDisplaySocket, 1000)
  })
}
watch([gamePhase, currentRound], ([phase]) => {
  if (phase === 'finished') {
    finalRevealPlace.value = 0
    finalRevealTimers.forEach(clearTimeout)
    finalRevealTimers = [
      setTimeout(() => { finalRevealPlace.value = 1 }, 3000),
      setTimeout(() => { finalRevealPlace.value = 2 }, 4000),
      setTimeout(() => { finalRevealPlace.value = 3 }, 9000),
    ]
    return
  }
  if (phase !== 'round-break') return
  scoreAnimationProgress.value = 0
  if (scoreAnimationFrame) cancelAnimationFrame(scoreAnimationFrame)
  finalRevealTimers.forEach(clearTimeout)
  const startedAt = performance.now()
  const animate = (now: number) => {
    scoreAnimationProgress.value = Math.min(1, (now - startedAt) / 1400)
    if (scoreAnimationProgress.value < 1) scoreAnimationFrame = requestAnimationFrame(animate)
  }
  scoreAnimationFrame = requestAnimationFrame(animate)
})
onBeforeUnmount(() => {
  if (roomPoll) clearInterval(roomPoll)
  if (guessesPoll) clearInterval(guessesPoll)
  displayUnmounted = true
  if (drawingReconnectTimer) clearTimeout(drawingReconnectTimer)
  drawingSocket?.close()
  if (scoreAnimationFrame) cancelAnimationFrame(scoreAnimationFrame)
  finalRevealTimers.forEach(clearTimeout)
})
</script>

<template>
  <main class="page-shell display-page">
    <section v-if="!errorMessage" class="card display-card">
      <div class="host-room display-room">
        <header class="host-header display-host-header">
          <div class="host-brand">
            <div class="mark" aria-hidden="true">D</div>
            <div>
              <p class="eyebrow">Draw live</p>
              <h1>Draw together</h1>
            </div>
          </div>
          <div class="room-badge">
            <span>Room code</span>
            <strong>{{ roomCode }}</strong>
          </div>
          <div v-if="qrCode" class="join-card">
            <a class="qr-link" :href="`/qr?room=${encodeURIComponent(roomCode)}`" target="_blank" rel="noopener" aria-label="Open QR code full screen"><img :src="qrCode" alt="QR code for the player login address" width="72" height="72" /></a>
            <div><strong>Join the game</strong><span>Scan to play on your phone</span></div>
          </div>
        </header>
        <div class="host-body display-body">
          <aside class="host-panel guesses-panel" aria-label="Player guesses">
            <div class="panel-heading">
              <div><span class="panel-kicker">Live chat</span><h2>Guesses</h2></div>
              <span class="count-badge">{{ guesses.length }}</span>
            </div>
            <div class="guess-list host-guesses" aria-live="polite">
              <span v-if="!guesses.length" class="empty-state">Guesses will appear here.</span>
              <span v-for="item in guesses" :key="item.id" class="guess-item" :class="{ 'correct-guess': item.playerHasSolved }"><b>{{ item.playerName }}</b><br />{{ item.isCorrect ? `guessed it! +${item.scoreAwarded ?? 0} points` : item.text }}</span>
            </div>
            <div class="player-list" aria-live="polite">
              <strong>{{ players.length }} player{{ players.length === 1 ? '' : 's' }} joined</strong>
              <span v-if="!players.length">Waiting for players…</span>
              <span v-for="player in players" :key="player.id">{{ player.name }}</span>
            </div>
          </aside>
          <section class="host-drawing display-drawing" aria-label="Audience drawing display">
            <div class="drawing-heading"><div><p class="eyebrow">Canvas</p><h2>{{ gamePhase === 'waiting' ? 'Waiting for the game' : gamePhase === 'word-pick' ? 'Host is picking a word' : gamePhase === 'finished' ? 'Game complete' : gamePhase === 'round-break' ? 'Next round soon' : `Round ${currentRound} of ${rounds}` }}</h2></div><div v-if="wordClue" class="canvas-word-clue display-canvas-word-clue"><span>GUESS</span><strong>{{ wordClue }}</strong></div><span class="drawing-status"><i></i> {{ gamePhase === 'drawing' ? 'Live' : gamePhase }}</span></div>
            <div v-if="gamePhase === 'finished'" class="score-reveal-stage final-score-stage">
              <span class="panel-kicker">Final results</span>
              <strong>Final audience score</strong>
              <div class="final-podiums" aria-live="polite">
                <div v-if="finalRevealPlace >= 1" class="podium podium-bronze"><div class="podium-player"><strong>{{ podiumPlayers[2]?.playerName ?? '' }}</strong><span v-if="podiumPlayers[2]">{{ podiumPlayers[2].score }} pts</span></div><div class="podium-block"><b>3</b></div></div>
                <div v-if="finalRevealPlace >= 2" class="podium podium-silver"><div class="podium-player"><strong>{{ podiumPlayers[1]?.playerName ?? '' }}</strong><span v-if="podiumPlayers[1]">{{ podiumPlayers[1].score }} pts</span></div><div class="podium-block"><b>2</b></div></div>
                <div v-if="finalRevealPlace >= 3" class="podium podium-gold"><div class="podium-player"><strong>{{ podiumPlayers[0]?.playerName ?? '' }}</strong><span v-if="podiumPlayers[0]">{{ podiumPlayers[0].score }} pts</span></div><div class="podium-block"><b>1</b></div></div>
              </div>
              <small>Thanks for playing</small>
            </div>
            <div v-else-if="gamePhase === 'round-break'" class="score-reveal-stage">
              <span class="panel-kicker">Round results</span>
              <strong>Audience score</strong>
              <TransitionGroup name="score-stack" tag="div" class="scoreboard-list score-stack" aria-live="polite"><div v-for="(player, index) in roundLeaderboard" :key="player.playerId" class="score-stack-row"><span><i>{{ index + 1 }}</i>{{ player.playerName }}</span><strong><small>{{ player.before }}</small> → {{ player.displayedScore }} <em v-if="player.roundScore">(+{{ player.roundScore }})</em></strong></div></TransitionGroup>
              <small>Round {{ currentRound }} complete</small>
            </div>
            <DrawingCanvas v-else :model-value="drawingActions" :preview="drawingPreview" readonly />
          </section>
        </div>
      </div>
    </section>
    <p v-else class="display-error">{{ errorMessage }}</p>
  </main>
</template>
