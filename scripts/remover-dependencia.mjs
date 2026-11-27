// node scripts/remover-dependencia.mjs <api|web|.> <pacote> [<pacote>...]
//
// Remove dependências do package.json e do package-lock.json sem reescrever o resto do lockfile.
// Existe porque `npm uninstall` (e `npm install`), dependendo da versão do npm, regrava metadados
// de dezenas de pacotes que não têm nada a ver com a mudança (ver docs/incidentes.md).
// Depois de editar, confere com `npm ci`, que falha se package.json e lockfile não baterem.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [pasta, ...pacotes] = process.argv.slice(2)
if (!pasta || pacotes.length === 0) {
  console.error('uso: node scripts/remover-dependencia.mjs <api|web|.> <pacote> [<pacote>...]')
  process.exit(2)
}

const dir = path.resolve(RAIZ, pasta)
const arquivoPkg = path.join(dir, 'package.json')
const arquivoLock = path.join(dir, 'package-lock.json')
const pkg = JSON.parse(fs.readFileSync(arquivoPkg, 'utf8'))
const lock = JSON.parse(fs.readFileSync(arquivoLock, 'utf8'))
const CAMPOS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

for (const nome of pacotes) {
  const achou = CAMPOS.filter((c) => pkg[c]?.[nome])
  if (achou.length === 0) {
    console.error(`${nome} não está em ${path.relative(RAIZ, arquivoPkg)}`)
    process.exit(1)
  }
  for (const c of achou) {
    delete pkg[c][nome]
    delete lock.packages[''][c]?.[nome]
  }
}

// Tira do lockfile os pacotes que ninguém mais alcança, seguindo a resolução do npm:
// a dependência `d` de `node_modules/a` é `node_modules/a/node_modules/d` ou sobe até `node_modules/d`.
function resolver(origem, nome) {
  let base = origem
  for (;;) {
    const candidato = base ? `${base}/node_modules/${nome}` : `node_modules/${nome}`
    if (lock.packages[candidato]) return candidato
    if (!base) return null
    const i = base.lastIndexOf('/node_modules/')
    base = i === -1 ? '' : base.slice(0, i)
  }
}
const alcancados = new Set([''])
const fila = ['']
while (fila.length) {
  const atual = fila.pop()
  const info = lock.packages[atual]
  for (const c of CAMPOS) {
    for (const nome of Object.keys(info[c] ?? {})) {
      const alvo = resolver(atual, nome)
      if (alvo && !alcancados.has(alvo)) {
        alcancados.add(alvo)
        fila.push(alvo)
      }
    }
  }
}
const removidos = Object.keys(lock.packages).filter((k) => !alcancados.has(k) && !lock.packages[k].link)
for (const k of removidos) delete lock.packages[k]

fs.writeFileSync(arquivoPkg, JSON.stringify(pkg, null, 2) + '\n')
fs.writeFileSync(arquivoLock, JSON.stringify(lock, null, 2) + '\n')
console.log(`removido de ${path.relative(RAIZ, dir) || '.'}: ${pacotes.join(', ')}`)
console.log(`entradas tiradas do lockfile: ${removidos.join(', ') || '(nenhuma)'}`)

const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' })
if (ci.status !== 0) {
  console.error('npm ci falhou: package.json e lockfile não batem. Desfaça com git checkout e investigue.')
  process.exit(1)
}
