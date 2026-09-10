<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

type Pool = { id: number; name: string; words: string[] }
const router = useRouter()
const pools = ref<Pool[]>([])
const selectedId = ref<number | null>(null)
const newPoolName = ref('')
const newWord = ref('')
const importMode = ref<'merge' | 'replace-all'>('merge')
const importFile = ref<File | null>(null)
const errorMessage = ref('')
const notice = ref('')
const isLoading = ref(true)
const isSaving = ref(false)

const selectedPool = computed(() => pools.value.find((pool) => pool.id === selectedId.value) ?? pools.value[0])

async function loadPools() {
  isLoading.value = true
  try {
    const response = await fetch('/api/word-pools')
    if (response.status === 401) { router.replace('/host'); return }
    const data = (await response.json()) as { pools?: Pool[]; error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not load word pools.')
    pools.value = data.pools ?? []
    selectedId.value = selectedId.value ?? pools.value[0]?.id ?? null
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : 'Could not load word pools.' }
  finally { isLoading.value = false }
}

async function request(path: string, options: RequestInit) {
  errorMessage.value = ''; notice.value = ''; isSaving.value = true
  try {
    const response = await fetch(path, options)
    const data = (await response.json()) as { pool?: Pool; pools?: Pool[]; error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Could not save changes.')
    if (data.pools) { pools.value = data.pools; selectedId.value = selectedId.value ?? data.pools[0]?.id ?? null }
    return data
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : 'Could not save changes.'; return null }
  finally { isSaving.value = false }
}

async function createPool() {
  if (!newPoolName.value.trim()) return
  const data = await request('/api/word-pools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newPoolName.value }) })
  if (data?.pool) { pools.value.push(data.pool); selectedId.value = data.pool.id; newPoolName.value = ''; notice.value = 'Category created.' }
}

async function renamePool() {
  if (!selectedPool.value) return
  const name = window.prompt('Category name', selectedPool.value.name)?.trim()
  if (!name || name === selectedPool.value.name) return
  const data = await request(`/api/word-pools/${selectedPool.value.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
  if (data?.pool) { Object.assign(selectedPool.value, data.pool); notice.value = 'Category renamed.' }
}

async function deletePool() {
  if (!selectedPool.value || pools.value.length < 2 || !window.confirm(`Delete “${selectedPool.value.name}”?`)) return
  const deletedId = selectedPool.value.id
  const data = await request(`/api/word-pools/${deletedId}`, { method: 'DELETE' })
  if (data) { pools.value = pools.value.filter((pool) => pool.id !== deletedId); selectedId.value = pools.value[0]?.id ?? null; notice.value = 'Category deleted.' }
}

async function saveWords(words: string[]) {
  if (!selectedPool.value) return
  const data = await request(`/api/word-pools/${selectedPool.value.id}/words`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words }) })
  if (data?.pool) { Object.assign(selectedPool.value, data.pool); notice.value = 'Words saved.' }
}

async function addWord() {
  if (!selectedPool.value || !newWord.value.trim()) return
  await saveWords([...selectedPool.value.words, newWord.value.trim()])
  newWord.value = ''
}

async function removeWord(word: string) {
  if (selectedPool.value) await saveWords(selectedPool.value.words.filter((item) => item !== word))
}

function csvEscape(value: string) { return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value }
function exportCsv() {
  const csv = ['category,word', ...pools.value.flatMap((pool) => pool.words.map((word) => `${csvEscape(pool.name)},${csvEscape(word)}`))].join('\n')
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'draw-word-pools.csv'; link.click(); URL.revokeObjectURL(link.href)
}

function parseCsv(input: string) {
  const records: string[][] = []; let record: string[] = []; let field = ''; let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1 } else quoted = !quoted
    } else if (character === ',' && !quoted) { record.push(field.trim()); field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      record.push(field.trim()); if (record.some(Boolean)) records.push(record); record = []; field = ''
    } else field += character
  }
  if (field || record.length) { record.push(field.trim()); records.push(record) }
  return records.slice(1).map((fields) => ({ name: fields[0] ?? '', word: fields[1] ?? '' })).filter((row) => row.name && row.word)
}

async function importCsv() {
  if (!importFile.value) return
  const rows = parseCsv(await importFile.value.text())
  const grouped = new Map<string, string[]>()
  for (const row of rows) grouped.set(row.name, [...(grouped.get(row.name) ?? []), row.word])
  const data = await request('/api/word-pools/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: importMode.value, pools: [...grouped].map(([name, words]) => ({ name, words })) }) })
  if (data?.pools) { pools.value = data.pools; selectedId.value = pools.value[0]?.id ?? null; importFile.value = null; notice.value = 'CSV imported.' }
}

onMounted(loadPools)
</script>

<template>
  <main class="page-shell editor-shell">
    <section class="card editor-card" aria-labelledby="pool-title">
      <div class="editor-topline"><div><p class="eyebrow">Host tools</p><h1 id="pool-title">Word pools</h1></div><RouterLink class="text-link" to="/host">Back to host</RouterLink></div>
      <p class="subtitle">Build reusable categories for future game rooms.</p>
      <div v-if="isLoading" class="empty-state">Loading word pools…</div>
      <template v-else>
        <div class="pool-editor-layout">
          <aside class="pool-category-panel">
            <div class="pool-editor-heading"><strong>Categories</strong><span>{{ pools.length }}</span></div>
            <button v-for="pool in pools" :key="pool.id" type="button" class="pool-category-button" :class="{ active: pool.id === selectedId }" @click="selectedId = pool.id"><span>{{ pool.name }}</span><small>{{ pool.words.length }} words</small></button>
            <form class="pool-add-form" @submit.prevent="createPool"><input v-model="newPoolName" placeholder="New category" maxlength="80" /><button type="submit">Add</button></form>
          </aside>
          <section v-if="selectedPool" class="pool-words-panel">
            <div class="pool-editor-heading"><div><span class="panel-kicker">Category</span><h2>{{ selectedPool.name }}</h2></div><div><button type="button" class="small-button" @click="renamePool">Rename</button><button type="button" class="small-button danger-button" :disabled="pools.length < 2" @click="deletePool">Delete</button></div></div>
            <form class="pool-word-entry" @submit.prevent="addWord"><input v-model="newWord" maxlength="80" placeholder="Add a word" /><button type="submit" :disabled="isSaving">Add</button></form>
            <div class="editor-word-list"><span v-for="word in selectedPool.words" :key="word" class="word-pool-chip">{{ word }} <button type="button" :aria-label="`Remove ${word}`" @click="removeWord(word)">×</button></span><span v-if="!selectedPool.words.length" class="empty-state">No words yet.</span></div>
          </section>
        </div>
        <section class="csv-tools"><div><h2>CSV library</h2><p class="settings-help">CSV format: <code>category,word</code>. Merge is non-destructive.</p></div><div class="csv-actions"><button type="button" class="small-button" @click="exportCsv">Export CSV</button><select v-model="importMode"><option value="merge">Merge import</option><option value="replace-all">Replace all</option></select><input type="file" accept=".csv,text/csv" @change="importFile = ($event.target as HTMLInputElement).files?.[0] ?? null" /><button type="button" class="small-button" :disabled="!importFile || isSaving" @click="importCsv">Import</button></div></section>
      </template>
      <p v-if="notice" class="success-message" role="status">{{ notice }}</p><p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
    </section>
  </main>
</template>
