<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, onMounted, ref } from 'vue'

const connectionAddress = ref('')
const qrCode = ref('')
const errorMessage = ref('')
const password = ref('')
const authenticationError = ref('')
const isAuthenticated = ref(false)
const isCheckingAuthentication = ref(true)
const isSigningIn = ref(false)
const hostAccessConfigured = ref(true)

const isLoopbackHost = computed(() =>
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
)

async function loadConnectionAddress() {
  try {
    // Public deployments use their HTTPS origin; localhost asks Bun/Vite for a reachable LAN IP.
    let address = `${window.location.origin}/login`

    if (isLoopbackHost.value) {
      const response = await fetch('/api/network-info')
      if (!response.ok) throw new Error(`Network info request failed (${response.status})`)

      const data = (await response.json()) as { urls?: string[] }
      if (!data.urls?.[0]) throw new Error('No LAN address was found')
      address = data.urls[0]
    }

    connectionAddress.value = address
    qrCode.value = await QRCode.toDataURL(address, {
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

async function checkAuthentication() {
  try {
    const response = await fetch('/api/host/status')
    if (!response.ok) throw new Error(`Host status request failed (${response.status})`)

    const data = (await response.json()) as { authenticated: boolean; configured: boolean }
    isAuthenticated.value = data.authenticated
    hostAccessConfigured.value = data.configured
    if (data.authenticated) await loadConnectionAddress()
  } catch (error) {
    console.error(error)
    authenticationError.value = 'Could not check host access. Try refreshing the page.'
  } finally {
    isCheckingAuthentication.value = false
  }
}

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
    await loadConnectionAddress()
  } catch (error) {
    console.error(error)
    authenticationError.value = 'Could not reach the server. Try again.'
  } finally {
    isSigningIn.value = false
  }
}

onMounted(checkAuthentication)
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
        <h1 id="host-title">Ready for players</h1>
        <p class="subtitle">Scan this code on another device to join the game.</p>

        <template v-if="qrCode">
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
        </template>

        <p v-else-if="errorMessage" class="network-error" role="alert">{{ errorMessage }}</p>
        <div v-else class="qr-placeholder" aria-label="Generating player QR code">
          Generating player QR code…
        </div>
      </template>
    </section>
  </main>
</template>
