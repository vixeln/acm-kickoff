import { randomUUID } from 'node:crypto'

export type RoomPlayer = {
  id: string
  name: string
  joinedAt: number
}

export type Room = {
  code: string
  createdAt: number
  players: Map<string, RoomPlayer>
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

  const room: Room = { code, createdAt: Date.now(), players: new Map() }
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

  const player = { id: randomUUID(), name: playerName, joinedAt: Date.now() }
  room.players.set(player.id, player)
  return { player, room: publicRoom(room) }
}

export function removePlayer(code: string, playerId: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return
  room.players.delete(playerId)
}
