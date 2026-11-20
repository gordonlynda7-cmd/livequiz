/**
 * Two real browsers, one live game: host builds a quiz, a player joins by code,
 * answers, and both see the server-scored result. Run with `npx deepspace test run all`.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// Same guard as collab.spec.ts: skip (not fail) on a machine with no test accounts yet.
test.skip(
  loadAllTestAccounts().length < 2,
  'Needs 2 test accounts: `npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin`',
)

test('host and player complete a live quiz', async ({ users }) => {
  const [host, player] = await users(2)

  // Host builds a one-question quiz (option 2 is correct) and creates the room.
  await host.page.goto('/host')
  await host.page.getByTestId('quiz-title').fill('E2E quiz')
  const q = host.page.getByTestId('question-0')
  await q.getByLabel('Question 1', { exact: true }).fill('Which planet is known as the Red Planet?')
  await q.getByLabel('Question 1 option 1').fill('Venus')
  await q.getByLabel('Question 1 option 2').fill('Mars')
  await q.getByLabel('Question 1 option 3').fill('Jupiter')
  await q.getByLabel('Question 1 option 4').fill('Saturn')
  await q.getByLabel('Option 2 is correct').check()
  await host.page.getByTestId('create-room').click()

  await expect(host.page.getByTestId('room')).toBeVisible({ timeout: 20_000 })
  const code = (await host.page.getByTestId('room-code').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{5}$/)

  // Player joins from the home page with the code.
  await player.page.goto('/home')
  await player.page.getByTestId('join-code').fill(code)
  await player.page.getByTestId('join-submit').click()
  await expect(player.page.getByTestId('room')).toBeVisible({ timeout: 20_000 })

  // The host sees the player appear in the lobby in real time, then starts.
  await expect(host.page.getByTestId('lobby-players').locator('span')).toHaveCount(1, { timeout: 20_000 })
  await host.page.getByTestId('start-game').click()

  // Both see the question; the player answers correctly.
  await expect(player.page.getByTestId('question-prompt')).toContainText('Red Planet', { timeout: 20_000 })
  await expect(host.page.getByTestId('question-prompt')).toContainText('Red Planet')
  await player.page.getByTestId('option-1').click()
  await expect(host.page.getByTestId('answered-count')).toContainText('1 / 1', { timeout: 20_000 })

  // Host reveals: the player is told it was correct and scored >= 500.
  await host.page.getByRole('button', { name: 'Reveal now' }).click()
  await expect(player.page.getByTestId('verdict')).toContainText('Correct', { timeout: 20_000 })
  await expect(player.page.getByTestId('reveal-1')).toHaveAttribute('data-correct', 'true')

  // Finish: both land on final standings with the player on the board.
  await host.page.getByTestId('next-question').click()
  await expect(player.page.getByTestId('done')).toBeVisible({ timeout: 20_000 })
  await expect(player.page.getByTestId('leaderboard')).toContainText(/\b[5-9]\d\d\b|1000/)
})
