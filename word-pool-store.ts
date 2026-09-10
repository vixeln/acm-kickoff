import { sql } from 'bun'

const hasDatabase = Boolean(Bun.env.DATABASE_URL?.trim())

/** Creates the small durable store used for the deployment-wide word library. */
export async function initializeWordPoolStore() {
  if (!hasDatabase) {
    console.warn('DATABASE_URL is not configured; word pools will remain in memory.')
    return
  }

  await sql`
    CREATE TABLE IF NOT EXISTS word_pool (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  console.log('PostgreSQL word pool store is ready.')
}

/** Reads the deployment-wide pool in a stable order for new room snapshots. */
export async function loadWordPool() {
  if (!hasDatabase) return []
  const rows = await sql<{ word: string }[]>`
    SELECT word FROM word_pool ORDER BY id ASC
  `
  return rows.map((row) => row.word)
}

/** Replaces the deployment-wide pool atomically after server-side validation. */
export async function saveWordPool(words: string[]) {
  if (!hasDatabase) return

  await sql.begin(async (transaction) => {
    await transaction`DELETE FROM word_pool`
    for (const word of words) {
      await transaction`INSERT INTO word_pool (word) VALUES (${word})`
    }
  })
}
