import { randomUUID } from 'node:crypto'

export type RoomPlayer = {
  id: string
  name: string
  joinedAt: number
  sessionToken: string
}

export type Guess = {
  id: string
  playerId: string
  playerName: string
  text: string
  createdAt: number
}

export type Room = {
  code: string
  createdAt: number
  players: Map<string, RoomPlayer>
  guesses: Guess[]
}

const rooms = new Map<string, Room>()
const roomCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function normalizeRoomCode(code: string) {
  return code.trim().toUpperCase()
}

function publicRoom(room: Room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(({ id, name, joinedAt }) => ({ id, name, joinedAt })),
  }
}

export function createRoom() {
  let code = ''
  do {
    code = Array.from({ length: 4 }, () =>
      roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)],
    ).join('')
  } while (rooms.has(code))

  const room: Room = { code, createdAt: Date.now(), players: new Map(), guesses: [] }
  rooms.set(code, room)
  return publicRoom(room)
}

export function getRoom(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  return room ? publicRoom(room) : null
}

export function joinRoom(code: string, name: string) {
  const room = rooms.get(normalizeRoomCode(code))
  const playerName = name.trim()
  if (!room) return { error: 'That room does not exist.' as const }
  if (!playerName) return { error: 'Enter your name.' as const }
  if (playerName.length > 24) return { error: 'Names must be 24 characters or fewer.' as const }

  const player = {
    id: randomUUID(),
    name: playerName,
    joinedAt: Date.now(),
    sessionToken: randomUUID(),
  }
  room.players.set(player.id, player)
  return { player: { id: player.id, name: player.name, joinedAt: player.joinedAt, token: player.sessionToken }, room: publicRoom(room) }
}

export function removePlayer(code: string, playerId: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return
  room.players.delete(playerId)
}

export function addGuess(code: string, playerId: string, sessionToken: string, text: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }

  const player = room.players.get(playerId)
  const guessText = text.trim()
  if (!player || player.sessionToken !== sessionToken) return { error: 'You are not in that room.' as const }
  if (!guessText) return { error: 'Enter a word guess.' as const }
  if (guessText.length > 80) return { error: 'Guesses must be 80 characters or fewer.' as const }

  const guess = {
    id: randomUUID(),
    playerId: player.id,
    playerName: player.name,
    text: guessText,
    createdAt: Date.now(),
  }
  room.guesses.push(guess)
  return { guess }
}

export function getPlayerGuesses(code: string, playerId: string, sessionToken: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return null
  if (room.players.get(playerId)?.sessionToken !== sessionToken) return null
  return room.guesses.filter((guess) => guess.playerId === playerId)
}

export function getAllGuesses(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  return room?.guesses ?? null
}
