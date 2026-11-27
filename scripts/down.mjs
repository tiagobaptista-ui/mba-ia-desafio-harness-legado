// npm run down: derruba tudo que o `npm run up` desta cópia iniciou (API, worker, front e o
// Postgres do projeto desta cópia). Não mexe em outras cópias. Os dados ficam no volume.
// npm run down -- --apagar-dados também remove o volume do banco e a pasta de anexos.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { RAIZ, gravarEstado, identidade, lerEstado, log, pararProcesso } from './lib/copia.mjs'

async function main() {
  const apagarDados = process.argv.includes('--apagar-dados')
  const id = identidade()
  const estado = lerEstado()

  for (const [nome, registro] of Object.entries(estado.processos ?? {})) {
    if (await pararProcesso(nome, registro)) log(`${nome} parado (pid ${registro.pid})`)
  }
  estado.processos = {}

  const args = ['compose', '-p', id.projetoCompose, 'down', ...(apagarDados ? ['--volumes'] : [])]
  const r = spawnSync('docker', args, { cwd: RAIZ, encoding: 'utf8' })
  if (r.status !== 0) {
    process.stderr.write(r.stderr)
    log(`não consegui derrubar o Postgres do projeto ${id.projetoCompose} (o Docker está rodando?)`)
    process.exitCode = 1
  } else {
    log(`Postgres do projeto ${id.projetoCompose} derrubado${apagarDados ? ', volume apagado' : ''}`)
  }

  if (apagarDados) {
    fs.rmSync(id.pastaAnexos, { recursive: true, force: true })
    log(`anexos apagados (${id.pastaAnexos})`)
  }

  // As portas ficam no estado para a próxima subida desta cópia voltar nos mesmos endereços.
  if (fs.existsSync(id.pastaLogs) || Object.keys(estado.portas ?? {}).length) gravarEstado(estado)
  log(`cópia ${id.slug} derrubada`)
}

main()
