import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')

test('loads the dashboard application as an ES module', () => {
  assert.match(html, /<script\s+type="module"\s+src="\/app\.js"><\/script>/)
})

test('uses project names as service card titles', () => {
  assert.match(app, /<h3>\$\{escapeHtml\(service\.projectName\)\}<\/h3>/)
  assert.match(app, /<span>\$\{escapeHtml\(service\.description\)\}<\/span>/)
})

test('shows each service own latest start time on its card', () => {
  assert.doesNotMatch(app, /serviceCard\(service, payload\.generatedAt\)/)
  assert.match(app, /<span>上次启动<\/span><span><time datetime="\$\{escapeHtml\(service\.startedAt \|\| ''\)\}">\$\{escapeHtml\(startedTime\)\}<\/time><\/span>/)
  assert.match(app, /formatServiceTime\(service\.startedAt\)/)
  assert.match(app, /date\.toLocaleString\('zh-CN'/)
})

test('offers saved backend IPv4 selection and apply-restart controls on frontend cards', () => {
  assert.match(app, /data-action="backend-add"/)
  assert.match(app, /data-action="backend-apply"/)
  assert.match(app, /应用并重启/)
  assert.match(app, /target\.activeHost/)
  assert.match(app, /127\.0\.0\.1|本机/)
})
