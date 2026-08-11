const token = document.querySelector('meta[name="control-token"]').content
const stateLabels = {
  running: '运行中 RUNNING',
  stopped: '已停止 STOPPED',
  starting: '启动中 STARTING',
  unhealthy: '响应异常 UNHEALTHY',
  conflict: '端口冲突 CONFLICT',
}
const sourceLabels = {
  managed: '控制中心启动',
  external: '外部进程',
}

const frontendRoot = document.querySelector('#frontend-services')
const backendRoot = document.querySelector('#backend-services')
const refreshButton = document.querySelector('#refresh-button')
const dialog = document.querySelector('#log-dialog')
const logContent = document.querySelector('#log-content')
const logTitle = document.querySelector('#log-title')
const refreshLogButton = document.querySelector('#refresh-log')
const toast = document.querySelector('#toast')
let currentLogService = null
let toastTimer = null

refreshButton.addEventListener('click', refresh)
document.querySelector('#close-log').addEventListener('click', () => dialog.close())
document.querySelector('#close-log-bottom').addEventListener('click', () => dialog.close())
refreshLogButton.addEventListener('click', () => currentLogService && loadLogs(currentLogService))

for (const root of [frontendRoot, backendRoot]) {
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]')
    if (!button) return
    const { action, id, name } = button.dataset
    if (action === 'logs') return openLogs(id, name)
    if (action === 'stop' || action === 'restart') {
      const verb = action === 'stop' ? '停止' : '重启'
      if (!window.confirm(`确认${verb}「${name}」？`)) return
    }
    await runAction(id, action, button)
  })
}

const events = new EventSource('/api/events')
events.addEventListener('status', event => render(JSON.parse(event.data)))
events.addEventListener('activity', event => {
  const activity = JSON.parse(event.data)
  if (activity.phase === 'failed') showToast(`${activity.id}: ${activity.message}`, true)
})
events.onerror = () => showToast('实时连接中断，正在自动重连', true)

await refresh()

async function refresh() {
  refreshButton.disabled = true
  try {
    render(await api('/api/status'))
  } catch (error) {
    showToast(error.message, true)
  } finally {
    refreshButton.disabled = false
  }
}

function render(payload) {
  const summary = payload.summary
  document.querySelector('#summary-total').textContent = summary.total
  document.querySelector('#summary-running').textContent = summary.running
  document.querySelector('#summary-attention').textContent = summary.conflict + summary.unhealthy
  document.querySelector('#last-check').textContent = new Date(payload.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })

  frontendRoot.innerHTML = payload.services.filter(service => service.group === 'frontend').map(serviceCard).join('')
  backendRoot.innerHTML = payload.services.filter(service => service.group !== 'frontend').map(serviceCard).join('')
}

function serviceCard(service) {
  const canStart = service.controllable && !service.busy && service.state === 'stopped'
  const canStop = service.controllable && !service.busy && ['running', 'unhealthy', 'starting'].includes(service.state)
  const canRestart = service.controllable && !service.busy && ['running', 'unhealthy'].includes(service.state)
  const source = sourceLabels[service.source] || '未运行'
  const startedTime = formatServiceTime(service.startedAt)
  const health = service.health
    ? `${service.health.statusCode || '--'}${service.health.latencyMs != null ? ` · ${service.health.latencyMs}ms` : ''}`
    : '--'
  return `
    <article class="service-card" data-state="${escapeHtml(service.state)}">
      <div class="card-title">
        <div class="card-title-main">
          <h3>${escapeHtml(service.projectName)}</h3>
          <span>${escapeHtml(service.description)}</span>
        </div>
        <code>:${service.port}</code>
      </div>
      <div class="status-row">
        <span class="status ${escapeHtml(service.state)}">${escapeHtml(stateLabels[service.state] || service.state)}</span>
        <span class="source">${escapeHtml(source)}${service.pid ? ` · PID ${service.pid}` : ''}</span>
      </div>
      <div class="meta">
        <div class="meta-row"><span>服务</span><span>${escapeHtml(service.name)}</span></div>
        <div class="meta-row"><span>目录</span><span title="${escapeHtml(service.cwd)}">${escapeHtml(service.cwdLabel)}</span></div>
        <div class="meta-row"><span>HTTP</span><span>${escapeHtml(health)}</span></div>
        <div class="meta-row"><span>上次启动</span><span><time datetime="${escapeHtml(service.startedAt || '')}">${escapeHtml(startedTime)}</time></span></div>
      </div>
      <p class="message">${escapeHtml(service.message || '')}</p>
      <div class="card-actions">
        <button class="button" data-action="start" data-id="${service.id}" data-name="${escapeHtml(service.name)}" ${canStart ? '' : 'disabled'}>启动</button>
        <button class="button secondary" data-action="restart" data-id="${service.id}" data-name="${escapeHtml(service.name)}" ${canRestart ? '' : 'disabled'}>重启</button>
        <button class="button danger" data-action="stop" data-id="${service.id}" data-name="${escapeHtml(service.name)}" ${canStop ? '' : 'disabled'}>停止</button>
        <button class="button secondary" data-action="logs" data-id="${service.id}" data-name="${escapeHtml(service.name)}">日志</button>
        <a class="open-link" href="${escapeHtml(service.openUrl)}" target="_blank" rel="noreferrer">打开 ↗</a>
      </div>
    </article>
  `
}

function formatServiceTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

async function runAction(id, action, button) {
  button.disabled = true
  try {
    const payload = await api(`/api/services/${id}/${action}`, {
      method: 'POST',
      headers: { 'X-Service-Control-Token': token },
    })
    showToast(`${payload.service.name}: ${stateLabels[payload.service.state] || payload.service.state}`)
    await refresh()
  } catch (error) {
    showToast(error.message, true)
  } finally {
    button.disabled = false
  }
}

async function openLogs(id, name) {
  currentLogService = id
  logTitle.textContent = `${name} · 日志`
  logContent.textContent = '正在读取日志...'
  dialog.showModal()
  await loadLogs(id)
}

async function loadLogs(id) {
  try {
    const payload = await api(`/api/services/${id}/logs?lines=260`)
    logContent.textContent = payload.logs || '暂无由控制中心记录的日志。外部进程日志仍在原启动终端或 IntelliJ 中。'
    logContent.scrollTop = logContent.scrollHeight
  } catch (error) {
    logContent.textContent = error.message
  }
}

async function api(route, options = {}) {
  const response = await fetch(route, options)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
  return payload
}

function showToast(message, error = false) {
  clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.toggle('error', error)
  toast.classList.add('show')
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
