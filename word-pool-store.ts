import { sql } from 'bun'

const hasDatabase = Boolean(Bun.env.DATABASE_URL?.trim())

export type WordPool = { id: number; name: string; words: string[] }

function cleanWords(words: string[]) {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))]
}

async function readPool(id: number): Promise<WordPool | null> {
  const rows = await sql<{ id: number; name: string; word: string | null }[]>`
    SELECT p.id, p.name, w.word FROM word_pools p
    LEFT JOIN words w ON w.pool_id = p.id WHERE p.id = ${id} ORDER BY w.id ASC
  `
  if (!rows.length) return null
  return { id: rows[0].id, name: rows[0].name, words: rows.flatMap((row) => row.word ? [row.word] : []) }
}

export async function initializeWordPoolStore() {
  if (!hasDatabase) {
    console.warn('DATABASE_URL is not configured; word pools will remain in memory.')
    return
  }
  await sql`CREATE TABLE IF NOT EXISTS word_pools (id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`CREATE TABLE IF NOT EXISTS words (id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pool_id INTEGER NOT NULL REFERENCES word_pools(id) ON DELETE CASCADE, word TEXT NOT NULL, UNIQUE (pool_id, word))`
  await sql`INSERT INTO word_pools (name) VALUES ('General') ON CONFLICT (name) DO NOTHING`
  // Migrate the original single-pool table when it exists from an earlier deployment.
  await sql`CREATE TABLE IF NOT EXISTS word_pool (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, word TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`INSERT INTO words (pool_id, word) SELECT p.id, old.word FROM word_pools p CROSS JOIN word_pool old WHERE p.name = 'General' ON CONFLICT (pool_id, word) DO NOTHING`
  console.log('PostgreSQL word pool store is ready.')
}

export async function listWordPools(): Promise<WordPool[]> {
  if (!hasDatabase) return []
  const pools = await sql<{ id: number; name: string }[]>`SELECT id, name FROM word_pools ORDER BY name ASC`
  const items = await Promise.all(pools.map((pool) => readPool(pool.id)))
  return items.filter((item): item is WordPool => Boolean(item))
}

export async function loadWordPool(poolId?: number) {
  if (!hasDatabase) return []
  const rows = poolId
    ? await sql<{ word: string }[]>`SELECT word FROM words WHERE pool_id = ${poolId} ORDER BY id ASC`
    : await sql<{ word: string }[]>`SELECT w.word FROM words w JOIN word_pools p ON p.id = w.pool_id ORDER BY (p.name = 'General') DESC, w.id ASC`
  return rows.map((row) => row.word)
}

export async function createWordPool(name: string) {
  const [pool] = await sql<{ id: number; name: string }[]>`INSERT INTO word_pools (name) VALUES (${name.trim()}) RETURNING id, name`
  return pool ? { ...pool, words: [] } : null
}

export async function renameWordPool(id: number, name: string) {
  const [pool] = await sql<{ id: number; name: string }[]>`UPDATE word_pools SET name = ${name.trim()} WHERE id = ${id} RETURNING id, name`
  return pool ? await readPool(pool.id) : null
}

export async function replaceWordPoolWords(id: number, words: string[]) {
  const cleaned = cleanWords(words)
  return sql.begin(async (transaction) => {
    await transaction`DELETE FROM words WHERE pool_id = ${id}`
    for (const word of cleaned) await transaction`INSERT INTO words (pool_id, word) VALUES (${id}, ${word})`
    return readPool(id)
  })
}

export async function deleteWordPool(id: number) {
  const [{ count }] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM word_pools`
  if (count <= 1) return { error: 'Keep at least one word pool.' as const }
  await sql`DELETE FROM word_pools WHERE id = ${id}`
  return { deleted: true as const }
}

export async function mergeWordPools(pools: Array<{ name: string; words: string[] }>, replaceAll = false) {
  await sql.begin(async (transaction) => {
    if (replaceAll) await transaction`DELETE FROM word_pools`
    for (const input of pools) {
      const name = input.name.trim()
      if (!name) continue
      const [pool] = await transaction<{ id: number }[]>`INSERT INTO word_pools (name) VALUES (${name}) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`
      if (!pool) continue
      if (replaceAll) await transaction`DELETE FROM words WHERE pool_id = ${pool.id}`
      for (const word of cleanWords(input.words)) await transaction`INSERT INTO words (pool_id, word) VALUES (${pool.id}, ${word}) ON CONFLICT DO NOTHING`
    }
  })
}

export async function saveWordPool(words: string[]) {
  if (!hasDatabase) return
  await sql`INSERT INTO word_pools (name) VALUES ('General') ON CONFLICT (name) DO NOTHING`
  const [pool] = await sql<{ id: number }[]>`SELECT id FROM word_pools WHERE name = 'General'`
  if (pool) await replaceWordPoolWords(pool.id, words)
}
