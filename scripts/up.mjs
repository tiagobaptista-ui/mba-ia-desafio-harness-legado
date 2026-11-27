// npm run up: sobe o Balcão inteiro desta cópia (Postgres, migrations, seed, API, worker e front).
// Pode rodar de novo sem derrubar: reaproveita portas, banco e dados, e reinicia os processos.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  PORTAS_PADRAO,
  RAIZ,
  compose,
  executar,
  falhar,
  gravarEstado,
  identidade,
  iniciarProcesso,
  lerEstado,
  log,
  pararProcesso,
  portaLivre,
  portasDeOutrasCopias,
} from './lib/copia.mjs'

const API = path.join(RAIZ, 'api')
const WEB = path.join(RAIZ, 'web')

function verificarPreRequisitos() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) falhar(`Node ${process.versions.node} encontrado; o Balcão precisa do Node 22 ou superior.`)
  const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' })
  if (docker.status !== 0) falhar('docker compose não encontrado. Instale o Docker e deixe ele rodando.')
  const info = spawnSync('docker', ['info'], { encoding: 'utf8' })
  if (info.status !== 0) falhar('o Docker não está respondendo. Abra o Docker e rode de novo.')
}

// npm ci só quando falta node_modules ou o lockfile mudou desde a última instalação.
// npm ci (e não npm install) para não reescrever o package-lock.json.
function instalarDependencias(pasta) {
  const lock = path.join(pasta, 'package-lock.json')
  const hash = createHash('sha1').update(fs.readFileSync(lock)).digest('hex')
  const carimbo = path.join(pasta, 'node_modules', '.balcao-lock-sha1')
  const atual = fs.existsSync(carimbo) ? fs.readFileSync(carimbo, 'utf8').trim() : ''
  const nome = path.relative(RAIZ, pasta) || '.'
  if (atual === hash) return
  log(`instalando dependências em ${nome} (npm ci)`)
  executar('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: pasta })
  fs.writeFileSync(carimbo, hash + '\n')
}

async function escolherPorta(nome, preferida, ocupadas) {
  if (preferida && !ocupadas.has(preferida) && (await portaLivre(preferida))) return preferida
  for (let p = PORTAS_PADRAO[nome]; p < PORTAS_PADRAO[nome] + 200; p++) {
    if (!ocupadas.has(p) && (await portaLivre(p))) return p
  }
  return falhar(`nenhuma porta livre para ${nome} a partir de ${PORTAS_PADRAO[nome]}`)
}

function portaDoBancoEmUso(id) {
  const r = spawnSync('docker', ['compose', '-p', id.projetoCompose, 'port', 'db', '5432'], {
    cwd: RAIZ,
    encoding: 'utf8',
  })
  const m = r.status === 0 ? r.stdout.trim().match(/:(\d+)$/m) : null
  return m ? Number(m[1]) : null
}

// Mantém o que a pessoa colocou no .env (ex.: AI_MODE=openai) e sobrescreve só o que é da cópia.
function gravarEnv(arquivo, modelo, valores) {
  const base = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : modelo ? fs.readFileSync(modelo, 'utf8') : ''
  const linhas = base.split('\n').filter((l, i, todas) => !(i === todas.length - 1 && l === ''))
  const vistas = new Set()
  const saida = linhas.map((linha) => {
    const chave = linha.match(/^([A-Z0-9_]+)=/)?.[1]
    if (chave && chave in valores) {
      vistas.add(chave)
      return `${chave}=${valores[chave]}`
    }
    return linha
  })
  for (const [chave, valor] of Object.entries(valores)) if (!vistas.has(chave)) saida.push(`${chave}=${valor}`)
  fs.writeFileSync(arquivo, saida.join('\n') + '\n')
}

async function esperarHttp(url, segundos) {
  for (let i = 0; i < segundos * 4; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (r.ok) return true
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function finalDoLog(arquivo) {
  try {
    return fs.readFileSync(arquivo, 'utf8').split('\n').slice(-20).join('\n')
  } catch {
    return '(sem log)'
  }
}

async function main() {
  verificarPreRequisitos()
  const id = identidade()
  const estado = lerEstado()
  estado.processos ??= {}
  estado.portas ??= {}

  // Subida repetida: para os processos que esta cópia deixou no ar e sobe de novo.
  for (const [nome, registro] of Object.entries(estado.processos)) {
    if (await pararProcesso(nome, registro)) log(`${nome} já estava no ar: reiniciando`)
  }
  estado.processos = {}

  for (const pasta of [RAIZ, API, WEB]) instalarDependencias(pasta)

  const ocupadas = portasDeOutrasCopias()
  const portas = {}
  portas.db = portaDoBancoEmUso(id) ?? (await escolherPorta('db', estado.portas.db, ocupadas))
  ocupadas.add(portas.db)
  portas.api = await escolherPorta('api', estado.portas.api, ocupadas)
  ocupadas.add(portas.api)
  portas.web = await escolherPorta('web', estado.portas.web, ocupadas)
  estado.slug = id.slug
  estado.portas = portas
  gravarEstado(estado)

  const servidorDb = `postgresql://balcao:balcao@localhost:${portas.db}`
  const apiUrl = `http://localhost:${portas.api}`
  const webUrl = `http://localhost:${portas.web}`
  const envApi = {
    DATABASE_URL: `${servidorDb}/${id.banco}`,
    DATABASE_URL_TEST: `${servidorDb}/${id.banco}_test`,
    PORT: String(portas.api),
    CORS_ORIGIN: webUrl,
    UPLOAD_DIR: id.pastaAnexos,
  }
  fs.mkdirSync(id.pastaAnexos, { recursive: true })
  gravarEnv(path.join(API, '.env'), path.join(API, '.env.example'), envApi)
  gravarEnv(path.join(WEB, '.env.local'), null, { VITE_API_URL: apiUrl })

  log(`subindo o Postgres (projeto ${id.projetoCompose}, porta ${portas.db})`)
  const envCompose = { BALCAO_DB_PORT: String(portas.db), BALCAO_DB_NAME: id.banco }
  compose(id, ['up', '-d', '--wait', 'db'], { env: envCompose, silencioso: true })

  // Banco de testes de integração da cópia (npm run test:integration). Não existe no primeiro boot.
  const existe = compose(
    id,
    ['exec', '-T', 'db', 'psql', '-U', 'balcao', '-d', id.banco, '-tAc', `SELECT 1 FROM pg_database WHERE datname = '${id.banco}_test'`],
    { env: envCompose, silencioso: true },
  )
  if (existe.trim() !== '1') {
    compose(id, ['exec', '-T', 'db', 'psql', '-U', 'balcao', '-d', id.banco, '-c', `CREATE DATABASE ${id.banco}_test`], {
      env: envCompose,
      silencioso: true,
    })
  }

  // O ambiente vai explícito para os filhos: --env-file e o Prisma não sobrescrevem variável
  // que já exista no shell, e um PORT ou DATABASE_URL exportado faria a cópia usar o endereço errado.
  log('aplicando migrations')
  executar('npm', ['run', 'migrate', '--silent'], { cwd: API, env: envApi, silencioso: true })
  executar('npm', ['run', 'migrate', '--silent'], {
    cwd: API,
    env: { ...envApi, DATABASE_URL: envApi.DATABASE_URL_TEST },
    silencioso: true,
  })
  log('carregando a seed')
  executar('npm', ['run', 'seed', '--silent'], { cwd: API, env: envApi, silencioso: true })

  // Hook de pre-commit versionado em .githooks/ (roda os gates). Vale para todas as worktrees.
  if (fs.existsSync(path.join(RAIZ, '.githooks'))) {
    executar('git', ['config', 'core.hooksPath', '.githooks'], { silencioso: true })
  }

  const ctx = { pastaLogs: id.pastaLogs }
  estado.processos.api = iniciarProcesso('api', 'npm', ['run', 'dev'], { ...ctx, cwd: API, env: envApi })
  estado.processos.worker = iniciarProcesso('worker', 'npm', ['run', 'worker'], { ...ctx, cwd: API, env: envApi })
  estado.processos.web = iniciarProcesso(
    'web',
    'npm',
    ['run', 'dev', '--', '--port', String(portas.web), '--strictPort'],
    { ...ctx, cwd: WEB, env: { VITE_API_URL: apiUrl } },
  )
  gravarEstado(estado)

  log('esperando API, worker e front responderem')
  const [apiOk, webOk] = await Promise.all([esperarHttp(`${apiUrl}/api/health`, 60), esperarHttp(webUrl, 60)])
  const workerLog = estado.processos.worker.log
  const workerOk = fs.existsSync(workerLog) && fs.readFileSync(workerLog, 'utf8').includes('worker de triagem rodando')
  const falhas = [
    !apiOk && ['API', estado.processos.api.log],
    !workerOk && ['worker', workerLog],
    !webOk && ['front', estado.processos.web.log],
  ].filter(Boolean)
  for (const [nome, arquivo] of falhas) console.error(`\n[balcao] ${nome} não respondeu. Final de ${arquivo}:\n${finalDoLog(arquivo)}`)
  if (falhas.length) falhar('a subida não terminou. Corrija e rode npm run up de novo (ou npm run down).')

  console.log(`
Balcão no ar (cópia ${id.slug})
  API      ${apiUrl}   (saúde: ${apiUrl}/api/health)
  Front    ${webUrl}
  Banco    ${id.banco} em ${servidorDb} (container do projeto ${id.projetoCompose})
  Anexos   ${id.pastaAnexos}
  Logs     ${id.pastaLogs}
  IA       modo ${lerValorEnv(path.join(API, '.env'), 'AI_MODE') || 'fake'}

Caixa-preta: cd blackbox && npm ci && API_URL=${apiUrl} npm test
Derrubar:    npm run down
`)
}

function lerValorEnv(arquivo, chave) {
  const linha = fs
    .readFileSync(arquivo, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${chave}=`))
  return linha ? linha.slice(chave.length + 1) : ''
}

main().catch((err) => falhar(err.stack || String(err)))
