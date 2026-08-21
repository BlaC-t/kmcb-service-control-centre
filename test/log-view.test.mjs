import assert from 'node:assert/strict'
import test from 'node:test'
import { adjustedLogScrollTop } from '../public/log-view.js'

test('preserves the visible log position after older content is trimmed', () => {
  assert.equal(adjustedLogScrollTop(700, 1000, 800), 500)
  assert.equal(adjustedLogScrollTop(100, 1000, 800), 0)
  assert.equal(adjustedLogScrollTop(300, 800, 800), 300)
})
