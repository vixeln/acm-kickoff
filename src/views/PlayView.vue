<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const playerName = computed(() => String(route.query.name ?? 'Player'))
const roomCode = computed(() => String(route.query.room ?? ''))
</script>

<template>
  <main class="page-shell">
    <section class="card" aria-labelledby="connected-title">
      <div class="status-dot" aria-hidden="true"></div>
      <p class="eyebrow">Room {{ roomCode }}</p>
      <h1 id="connected-title">You're in, {{ playerName }}.</h1>
      <p class="subtitle">Keep this screen open. The game will begin when the host is ready.</p>
      <RouterLink class="text-link" to="/login">Join a different room</RouterLink>
    </section>
  </main>
</template>
