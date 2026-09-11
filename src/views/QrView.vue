<script setup lang="ts">
import QRCode from 'qrcode'
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const roomCode = String(route.query.room ?? '').toUpperCase()
const qrCode = ref('')

onMounted(async () => {
  let address = `${window.location.origin}/login`
  if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
    const response = await fetch('/api/network-info')
    if (response.ok) {
      const data = (await response.json()) as { urls?: string[] }
      if (data.urls?.[0]) address = data.urls[0]
    }
  }
  qrCode.value = await QRCode.toDataURL(`${address}?room=${encodeURIComponent(roomCode)}`, {
    errorCorrectionLevel: 'M', margin: 2, width: 720,
    color: { dark: '#202124', light: '#ffffff' },
  })
})
</script>

<template>
  <main class="qr-fullscreen">
    <p class="eyebrow">Join the game</p>
    <h1>Scan to play</h1>
    <strong class="qr-fullscreen-room">{{ roomCode }}</strong>
    <img v-if="qrCode" :src="qrCode" alt="QR code for joining the game" />
    <p v-else class="subtitle">Loading QR code…</p>
    <RouterLink class="text-link" to="/">Close</RouterLink>
  </main>
</template>
