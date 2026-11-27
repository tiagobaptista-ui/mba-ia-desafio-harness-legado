// Identidade e estado de uma cópia do Balcão (um clone ou uma worktree).
// Só usa módulos nativos do Node: roda num clone limpo, antes de qualquer npm ci.
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'))
export const PASTA_ESTADO = path.join(RAIZ, '.balcao')
const ARQUIVO_ESTADO = path.join(PASTA_ESTADO, 'estado.json')

export const PORTAS_PADRAO = { api: 4000, web: 5173, db: 5432 }

// O nome da pasta mais um hash do caminho: duas worktrees nunca colidem, e a mesma cópia
// sempre recebe a mesma identidade (mesmo banco, mesmo projeto do compose).
export function identidade(raiz = RAIZ) {
  const base =
    path
      .basename(raiz)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'copia'
  const hash = createHash('sha1').update(raiz).digest('hex').slice(0, 6)
  const slug = `${base}-${hash}`
  return {
    slug,
    projetoCompose: `balcao-${slug}`,
    banco: `balcao_${slug.replace(/-/g, '_')}`,
    pastaAnexos: path.join(raiz, '.balcao', 'uploads'),
    pastaLogs: path.join(raiz, '.balcao', 'logs'),
  }
}

export function lerEstado(raiz = RAIZ) {
  try {
    return JSON.parse(fs.readFileSync(path.join(raiz, '.balcao', 'estado.json'), 'utf8'))
  } catch {
    return { portas: {}, processos: {} }
  }
}

export function gravarEstado(estado) {
  fs.mkdirSync(PASTA_ESTADO, { recursive: true })
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2) + '\n')
}

export function log(msg) {
  console.log(`[balcao] ${msg}`)
}

export function falhar(msg) {
  console.error(`[balcao] ERRO: ${msg}`)
  process.exit(1)
}

// Roda um comando e para tudo se ele falhar. `opcoes.env` é somado ao ambiente atual.
export function executar(cmd, args, opcoes = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opcoes.cwd ?? RAIZ,
    env: { ...process.env, ...(opcoes.env ?? {}) },
    stdio: opcoes.silencioso ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    if (opcoes.silencioso) process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}`)
    falhar(`comando falhou (${r.status}): ${cmd} ${args.join(' ')}`)
  }
  return r.stdout ?? ''
}

export function compose(id, args, opcoes = {}) {
  return executar('docker', ['compose', '-p', id.projetoCompose, ...args], opcoes)
}

// ---- processos ---------------------------------------------------------------

function inicioDoProcesso(pid) {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

// Um pid só é desta cópia se ainda existir com a mesma hora de início gravada no estado.
// Isso evita matar um processo de outra pessoa que herdou o mesmo pid.
export function processoVivo(registro) {
  if (!registro?.pid) return false
  const inicio = inicioDoProcesso(registro.pid)
  return inicio !== null && inicio === registro.inicio
}

function grupoVivo(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

export async function pararProcesso(nome, registro) {
  if (!processoVivo(registro)) return false
  const pid = registro.pid
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return false
  }
  for (let i = 0; i < 50 && grupoVivo(pid); i++) await esperar(100)
  if (grupoVivo(pid)) {
    log(`${nome} não saiu com SIGTERM, enviando SIGKILL`)
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // já saiu
    }
  }
  return true
}

// Sobe em segundo plano, num grupo de processos próprio, com a saída num arquivo de log.
export function iniciarProcesso(nome, cmd, args, { cwd, env, pastaLogs }) {
  fs.mkdirSync(pastaLogs, { recursive: true })
  const arquivoLog = path.join(pastaLogs, `${nome}.log`)
  const fd = fs.openSync(arquivoLog, 'w')
  const filho = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] })
  filho.unref()
  fs.closeSync(fd)
  return { pid: filho.pid, inicio: inicioDoProcesso(filho.pid), log: arquivoLog }
}

// ---- portas ------------------------------------------------------------------

function conecta(host, porta) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port: porta })
    s.setTimeout(300)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('timeout', () => {
      s.destroy()
      resolve(false)
    })
    s.once('error', () => resolve(false))
  })
}

function escuta(host, porta) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', (err) => resolve(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL'))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen({ host, port: porta, exclusive: true })
  })
}

// Livre = ninguém atende em localhost (IPv4 e IPv6) e dá para escutar em todas as interfaces.
// Testar só o bind não basta no macOS: um bind em 0.0.0.0 passa mesmo com o Vite preso em ::1.
export async function portaLivre(porta) {
  if ((await conecta('127.0.0.1', porta)) || (await conecta('::1', porta))) return false
  return (await escuta('0.0.0.0', porta)) && (await escuta('::', porta))
}

// Portas gravadas pelas outras worktrees do mesmo repositório: ficam reservadas mesmo
// quando aquela cópia está derrubada, para que ela volte nas mesmas portas.
export function portasDeOutrasCopias() {
  const r = spawnSync('git', ['-C', RAIZ, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  const reservadas = new Set()
  if (r.status !== 0) return reservadas
  for (const linha of r.stdout.split('\n')) {
    if (!linha.startsWith('worktree ')) continue
    let caminho = linha.slice('worktree '.length)
    try {
      caminho = fs.realpathSync(caminho)
    } catch {
      continue
    }
    if (caminho === RAIZ) continue
    for (const p of Object.values(lerEstado(caminho).portas ?? {})) reservadas.add(p)
  }
  return reservadas
}
