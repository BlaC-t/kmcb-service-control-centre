import http from 'node:http'

const port = Number(process.argv[2])
if (!Number.isInteger(port)) throw new Error('A fixture port is required.')

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ ok: true, pid: process.pid }))
})

server.listen(port, '127.0.0.1')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
