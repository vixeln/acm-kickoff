<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DrawingCanvas from '../components/DrawingCanvas.vue'
import type { DrawingAction } from '../types/drawing'

const connectionAddress = ref('')
const qrCode = ref('')
const errorMessage = ref('')
const password = ref('')
const authenticationError = ref('')
const isAuthenticated = ref(false)
const isCheckingAuthentication = ref(true)
const isSigningIn = ref(false)
const hostAccessConfigured = ref(true)
const roomCode = ref('')
const secretWord = ref('')
const savedSecretWord = ref('')
const isSavingSecretWord = ref(false)
const isEndingRoom = ref(false)
const players = ref<Array<{ id: string; name: string }>>([])
const guesses = ref<Array<{ id: string; playerName: string; text: string; createdAt: number }>>([])
const isStartingRoom = ref(false)
const isUpdatingGame = ref(false)
const gamePhase = ref<'waiting' | 'word-pick' | 'drawing' | 'round-break' | 'finished'>('waiting')
const drawingTime = ref(60)
const rounds = ref(3)
const wordPickTime = ref(15)
const currentRound = ref(0)
const phaseStartedAt = ref<number | null>(null)
const developerMode = ref(false)
const secondsRemaining = ref(60)
const wordPool = ref<string[]>([])
const poolWord = ref('')
const wordOptions = ref<string[]>([])
const drawingActions = ref<DrawingAction[]>([])
let drawingSocket: WebSocket | undefined
let drawingReconnectTimer: ReturnType<typeof setTimeout> | undefined
let previewFrame = 0
let pendingPreview: DrawingAction | null = null
let drawingSequence = 0
let playersPoll: ReturnType<typeof setInterval> | undefined
let countdownPoll: ReturnType<typeof setInterval> | undefined

const isLoopbackHost = computed(() =>
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
)

/**
 * Chooses a player-reachable login URL and renders it as a QR data URL.
 *
 * Localhost cannot itself be opened by another device, so local hosting asks the server for a
 * LAN address. Railway and other remote deployments can safely reuse the browser's public origin.
 */
async function loadConnectionAddress() {
  try {
    let address = `${window.location.origin}/login`

    if (isLoopbackHost.value) {
      const response = await fetch('/api/network-info')
      if (!response.ok) throw new Error(`Network info request failed (${response.status})`)

      const data = (await response.json()) as { urls?: string[] }
      if (!data.urls?.[0]) throw new Error('No LAN address was found')
      address = data.urls[0]
    }

    connectionAddress.value = `${address}?room=${roomCode.value}`
    qrCode.value = await QRCode.toDataURL(connectionAddress.value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: { dark: '#202124', light: '#ffffff' },
    })
  } catch (error) {
    console.error(error)
    errorMessage.value = isLoopbackHost.value
      ? 'Could not find a LAN address. Check that this device is connected to a network.'
      : 'Could not generate the player QR code.'
  }
}

/** Restores an existing host session before deciding whether to show the login form. */
async function checkAuthentication() {
  try {
    const response = await fetch('/api/host/status')
    if (!response.ok) throw new Error(`Host status request failed (${response.status})`)

    const data = (await response.json()) as { authenticated: boolean; configured: boolean }
    isAuthenticated.value = data.authenticated
    hostAccessConfigured.value = data.configured
  } catch (error) {
    console.error(error)
    authenticationError.value = 'Could not check host access. Try refreshing the page.'
  } finally {
    isCheckingAuthentication.value = false
  }
}

async function startRoom() {
  isStartingRoom.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/rooms', { method: 'POST' })
    const data = (await response.json()) as { room?: { code: string }; error?: string }
    if (!response.ok || !data.room) throw new Error(data.error ?? 'Could not start a room.')
    roomCode.value = data.room.code
    connectDrawingSocket()
    await loadConnectionAddress()
    await refreshPlayers()
    playersPoll = setInterval(refreshPlayers, 2000)
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Could not start a room. Try refreshing the page.'
  } finally {
    isStartingRoom.value = false
  }
}

function sendDrawingMessage(message: object) {
  if (drawingSocket?.readyState === WebSocket.OPEN) {
    drawingSequence += 1
    drawingSocket.send(JSON.stringify({ ...message, sequence: drawingSequence }))
  }
}

function connectDrawingSocket() {
  if (!roomCode.value) return
  if (drawingReconnectTimer) clearTimeout(drawingReconnectTimer)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  drawingSocket = new WebSocket(`${protocol}//${window.location.host}/ws?role=host&room=${encodeURIComponent(roomCode.value)}`)
  drawingSocket.addEventListener('open', () => {
    sendDrawingMessage({ type: 'drawing-state', actions: drawingActions.value })
  })
  drawingSocket.addEventListener('close', () => {
    drawingSocket = undefined
    if (roomCode.value) drawingReconnectTimer = setTimeout(connectDrawingSocket, 1500)
  })
}

function drawingChanged(actions: DrawingAction[]) {
  drawingActions.value = actions
  sendDrawingMessage({ type: 'drawing-state', actions })
}

function drawingPreviewChanged(action: DrawingAction | null) {
  pendingPreview = action
  if (previewFrame) cancelAnimationFrame(previewFrame)
  if (!action) {
    previewFrame = 0
    sendDrawingMessage({ type: 'drawing-preview', action: null })
    return
  }
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0
    sendDrawingMessage({ type: 'drawing-preview', action: pendingPreview })
  })
}

async function refreshPlayers() {
  if (!roomCode.value) return
  const response = await fetch(`/api/rooms/${roomCode.value}`)
  if (!response.ok) return
  const data = (await response.json()) as { room: { players: Array<{ id: string; name: string }>; game?: { phase: typeof gamePhase.value; settings: { drawingTime: number; rounds: number; wordPickTime: number }; currentRound: number; phaseStartedAt: number | null } } }
  players.value = data.room.players
  if (data.room.game) {
    gamePhase.value = data.room.game.phase
    drawingTime.value = data.room.game.settings.drawingTime
    rounds.value = data.room.game.settings.rounds
    wordPickTime.value = data.room.game.settings.wordPickTime
    currentRound.value = data.room.game.currentRound
    phaseStartedAt.value = data.room.game.phaseStartedAt
  }
  const hostStateResponse = await fetch(`/api/rooms/${roomCode.value}/host-state`)
  if (hostStateResponse.ok && !isSavingSecretWord.value && document.activeElement?.id !== 'round-word') {
    const hostState = (await hostStateResponse.json()) as { room: { secretWord: string; wordPool?: string[]; wordOptions?: string[]; game?: { settings: { wordPickTime: number } } } }
    secretWord.value = hostState.room.secretWord
    savedSecretWord.value = hostState.room.secretWord
    wordPool.value = hostState.room.wordPool ?? []
    wordOptions.value = hostState.room.wordOptions ?? []
    if (hostState.room.game) wordPickTime.value = hostState.room.game.settings.wordPickTime
  }
  const guessesResponse = await fetch(`/api/rooms/${roomCode.value}/guesses?role=host`)
  if (guessesResponse.ok) {
    const guessesData = (await guessesResponse.json()) as { guesses: typeof guesses.value }
    guesses.value = guessesData.guesses
  }
}

async function saveGameSettings() {
  if (!roomCode.value || isUpdatingGame.value || gamePhase.value !== 'waiting') return
  isUpdatingGame.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/rooms/${roomCode.value}/game`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawingTime: drawingTime.value, rounds: rounds.value, wordPickTime: wordPickTime.value }),
    })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not save game settings.')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not save game settings.'
  } finally {
    isUpdatingGame.value = false
  }
}

async function startGame() {
  if (!roomCode.value || isUpdatingGame.value || gamePhase.value !== 'waiting') return
  await saveGameSettings()
  if (errorMessage.value) return
  isUpdatingGame.value = true
  try {
    const response = await fetch(`/api/rooms/${roomCode.value}/game/start`, { method: 'POST' })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not start the game.')
    await refreshPlayers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not start the game.'
  } finally {
    isUpdatingGame.value = false
  }
}

async function advanceRound() {
  if (!roomCode.value || isUpdatingGame.value || (gamePhase.value !== 'drawing' && gamePhase.value !== 'round-break')) return
  isUpdatingGame.value = true
  try {
    const response = await fetch(`/api/rooms/${roomCode.value}/game/advance`, { method: 'POST' })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not advance the game.')
    await refreshPlayers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not advance the game.'
  } finally {
    isUpdatingGame.value = false
  }
}

async function chooseWord(word: string) {
  if (!roomCode.value || isUpdatingGame.value || gamePhase.value !== 'word-pick') return
  isUpdatingGame.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/rooms/${roomCode.value}/game/choose-word`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word }),
    })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not start the round.')
    await refreshPlayers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not start the round.'
  } finally {
    isUpdatingGame.value = false
  }
}

async function chooseRandomWord() {
  const word = wordOptions.value[Math.floor(Math.random() * wordOptions.value.length)]
  if (word) await chooseWord(word)
}

async function backToWaitingRoom() {
  if (!roomCode.value || isUpdatingGame.value) return
  isUpdatingGame.value = true
  try {
    const response = await fetch(`/api/rooms/${roomCode.value}/game/reset`, { method: 'POST' })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not return to the waiting room.')
    await refreshPlayers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not return to the waiting room.'
  } finally {
    isUpdatingGame.value = false
  }
}

async function updateWordPool() {
  const word = poolWord.value.trim()
  if (!roomCode.value || !word || gamePhase.value !== 'waiting') return
  const nextPool = [...wordPool.value, word]
  const response = await fetch(`/api/rooms/${roomCode.value}/game/pool`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: nextPool }),
  })
  const data = (await response.json()) as { error?: string; room?: { wordPool?: string[] } }
  if (!response.ok) { errorMessage.value = data.error ?? 'Could not update the word pool.'; return }
  wordPool.value = data.room?.wordPool ?? nextPool
  poolWord.value = ''
}

async function removePoolWord(word: string) {
  if (!roomCode.value || gamePhase.value !== 'waiting') return
  const response = await fetch(`/api/rooms/${roomCode.value}/game/pool`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: wordPool.value.filter((item) => item !== word) }),
  })
  if (response.ok) wordPool.value = wordPool.value.filter((item) => item !== word)
}

function updateCountdown() {
  if ((gamePhase.value !== 'drawing' && gamePhase.value !== 'round-break' && gamePhase.value !== 'word-pick') || !phaseStartedAt.value) {
    secondsRemaining.value = gamePhase.value === 'round-break' ? 20 : gamePhase.value === 'word-pick' ? wordPickTime.value : drawingTime.value
    return
  }
  const phaseDuration = gamePhase.value === 'word-pick' ? wordPickTime.value : gamePhase.value === 'round-break' ? 20 : drawingTime.value
  secondsRemaining.value = Math.max(0, phaseDuration - Math.floor((Date.now() - phaseStartedAt.value) / 1000))
  if (secondsRemaining.value === 0 && !isUpdatingGame.value) {
    if (gamePhase.value === 'word-pick') chooseRandomWord()
    else advanceRound()
  }
}

async function saveSecretWord() {
  // Do not send the request unless a room is active and the word contains non-whitespace text.
  if (!roomCode.value || !secretWord.value.trim()) return
  isSavingSecretWord.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/rooms/${roomCode.value}/secret-word`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretWord: secretWord.value }),
    })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not save the word.')
    savedSecretWord.value = secretWord.value.trim()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not save the word.'
  } finally {
    isSavingSecretWord.value = false
  }
}

async function endSession() {
  if (!roomCode.value || isEndingRoom.value) return
  if (!window.confirm('End this session? Players will be disconnected from the room.')) return

  isEndingRoom.value = true
  errorMessage.value = ''
  const endedRoomCode = roomCode.value
  try {
    const response = await fetch(`/api/rooms/${endedRoomCode}`, { method: 'DELETE' })
    const data = (await response.json()) as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not end the session.')
    if (playersPoll) {
      clearInterval(playersPoll)
      playersPoll = undefined
    }
    roomCode.value = ''
    connectionAddress.value = ''
    qrCode.value = ''
    secretWord.value = ''
    savedSecretWord.value = ''
    players.value = []
    guesses.value = []
    drawingActions.value = []
    if (drawingReconnectTimer) clearTimeout(drawingReconnectTimer)
    drawingSocket?.close()
    drawingSocket = undefined
    if (previewFrame) cancelAnimationFrame(previewFrame)
    previewFrame = 0
  } catch (error) {
    console.error(error)
    errorMessage.value = error instanceof Error ? error.message : 'Could not end the session.'
  } finally {
    isEndingRoom.value = false
  }
}

/** Exchanges the entered host password for an HTTP-only session cookie. */
async function signIn() {
  authenticationError.value = ''
  isSigningIn.value = true

  try {
    const response = await fetch('/api/host/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    })
    const data = (await response.json()) as { authenticated?: boolean; error?: string }
    if (!response.ok || !data.authenticated) {
      authenticationError.value = data.error ?? 'Could not sign in.'
      return
    }

    password.value = ''
    isAuthenticated.value = true
  } catch (error) {
    console.error(error)
    authenticationError.value = 'Could not reach the server. Try again.'
  } finally {
    isSigningIn.value = false
  }
}

onMounted(checkAuthentication)
onMounted(() => { countdownPoll = setInterval(updateCountdown, 1000) })
onBeforeUnmount(() => {
  if (playersPoll) clearInterval(playersPoll)
  if (countdownPoll) clearInterval(countdownPoll)
  if (drawingReconnectTimer) clearTimeout(drawingReconnectTimer)
  drawingSocket?.close()
  if (previewFrame) cancelAnimationFrame(previewFrame)
})
</script>

<template>
  <main class="page-shell">
    <section class="card" aria-labelledby="host-title">
      <div v-if="!roomCode" class="mark" aria-hidden="true">D</div>
      <p v-if="!roomCode" class="eyebrow">Host device</p>

      <template v-if="isCheckingAuthentication">
        <h1 id="host-title">Checking access</h1>
        <div class="qr-placeholder" aria-label="Checking host access">Checking host access…</div>
      </template>

      <template v-else-if="!isAuthenticated">
        <h1 id="host-title">Host sign in</h1>
        <p class="subtitle">Enter the host password to manage a game.</p>

        <form v-if="hostAccessConfigured" class="login-form" @submit.prevent="signIn">
          <label for="host-password">Host password</label>
          <input
            id="host-password"
            v-model="password"
            name="host-password"
            type="password"
            autocomplete="current-password"
            required
          />
          <button type="submit" :disabled="isSigningIn">
            {{ isSigningIn ? 'Signing in…' : 'Open host view' }}
          </button>
        </form>

        <p v-if="!hostAccessConfigured" class="network-error" role="alert">
          Host access is not configured. Add HOST_PASSWORD in Railway Variables and redeploy.
        </p>
        <p v-else-if="authenticationError" class="form-error" role="alert">
          {{ authenticationError }}
        </p>
      </template>

      <template v-else-if="!roomCode">
        <h1 id="host-title">Ready to host</h1>
        <p class="subtitle">Start a new session when you’re ready for players to join.</p>
        <button type="button" :disabled="isStartingRoom" @click="startRoom">
          {{ isStartingRoom ? 'Starting session…' : 'Start new session' }}
        </button>
        <p v-if="errorMessage" class="network-error" role="alert">{{ errorMessage }}</p>
      </template>

      <template v-else>
        <template v-if="qrCode && roomCode">
          <div class="host-room">
            <header class="host-header">
              <div class="host-brand">
                <div class="mark" aria-hidden="true">D</div>
                <div>
                  <p class="eyebrow">Host device</p>
                  <h1 id="host-title">Draw together</h1>
                </div>
              </div>
              <div class="room-badge">
                <span>Room code</span>
                <strong>{{ roomCode }}</strong>
              </div>
              <div class="round-setup-header">
                <div class="header-session-actions">
                  <a class="display-link" :href="`/display/${roomCode}`" target="_blank" rel="noopener">Projector view ↗</a>
                  <button type="button" class="end-session-button" :disabled="isEndingRoom" @click="endSession">
                    {{ isEndingRoom ? 'Ending…' : 'End session' }}
                  </button>
                </div>
              </div>
              <div class="join-card">
                <img :src="qrCode" alt="QR code for the player login address" width="72" height="72" />
                <div>
                  <strong>Join the game</strong>
                  <span>Scan to play on your phone</span>
                </div>
              </div>
            </header>

            <div class="host-body">
              <div class="host-sidebar">
                <section class="host-panel game-settings-card" aria-label="Game settings">
                  <div class="panel-heading">
                    <div>
                      <span class="panel-kicker">Game</span>
                      <h2>{{ gamePhase === 'waiting' ? 'Waiting room' : gamePhase === 'word-pick' ? 'Pick a word' : gamePhase === 'drawing' ? `Round ${currentRound} of ${rounds}` : gamePhase === 'round-break' ? 'Next round' : 'Final results' }}</h2>
                    </div>
                    <span class="game-time-badge">{{ gamePhase === 'drawing' || gamePhase === 'word-pick' ? `${secondsRemaining}s` : gamePhase === 'waiting' ? 'Ready' : '—' }}</span>
                  </div>
                  <div v-if="gamePhase === 'waiting'" class="word-pick-form">
                    <label for="pool-word">Word pool</label>
                    <div class="pool-word-entry">
                      <input id="pool-word" v-model="poolWord" maxlength="80" placeholder="Add a word" @keyup.enter="updateWordPool" />
                      <button type="button" @click="updateWordPool">Add</button>
                    </div>
                    <div v-if="wordPool.length" class="word-pool-list">
                      <span v-for="word in wordPool" :key="word" class="word-pool-chip">{{ word }} <button type="button" :aria-label="`Remove ${word}`" @click="removePoolWord(word)">×</button></span>
                    </div>
                    <p class="settings-help">Add at least 3 words before starting.</p>
                  </div>
                  <div v-else-if="gamePhase === 'word-pick'" class="word-pick-form">
                    <label>Choose one word for this round</label>
                    <div class="word-choice-list">
                      <button v-for="word in wordOptions" :key="word" type="button" class="word-choice-button" :disabled="isUpdatingGame" @click="chooseWord(word)">{{ word }}</button>
                    </div>
                  </div>
                  <div class="game-settings">
                    <label for="drawing-time">Drawing time</label>
                    <select id="drawing-time" v-model.number="drawingTime" :disabled="gamePhase !== 'waiting'" @change="saveGameSettings">
                      <option :value="30">30 sec</option><option :value="60">60 sec</option><option :value="90">90 sec</option><option :value="120">2 min</option>
                    </select>
                    <label for="round-count">Rounds</label>
                    <select id="round-count" v-model.number="rounds" :disabled="gamePhase !== 'waiting'" @change="saveGameSettings">
                      <option v-for="count in [1, 2, 3, 4, 5, 6]" :key="count" :value="count">{{ count }}</option>
                    </select>
                    <label for="word-pick-time">Pick time</label>
                    <select id="word-pick-time" v-model.number="wordPickTime" :disabled="gamePhase !== 'waiting'" @change="saveGameSettings">
                      <option :value="10">10 sec</option><option :value="15">15 sec</option><option :value="20">20 sec</option><option :value="30">30 sec</option>
                    </select>
                    <label class="developer-toggle"><input v-model="developerMode" type="checkbox" /> Dev mode</label>
                  </div>
                  <button v-if="gamePhase === 'waiting'" type="button" class="start-game-button" :disabled="isUpdatingGame" @click="startGame">
                    {{ isUpdatingGame ? 'Starting…' : 'Start game' }}
                  </button>
                  <button v-else-if="developerMode && (gamePhase === 'drawing' || gamePhase === 'round-break')" type="button" class="skip-round-button" :disabled="isUpdatingGame" @click="advanceRound">
                    {{ gamePhase === 'round-break' ? 'Start next round' : 'Skip round' }}
                  </button>
                </section>

                <aside class="host-panel guesses-panel" aria-label="Chat and player guesses">
                <div class="panel-heading">
                  <div>
                    <span class="panel-kicker">Live chat</span>
                    <h2>Guesses</h2>
                  </div>
                  <span class="count-badge">{{ guesses.length }}</span>
                </div>
                <div class="guess-list host-guesses" aria-live="polite">
                  <span v-if="!guesses.length" class="empty-state">Guesses will appear here.</span>
                  <span v-for="item in guesses" :key="item.id" class="guess-item">
                    <b>{{ item.playerName }}</b><br />{{ item.text }}
                  </span>
                </div>
                <div class="player-list" aria-live="polite">
                  <strong>{{ players.length }} player{{ players.length === 1 ? '' : 's' }} joined</strong>
                  <span v-if="!players.length">Waiting for players…</span>
                  <span v-for="player in players" :key="player.id">{{ player.name }}</span>
                </div>
                </aside>
              </div>

              <section class="host-drawing" aria-label="Drawing area">
                <div class="drawing-heading">
                  <div>
                    <p class="eyebrow">Canvas</p>
                      <h2>{{ gamePhase === 'waiting' ? 'Waiting for players' : gamePhase === 'word-pick' ? 'Choose a word to begin' : gamePhase === 'finished' ? 'Final audience score' : gamePhase === 'round-break' ? 'Get ready' : 'Draw the clue' }}</h2>
                  </div>
                  <span class="drawing-status"><i></i> {{ gamePhase === 'waiting' ? 'Waiting' : gamePhase === 'finished' ? 'Finished' : gamePhase === 'round-break' ? 'Break' : `${secondsRemaining}s` }}</span>
                </div>
                <div v-if="gamePhase === 'finished'" class="score-reveal-stage final-score-stage">
                  <span class="panel-kicker">Final results</span>
                  <strong>Final audience score</strong>
                  <div class="score-transition" :key="currentRound"><span>0</span><b>→</b><span>0</span></div>
                  <small>Thanks for playing · Final scoring will be connected here soon.</small>
                  <button type="button" class="back-to-waiting-button" :disabled="isUpdatingGame" @click="backToWaitingRoom">Back to waiting room</button>
                </div>
                <div v-else-if="gamePhase === 'round-break'" class="score-reveal-stage">
                  <span class="panel-kicker">Round results</span>
                  <strong>Audience score</strong>
                  <div class="score-transition" :key="currentRound"><span>0</span><b>→</b><span>0</span></div>
                  <small>Scoring will be connected here soon.</small>
                </div>
                <div v-else-if="gamePhase === 'word-pick'" class="word-pick-stage">
                  <span class="word-pick-stage-icon">✦</span>
                  <strong>Pick one word for the players to guess</strong>
                  <span>Enter the round word in the Game settings card.</span>
                </div>
                <DrawingCanvas v-else v-model="drawingActions" @change="drawingChanged" @preview="drawingPreviewChanged" />
              </section>

            </div>
          </div>
        </template>

        <p v-else-if="errorMessage" class="network-error" role="alert">{{ errorMessage }}</p>
        <div v-else class="qr-placeholder" aria-label="Generating player QR code">
          Generating player QR code…
        </div>
      </template>
    </section>
  </main>
</template>
