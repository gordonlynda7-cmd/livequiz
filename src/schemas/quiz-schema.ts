/**
 * LiveQuiz collections.
 *
 * Trust model: clients may READ what a player is allowed to see, but every
 * WRITE goes through a server action (src/actions/index.ts). That is what keeps
 * answers honest:
 *   - `quizkeys` holds every prompt + the correct index. Nobody but the server
 *     (and the app admin) can read it, so a player cannot peek at the answer.
 *   - `rooms` exposes only the CURRENT question, copied there by the server.
 *   - `answers` are readable by their owner only, so you cannot copy a friend.
 *   - Scores are computed server-side from server-stamped answer times.
 */

import type { CollectionSchema, ColumnDefinition } from 'deepspace/schema'

const text = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: 'plain' })
const num = (name: string): ColumnDefinition => ({ name, storage: 'number', interpretation: 'plain' })

const readOnlyForPlayers = {
  viewer: { read: true, create: false, update: false, delete: false },
  member: { read: true, create: false, update: false, delete: false },
  admin: { read: true, create: true, update: true, delete: true },
} as const

export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  ownerField: 'hostId',
  columns: [
    text('code'),
    text('title'),
    text('hostId'),
    text('status'), // lobby | question | reveal | done
    num('questionIndex'),
    num('questionCount'),
    num('questionSeconds'),
    num('questionStartedAt'),
    num('questionEndsAt'),
    text('prompt'),
    text('optionsJson'),
    num('answeredCount'),
    num('revealedIndex'), // -1 until the server reveals it
    text('distributionJson'),
  ],
  permissions: readOnlyForPlayers,
}

export const quizKeysSchema: CollectionSchema = {
  name: 'quizkeys',
  ownerField: 'hostId',
  columns: [text('roomId'), text('hostId'), num('index'), text('prompt'), text('optionsJson'), num('correct')],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const playersSchema: CollectionSchema = {
  name: 'players',
  ownerField: 'userId',
  uniqueOn: ['roomId', 'userId'],
  columns: [
    text('roomId'),
    text('userId'),
    text('name'),
    num('score'),
    num('lastPoints'),
    num('lastScoredIndex'),
  ],
  permissions: readOnlyForPlayers,
}

export const answersSchema: CollectionSchema = {
  name: 'answers',
  ownerField: 'userId',
  uniqueOn: ['roomId', 'questionIndex', 'userId'],
  columns: [text('roomId'), num('questionIndex'), text('userId'), num('choice'), num('at')],
  permissions: {
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const chatSchema: CollectionSchema = {
  name: 'chat',
  ownerField: 'userId',
  columns: [text('roomId'), text('userId'), text('name'), text('text')],
  permissions: readOnlyForPlayers,
}
