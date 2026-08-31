<script setup lang="ts">
import QRCode from 'qrcode'
import { onMounted, ref } from 'vue'

const connectionAddress = ref('')
const qrCode = ref('')
const errorMessage = ref('')

onMounted(async () => {
  try {
    const response = await fetch('/api/network-info')
    if (!response.ok) throw new Error(`Network info request failed (${response.status})`)

    const data = (await response.json()) as { urls?: string[] }
    const address = data.urls?.[0]
    if (!address) throw new Error('No LAN address was found')

    connectionAddress.value = address
    qrCode.value = await QRCode.toDataURL(address, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: { dark: '#202124', light: '#ffffff' },
    })
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Could not find a LAN address. Check that this device is connected to a network.'
  }
})
</script>

<template>
  <main class="page-shell">
    <section class="card" aria-labelledby="host-title">
      <div class="mark" aria-hidden="true">D</div>
      <p class="eyebrow">Host device</p>
      <h1 id="host-title">Ready for players</h1>
      <p class="subtitle">Connect another device to the same network, then scan this code.</p>

      <template v-if="qrCode">
        <div class="qr-code">
          <img :src="qrCode" alt="QR code for the player login address" width="280" height="280" />
        </div>
        <div class="address">{{ connectionAddress }}</div>
        <p class="fine-print">Players can scan the code or enter the address in a browser.</p>
      </template>

      <p v-else-if="errorMessage" class="network-error" role="alert">{{ errorMessage }}</p>
      <div v-else class="qr-placeholder" aria-label="Finding this device's network address">
        Finding network address…
      </div>
    </section>
  </main>
</template>
