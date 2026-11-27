// npm run gates [-- G1 G2 ...]: roda todos os gates (ou só os pedidos), sem parar na primeira
// falha, e termina com uma linha por violação: "<ID> <arquivo> <detalhe>". Sai com 1 se houver
// qualquer violação. Ferramenta de cada gate:
//   G1  tipos            tsc --noEmit em api/ e web/
//   G2  lint             eslint em api/ e web/ (--max-warnings 0)
//   G3  testes unitários vitest em api/src/**/*.test.ts
//   G4  http sem dados   dependency-cruiser
//   G5  env centralizado scripts/gates/codigo.mjs (árvore sintática do TypeScript)
//   G6  serviço sem http dependency-cruiser
//   G7  openai isolado   dependency-cruiser
//   G8  web sem api      dependency-cruiser
//   G9  sem ciclo        dependency-cruiser
//   G10 código morto     knip em api/ e web/
//   G11 sem endereço fixo (regra própria) scripts/gates/codigo.mjs
//   G12 prisma só em repositories (regra própria) dependency-cruiser
//   G13 sem comentário de supressão (regra própria) scripts/gates/codigo.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = (pasta, nome) => path.join(RAIZ, pasta, 'node_modules', '.bin', nome)
const rel = (pasta, arquivo) =>
  path.relative(RAIZ, path.resolve(RAIZ, pasta, arquivo)).split(path.sep).join('/')

function rodar(cmd, args, cwd = RAIZ) {
  return new Promise((resolve) => {
    const filho = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } })
    let saida = ''
    filho.stdout.on('data', (d) => (saida += d))
    filho.stderr.on('data', (d) => (saida += d))
    filho.on('error', (err) => resolve({ codigo: 127, saida: String(err) }))
    filho.on('close', (codigo) => resolve({ codigo, saida }))
  })
}

// Quando a ferramenta falha sem apontar arquivo (config quebrada, crash), o gate falha mesmo assim.
function seSemArquivo(id, alvo, r, violacoes) {
  if (r.codigo !== 0 && violacoes.length === 0) {
    violacoes.push({ id, arquivo: alvo, detalhe: 'a ferramenta falhou sem apontar arquivo (veja o log acima)' })
  }
  return violacoes
}

async function tipos(pasta, tsconfig) {
  const r = await rodar(BIN(pasta, 'tsc'), ['--noEmit', '-p', tsconfig, '--pretty', 'false'], path.join(RAIZ, pasta))
  const violacoes = []
  for (const linha of r.saida.split('\n')) {
    const m = linha.match(/^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/)
    if (m) violacoes.push({ id: 'G1', arquivo: rel(pasta, m[1]), detalhe: `linha ${m[2]}: ${m[3]}` })
  }
  return { saida: r.saida, violacoes: seSemArquivo('G1', `${pasta}/${tsconfig}`, r, violacoes) }
}

async function lint() {
  const r = await rodar(BIN('.', 'eslint'), ['api', 'web', '--max-warnings', '0', '--format', 'json'])
  const violacoes = []
  let relatorio = []
  try {
    relatorio = JSON.parse(r.saida.slice(r.saida.indexOf('[')))
  } catch {
    return { saida: r.saida, violacoes: seSemArquivo('G2', 'eslint.config.js', r, []) }
  }
  for (const arq of relatorio) {
    for (const msg of arq.messages) {
      violacoes.push({
        id: 'G2',
        arquivo: rel('.', arq.filePath),
        detalhe: `linha ${msg.line}: ${msg.ruleId ?? 'erro'} ${msg.message}`,
      })
    }
  }
  return { saida: '', violacoes: seSemArquivo('G2', 'eslint.config.js', r, violacoes) }
}

async function testes() {
  const relatorio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'balcao-gates-')), 'vitest.json')
  const r = await rodar(
    BIN('api', 'vitest'),
    ['run', '--reporter=dot', '--reporter=json', `--outputFile.json=${relatorio}`],
    path.join(RAIZ, 'api'),
  )
  const violacoes = []
  try {
    const json = JSON.parse(fs.readFileSync(relatorio, 'utf8'))
    for (const arq of json.testResults) {
      if (arq.status !== 'passed') {
        const falhos = arq.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName)
        violacoes.push({
          id: 'G3',
          arquivo: rel('.', arq.name),
          detalhe: falhos.length ? `falhou: ${falhos.join('; ')}` : arq.message || 'o arquivo de teste não rodou',
        })
      }
    }
  } catch {
    // sem relatório: o vitest nem chegou a rodar; seSemArquivo marca o gate
  }
  return { saida: r.codigo === 0 ? '' : r.saida, violacoes: seSemArquivo('G3', 'api/src', r, violacoes) }
}

async function imports() {
  const r = await rodar(BIN('.', 'depcruise'), [
    'api/src',
    'web/src',
    'web/vite.config.ts',
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'json',
  ])
  let json
  try {
    json = JSON.parse(r.saida.slice(r.saida.indexOf('{')))
  } catch {
    return { saida: r.saida, violacoes: seSemArquivo('G4', '.dependency-cruiser.cjs', r, []) }
  }
  const violacoes = []
  for (const v of json.summary.violations) {
    const id = v.rule.name.split('-')[0]
    if (v.cycle?.length) {
      const ciclo = [v.from, ...v.cycle.map((c) => c.name ?? c)]
      for (const arquivo of new Set(ciclo)) violacoes.push({ id, arquivo, detalhe: `ciclo: ${ciclo.join(' -> ')}` })
    } else {
      violacoes.push({ id, arquivo: v.from, detalhe: `importa ${v.to} (${v.rule.name})` })
    }
  }
  return { saida: '', violacoes }
}

const TIPOS_KNIP = {
  files: 'arquivo sem uso',
  dependencies: 'dependência sem uso',
  devDependencies: 'dependência de desenvolvimento sem uso',
  optionalPeerDependencies: 'peer dependency sem uso',
  unlisted: 'dependência usada mas não declarada',
  binaries: 'binário não declarado',
  unresolved: 'import que não resolve',
  exports: 'export sem uso',
  types: 'export de tipo sem uso',
  namespaceMembers: 'membro de namespace sem uso',
  enumMembers: 'membro de enum sem uso',
  duplicates: 'export duplicado',
}

async function codigoMorto(pasta) {
  const r = await rodar(BIN('.', 'knip'), ['--directory', pasta, '--reporter', 'json', '--no-progress'])
  let json
  try {
    json = JSON.parse(r.saida.slice(r.saida.indexOf('{')))
  } catch {
    return { saida: r.saida, violacoes: seSemArquivo('G10', `${pasta}/knip.json`, r, []) }
  }
  const violacoes = []
  for (const issue of json.issues) {
    const arquivo = rel(pasta, issue.file)
    for (const [tipo, descricao] of Object.entries(TIPOS_KNIP)) {
      for (const item of issue[tipo] ?? []) {
        const nome = tipo === 'files' ? '' : `${item.name} `
        violacoes.push({ id: 'G10', arquivo, detalhe: `${nome}(${descricao})`.trim() })
      }
    }
  }
  return { saida: '', violacoes: seSemArquivo('G10', `${pasta}/knip.json`, r, violacoes) }
}

async function codigo() {
  const r = await rodar(process.execPath, [path.join(RAIZ, 'scripts', 'gates', 'codigo.mjs')])
  try {
    const achados = JSON.parse(r.saida)
    return { saida: '', violacoes: achados.map((a) => ({ id: a.id, arquivo: a.arquivo, detalhe: `linha ${a.linha}: ${a.mensagem}` })) }
  } catch {
    return { saida: r.saida, violacoes: [{ id: 'G5', arquivo: 'scripts/gates/codigo.mjs', detalhe: 'o verificador falhou' }] }
  }
}

const VERIFICACOES = [
  { ids: ['G1'], nome: 'tipos da api (tsc)', rodar: () => tipos('api', 'tsconfig.json') },
  { ids: ['G1'], nome: 'tipos do web (tsc)', rodar: () => tipos('web', 'tsconfig.json') },
  { ids: ['G2'], nome: 'lint (eslint)', rodar: lint },
  { ids: ['G3'], nome: 'testes unitários da api (vitest)', rodar: testes },
  { ids: ['G4', 'G6', 'G7', 'G8', 'G9', 'G12'], nome: 'regras de import (dependency-cruiser)', rodar: imports },
  { ids: ['G5', 'G11', 'G13'], nome: 'env, endereços fixos e supressões (scripts/gates/codigo.mjs)', rodar: codigo },
  { ids: ['G10'], nome: 'código morto da api (knip)', rodar: () => codigoMorto('api') },
  { ids: ['G10'], nome: 'código morto do web (knip)', rodar: () => codigoMorto('web') },
]

function dependenciasInstaladas() {
  const faltando = ['.', 'api', 'web'].filter((p) => !fs.existsSync(path.join(RAIZ, p, 'node_modules')))
  if (faltando.length) {
    console.error(`Gates: faltam dependências em ${faltando.join(', ')}. Rode npm run up (ou npm ci nessas pastas).`)
    process.exit(2)
  }
}

async function main() {
  dependenciasInstaladas()
  const pedidos = process.argv.slice(2).map((a) => a.toUpperCase())
  const escolhidas = pedidos.length ? VERIFICACOES.filter((v) => v.ids.some((id) => pedidos.includes(id))) : VERIFICACOES
  const inicio = Date.now()
  const resultados = await Promise.all(
    escolhidas.map(async (v) => {
      const t = Date.now()
      const r = await v.rodar()
      const violacoes = pedidos.length ? r.violacoes.filter((x) => pedidos.includes(x.id)) : r.violacoes
      return { ...v, ...r, violacoes, segundos: ((Date.now() - t) / 1000).toFixed(1) }
    }),
  )

  for (const r of resultados) {
    const situacao = r.violacoes.length ? `FALHOU (${r.violacoes.length})` : 'ok'
    console.log(`[${r.ids.join(',')}] ${r.nome}: ${situacao} em ${r.segundos}s`)
    if (r.violacoes.length && r.saida.trim()) console.log(r.saida.trim().split('\n').slice(0, 40).map((l) => `    ${l}`).join('\n'))
  }

  const todas = resultados.flatMap((r) => r.violacoes)
  const vistas = new Set()
  const linhas = []
  for (const v of todas) {
    const linha = `${v.id} ${v.arquivo} ${v.detalhe}`
    if (!vistas.has(linha)) {
      vistas.add(linha)
      linhas.push(linha)
    }
  }
  const ordem = (l) => Number(l.match(/^G(\d+)/)[1])
  linhas.sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b))

  const total = ((Date.now() - inicio) / 1000).toFixed(1)
  if (linhas.length === 0) {
    console.log(`\nGates: todos passaram (${total}s).`)
    return
  }
  console.log(`\nViolações (${linhas.length}), uma por linha: <regra> <arquivo> <detalhe>`)
  for (const l of linhas) console.log(l)
  console.log(`\nGates: falharam (${total}s). O que cada regra pede está em docs/gates.md.`)
  process.exitCode = 1
}

main()
