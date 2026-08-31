<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const name = ref('')
const roomCode = ref('')

function join() {
  const playerName = name.value.trim()
  const code = roomCode.value.trim().toUpperCase()

  if (!playerName || !code) return

  router.push({ name: 'play', query: { name: playerName, room: code } })
}
</script>

<template>
  <main class="page-shell">
    <section class="card" aria-labelledby="login-title">
      <div class="mark" aria-hidden="true">D</div>
      <p class="eyebrow">Draw together</p>
      <h1 id="login-title">Join the game</h1>
      <p class="subtitle">Enter the details shown on the host device.</p>

      <form class="login-form" @submit.prevent="join">
        <label for="name">Your name</label>
        <input
          id="name"
          v-model="name"
          name="name"
          autocomplete="nickname"
          maxlength="24"
          placeholder="e.g. Alex"
          required
        />

        <label for="room-code">Room code</label>
        <input
          id="room-code"
          v-model="roomCode"
          class="room-code"
          name="room-code"
          autocomplete="off"
          autocapitalize="characters"
          maxlength="8"
          placeholder="ABCD"
          required
        />

        <button type="submit">Join room</button>
      </form>

      <p class="fine-print">Use the same Wi-Fi network as the host device.</p>
    </section>
  </main>
</template>
