<script setup lang="ts">
import QRCode from 'qrcode'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DrawingCanvas from '../components/DrawingCanvas.vue'
import type { DrawingAction } from '../types/drawing'

const route = useRoute()
const roomCode = String(route.params.room ?? '').toUpperCase()
const players = ref<Array<{ id: string; name: string }>>([])
const guesses = ref<Array<{ id: string; playerName: string; text: string; isCorrect?: boolean; scoreAwarded?: number }>>([])
const qrCode = ref('')
const errorMessage = ref('')
const drawingActions = ref<DrawingAction[]>([])
const drawingPreview = ref<DrawingAction | null>(null)
const gamePhase = ref<'waiting' | 'word-pick' | 'drawing' | 'round-break' | 'finished'>('waiting')
const currentRound = ref(0)
const rounds = ref(3)
const scoreboard = ref<Array<{ playerId: string; playerName: string; score: number }>>([])
const roundScores = ref<Array<{ playerId: string; playerName: string; score: number }>>([])
let latestDrawingSequence = -1
let drawingSocket: WebSocket | undefined
let roomPoll: ReturnType<typeof setInterval> | undefined

async function refreshRoom() {
  if (!roomCode) return
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}`)
  if (!response.ok) {
    errorMessage.value = 'That room is not available.'
    return
  }
  const data = (await response.json()) as { room: { players: typeof players.value; game?: { phase: typeof gamePhase.value; currentRound: number; settings: { rounds: number }; scoreboard?: typeof scoreboard.value; roundScores?: typeof roundScores.value } } }
  players.value = data.room.players
  if (data.room.game) {
    gamePhase.value = data.room.game.phase
    currentRound.value = data.room.game.currentRound
    rounds.value = data.room.game.settings.rounds
    scoreboard.value = data.room.game.scoreboard ?? []
    roundScores.value = data.room.game.roundScores ?? []
  }
  const guessesResponse = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/guesses?role=display`)
  if (guessesResponse.ok) {
    const guessesData = (await guessesResponse.json()) as { guesses: typeof guesses.value }
    guesses.value = guessesData.guesses
  }
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
  refreshRoom()
  loadQrCode()
  roomPoll = setInterval(refreshRoom, 2000)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  drawingSocket = new WebSocket(`${protocol}//${window.location.host}/ws?role=display&room=${encodeURIComponent(roomCode)}`)
  drawingSocket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string
        sequence?: number
        actions?: DrawingAction[]
        preview?: DrawingAction | null
        action?: DrawingAction | null
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
})
onBeforeUnmount(() => {
  if (roomPoll) clearInterval(roomPoll)
  drawingSocket?.close()
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
            <img :src="qrCode" alt="QR code for the player login address" width="72" height="72" />
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
              <span v-for="item in guesses" :key="item.id" class="guess-item" :class="{ 'correct-guess': item.isCorrect }"><b>{{ item.playerName }}</b><br />{{ item.isCorrect ? `guessed it! +${item.scoreAwarded ?? 0} points` : item.text }}</span>
            </div>
            <div class="player-list" aria-live="polite">
              <strong>{{ players.length }} player{{ players.length === 1 ? '' : 's' }} joined</strong>
              <span v-if="!players.length">Waiting for players…</span>
              <span v-for="player in players" :key="player.id">{{ player.name }}</span>
            </div>
          </aside>
          <section class="host-drawing display-drawing" aria-label="Audience drawing display">
            <div class="drawing-heading"><div><p class="eyebrow">Canvas</p><h2>{{ gamePhase === 'waiting' ? 'Waiting for the game' : gamePhase === 'word-pick' ? 'Host is picking a word' : gamePhase === 'finished' ? 'Game complete' : gamePhase === 'round-break' ? 'Next round soon' : `Round ${currentRound} of ${rounds}` }}</h2></div><span class="drawing-status"><i></i> {{ gamePhase === 'drawing' ? 'Live' : gamePhase }}</span></div>
            <div v-if="gamePhase === 'finished'" class="score-reveal-stage final-score-stage">
              <span class="panel-kicker">Final results</span>
              <strong>Final audience score</strong>
              <div class="scoreboard-list" aria-live="polite"><div v-for="player in scoreboard" :key="player.playerId"><span>{{ player.playerName }}</span><strong>{{ player.score }}</strong></div></div>
              <small>Thanks for playing</small>
            </div>
            <div v-else-if="gamePhase === 'round-break'" class="score-reveal-stage">
              <span class="panel-kicker">Round results</span>
              <strong>Audience score</strong>
              <div class="scoreboard-list" aria-live="polite"><div v-for="player in scoreboard" :key="player.playerId"><span>{{ player.playerName }}</span><strong>{{ player.score }} <em v-if="roundScores.find((entry) => entry.playerId === player.playerId)">(+{{ roundScores.find((entry) => entry.playerId === player.playerId)?.score }})</em></strong></div></div>
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
