<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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
const players = ref<Array<{ id: string; name: string }>>([])
const guesses = ref<Array<{ id: string; playerName: string; text: string; createdAt: number }>>([])
const isStartingRoom = ref(false)
let playersPoll: ReturnType<typeof setInterval> | undefined

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
    if (data.authenticated) {
      await startRoom()
    }
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

async function refreshPlayers() {
  if (!roomCode.value) return
  const response = await fetch(`/api/rooms/${roomCode.value}`)
  if (!response.ok) return
  const data = (await response.json()) as { room: { players: Array<{ id: string; name: string }> } }
  players.value = data.room.players
  const hostStateResponse = await fetch(`/api/rooms/${roomCode.value}/host-state`)
  if (hostStateResponse.ok && !isSavingSecretWord.value && document.activeElement?.id !== 'secret-word') {
    const hostState = (await hostStateResponse.json()) as { room: { secretWord: string } }
    secretWord.value = hostState.room.secretWord
    savedSecretWord.value = hostState.room.secretWord
  }
  const guessesResponse = await fetch(`/api/rooms/${roomCode.value}/guesses?role=host`)
  if (guessesResponse.ok) {
    const guessesData = (await guessesResponse.json()) as { guesses: typeof guesses.value }
    guesses.value = guessesData.guesses
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
    await startRoom()
  } catch (error) {
    console.error(error)
    authenticationError.value = 'Could not reach the server. Try again.'
  } finally {
    isSigningIn.value = false
  }
}

onMounted(checkAuthentication)
onBeforeUnmount(() => {
  if (playersPoll) clearInterval(playersPoll)
})
</script>

<template>
  <main class="page-shell">
    <section class="card" aria-labelledby="host-title">
      <div class="mark" aria-hidden="true">D</div>
      <p class="eyebrow">Host device</p>

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

      <template v-else>
        <h1 id="host-title">Room {{ roomCode || 'starting…' }}</h1>
        <p class="subtitle">Scan this code on another device to join the game.</p>

        <template v-if="qrCode && roomCode">
          <div class="qr-code">
            <img
              :src="qrCode"
              alt="QR code for the player login address"
              width="280"
              height="280"
            />
          </div>
          <div class="address">{{ connectionAddress }}</div>
          <p class="fine-print">Players can scan the code or enter the address in a browser.</p>
          <form class="secret-word-form" @submit.prevent="saveSecretWord">
            <label for="secret-word">Word to draw</label>
            <div class="guess-entry">
              <input id="secret-word" v-model="secretWord" maxlength="80" placeholder="Enter the secret word" required />
              <button type="submit" :disabled="isSavingSecretWord">
                {{ isSavingSecretWord ? 'Saving…' : 'Save word' }}
              </button>
            </div>
            <p v-if="savedSecretWord" class="saved-word">Private word: {{ savedSecretWord }}</p>
          </form>
          <a class="display-link" :href="`/display/${roomCode}`" target="_blank" rel="noopener">
            Open projector view ↗
          </a>
          <div class="player-list" aria-live="polite">
            <strong>{{ players.length }} player{{ players.length === 1 ? '' : 's' }} joined</strong>
            <span v-if="!players.length">Waiting for players…</span>
            <span v-for="player in players" :key="player.id">{{ player.name }}</span>
          </div>
          <div class="guess-list host-guesses" aria-live="polite">
            <strong>Player guesses</strong>
            <span v-if="!guesses.length" class="empty-state">No guesses yet.</span>
            <span v-for="item in guesses" :key="item.id" class="guess-item">
              <b>{{ item.playerName }}</b>: {{ item.text }}
            </span>
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
