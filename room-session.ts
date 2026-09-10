import { randomUUID } from 'node:crypto'
import type { DrawingAction } from './src/types/drawing'

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

export type GamePhase = 'waiting' | 'word-pick' | 'drawing' | 'round-break' | 'finished'

export type GameSettings = {
  drawingTime: number
  rounds: number
  wordPickTime: number
}

export type Room = {
  code: string
  createdAt: number
  secretWord: string
  players: Map<string, RoomPlayer>
  guesses: Guess[]
  drawingActions: DrawingAction[]
  drawingPreview: DrawingAction | null
  phase: GamePhase
  settings: GameSettings
  currentRound: number
  phaseStartedAt: number | null
  wordPool: string[]
  wordPoolId: number | null
  wordOptions: string[]
}

const rooms = new Map<string, Room>()
const roomCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const developmentWordPool = ['dog', 'bee', 'alligator']

function normalizeRoomCode(code: string) {
  return code.trim().toUpperCase()
}

function publicRoom(room: Room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(({ id, name, joinedAt }) => ({ id, name, joinedAt })),
    game: {
      phase: room.phase,
      settings: room.settings,
      currentRound: room.currentRound,
      phaseStartedAt: room.phaseStartedAt,
    },
  }
}

export function createRoom(secretWord = '', wordPool: string[] = developmentWordPool, wordPoolId: number | null = null) {
  let code = ''
  do {
    code = Array.from({ length: 4 }, () =>
      roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)],
    ).join('')
  } while (rooms.has(code))

  const room: Room = {
    code,
    createdAt: Date.now(),
    secretWord: secretWord.trim(),
    players: new Map(),
    guesses: [],
    drawingActions: [],
    drawingPreview: null,
    phase: 'waiting',
    settings: { drawingTime: 60, rounds: 3, wordPickTime: 15 },
    currentRound: 0,
    phaseStartedAt: null,
    wordPool: [...wordPool],
    wordPoolId,
    wordOptions: [],
  }
  rooms.set(code, room)
  return publicRoom(room)
}

export function setWordPool(code: string, words: string[]) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  if (room.phase !== 'waiting') return { error: 'The word pool can only be changed while waiting.' as const }
  const cleaned = [...new Set(words.map((word) => word.trim()).filter(Boolean))]
  if (cleaned.some((word) => word.length > 80)) return { error: 'Words must be 80 characters or fewer.' as const }
  if (cleaned.length > 100) return { error: 'The word pool can contain up to 100 words.' as const }
  room.wordPool = cleaned
  return { room: { ...publicRoom(room), wordPool: [...room.wordPool] } }
}

export function setRoomWordPool(code: string, words: string[], poolId: number | null) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  if (room.phase !== 'waiting') return { error: 'The word pool can only be changed while waiting.' as const }
  room.wordPool = [...new Set(words.map((word) => word.trim()).filter(Boolean))]
  room.wordPoolId = poolId
  return { room: { ...publicRoom(room), wordPool: [...room.wordPool], wordPoolId: room.wordPoolId } }
}

export function setGameSettings(code: string, settings: Partial<GameSettings>) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  if (room.phase !== 'waiting') return { error: 'Game settings can only be changed while waiting.' as const }
  const drawingTime = Number(settings.drawingTime)
  const rounds = Number(settings.rounds)
  const wordPickTime = Number(settings.wordPickTime)
  if (!Number.isInteger(drawingTime) || drawingTime < 15 || drawingTime > 600) {
    return { error: 'Drawing time must be between 15 and 600 seconds.' as const }
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
    return { error: 'Rounds must be between 1 and 20.' as const }
  }
  if (!Number.isInteger(wordPickTime) || wordPickTime < 5 || wordPickTime > 60) {
    return { error: 'Word-pick time must be between 5 and 60 seconds.' as const }
  }
  room.settings = { drawingTime, rounds, wordPickTime }
  return { room: publicRoom(room) }
}

export function startGame(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  if (room.phase !== 'waiting') return { error: 'The game has already started.' as const }
  if (room.wordPool.length < 3) return { error: 'Add at least 3 words to the word pool first.' as const }
  room.phase = 'word-pick'
  room.currentRound = 1
  room.phaseStartedAt = Date.now()
  room.guesses = []
  room.drawingActions = []
  room.drawingPreview = null
  room.wordOptions = room.wordPool.slice().sort(() => Math.random() - 0.5).slice(0, 3)
  return { room: publicRoom(room) }
}

export function beginRound(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  if (room.phase !== 'word-pick') return { error: 'The game is not waiting for a word.' as const }
  if (!room.secretWord.trim()) return { error: 'Choose a word before starting the round.' as const }
  room.phase = 'drawing'
  room.phaseStartedAt = Date.now()
  return { room: publicRoom(room) }
}

export function chooseWord(code: string, word: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  if (room.phase !== 'word-pick' || !room.wordOptions.includes(word)) return { error: 'Choose one of the available words.' as const }
  room.secretWord = word
  room.phase = 'drawing'
  room.phaseStartedAt = Date.now()
  return { room: publicRoom(room) }
}

export function getRandomWordOption(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room || room.phase !== 'word-pick' || !room.wordOptions.length) return null
  return room.wordOptions[Math.floor(Math.random() * room.wordOptions.length)] ?? null
}

export function advanceGame(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  if (room.phase === 'drawing') {
    if (room.currentRound >= room.settings.rounds) {
      room.phase = 'finished'
      room.phaseStartedAt = Date.now()
    } else {
      room.phase = 'round-break'
      room.phaseStartedAt = Date.now()
    }
  } else if (room.phase === 'round-break') {
    room.phase = 'word-pick'
    room.currentRound += 1
    room.phaseStartedAt = Date.now()
    room.wordOptions = room.wordPool.slice().sort(() => Math.random() - 0.5).slice(0, 3)
    room.guesses = []
    room.drawingActions = []
    room.drawingPreview = null
  }
  return { room: publicRoom(room) }
}

export function resetGame(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  room.phase = 'waiting'
  room.currentRound = 0
  room.phaseStartedAt = null
  room.secretWord = ''
  room.wordOptions = []
  room.guesses = []
  room.drawingActions = []
  room.drawingPreview = null
  return { room: publicRoom(room) }
}

export function getDrawingState(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  return room
    ? { actions: [...room.drawingActions], preview: room.drawingPreview }
    : null
}

export function setDrawingState(code: string, actions: DrawingAction[]) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return false
  room.drawingActions = [...actions]
  room.drawingPreview = null
  return true
}

export function setDrawingPreview(code: string, preview: DrawingAction | null) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return false
  room.drawingPreview = preview
  return true
}

export function setSecretWord(code: string, secretWord: string) {
  const room = rooms.get(normalizeRoomCode(code))
  if (!room) return { error: 'That room does not exist.' as const }
  const word = secretWord.trim()
  if (!word) return { error: 'Enter a word to draw.' as const }
  if (word.length > 80) return { error: 'Words must be 80 characters or fewer.' as const }
  room.secretWord = word
  return { room: publicRoom(room) }
}

export function getHostRoom(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  return room ? { ...publicRoom(room), secretWord: room.secretWord, wordPool: room.wordPool, wordPoolId: room.wordPoolId, wordOptions: room.wordOptions } : null
}

export function getRoom(code: string) {
  const room = rooms.get(normalizeRoomCode(code))
  return room ? publicRoom(room) : null
}

export function deleteRoom(code: string) {
  return rooms.delete(normalizeRoomCode(code))
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
