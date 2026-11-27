// Gates que olham a árvore sintática do código (TypeScript compiler API), não os imports:
//   G5  process.env só em api/src/config/; import.meta.env só em web/src/config/
//   G11 (regra própria) nenhum endereço fixo (localhost, 127.0.0.1, 0.0.0.0, ::1, /tmp/) em
//       api/src/ e web/src/ fora de config/: é o que impedia duas cópias de rodar juntas.
//   G13 (regra própria) nenhum comentário de supressão (eslint-disable, @ts-ignore,
//       @ts-expect-error, @ts-nocheck) em api/src/ e web/src/: violação se corrige, não se cala.
// Uso: node scripts/gates/codigo.mjs  → imprime JSON [{ id, arquivo, linha, mensagem }]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ts = createRequire(import.meta.url)('typescript')

const EXTENSOES = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const MODULOS_PROCESS = new Set(['process', 'node:process'])
const ENDERECO_FIXO = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|(^|[^\w.])\/tmp\//
const SUPRESSAO = /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck/

// Só olha comentários de verdade: percorre todos os tokens da árvore e pede ao TypeScript os
// comentários antes e depois de cada um. Texto dentro de string, template ou regex não conta.
function supressoes(arquivo, texto, fonte) {
  const achados = []
  const vistos = new Set()
  const olhar = (pos) => {
    const faixas = [...(ts.getLeadingCommentRanges(texto, pos) ?? []), ...(ts.getTrailingCommentRanges(texto, pos) ?? [])]
    for (const faixa of faixas) {
      if (vistos.has(faixa.pos)) continue
      vistos.add(faixa.pos)
      const trecho = texto.slice(faixa.pos, faixa.end).match(SUPRESSAO)
      if (trecho) {
        const linha = fonte.getLineAndCharacterOfPosition(faixa.pos).line + 1
        achados.push({ id: 'G13', arquivo, linha, mensagem: `comentário de supressão (${trecho[0]}): corrija a violação` })
      }
    }
  }
  ;(function andar(no) {
    olhar(no.pos)
    for (const filho of no.getChildren(fonte)) andar(filho)
  })(fonte)
  return achados
}

function arquivos(pasta) {
  const abs = path.join(RAIZ, pasta)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && EXTENSOES.test(e.name))
    .map((e) => path.relative(RAIZ, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'))
    .filter((f) => !f.includes('/node_modules/'))
}

function nomeDaPropriedade(no) {
  if (ts.isPropertyAccessExpression(no)) return no.name.text
  if (ts.isElementAccessExpression(no) && ts.isStringLiteralLike(no.argumentExpression)) return no.argumentExpression.text
  return null
}

function ehImportMeta(no) {
  return ts.isMetaProperty(no) && no.keywordToken === ts.SyntaxKind.ImportKeyword && no.name.text === 'meta'
}

// `process`, `globalThis.process`, `global.process` ou um nome importado do módulo process.
function ehProcess(no, nomesDeProcess) {
  if (ts.isIdentifier(no)) return nomesDeProcess.has(no.text)
  return nomeDaPropriedade(no) === 'process' && ts.isIdentifier(no.expression) && ['globalThis', 'global'].includes(no.expression.text)
}

function analisar(arquivo, { procurarProcessEnv, procurarImportMetaEnv, procurarEndereco }) {
  const texto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8')
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true)
  const achados = supressoes(arquivo, texto, fonte)
  const nomesDeProcess = new Set(['process'])
  const linha = (no) => fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1
  const achar = (id, no, mensagem) => achados.push({ id, arquivo, linha: linha(no), mensagem })

  // Primeiro passo: nomes locais ligados ao módulo process (import p from 'node:process', require('process')).
  ts.forEachChild(fonte, function marcar(no) {
    if (ts.isImportDeclaration(no) && ts.isStringLiteral(no.moduleSpecifier) && MODULOS_PROCESS.has(no.moduleSpecifier.text)) {
      const clausula = no.importClause
      if (clausula?.name) nomesDeProcess.add(clausula.name.text)
      const nomeados = clausula?.namedBindings
      if (nomeados && ts.isNamespaceImport(nomeados)) nomesDeProcess.add(nomeados.name.text)
      if (procurarProcessEnv && nomeados && ts.isNamedImports(nomeados)) {
        for (const el of nomeados.elements) {
          if ((el.propertyName ?? el.name).text === 'env') achar('G5', el, "importa env de 'process'")
        }
      }
    }
    if (
      ts.isVariableDeclaration(no) &&
      ts.isIdentifier(no.name) &&
      no.initializer &&
      ts.isCallExpression(no.initializer) &&
      ts.isIdentifier(no.initializer.expression) &&
      no.initializer.expression.text === 'require' &&
      no.initializer.arguments[0] &&
      ts.isStringLiteralLike(no.initializer.arguments[0]) &&
      MODULOS_PROCESS.has(no.initializer.arguments[0].text)
    ) {
      nomesDeProcess.add(no.name.text)
    }
    ts.forEachChild(no, marcar)
  })

  ts.forEachChild(fonte, function visitar(no) {
    const prop = nomeDaPropriedade(no)
    if (procurarProcessEnv && prop === 'env' && ehProcess(no.expression, nomesDeProcess)) {
      achar('G5', no, 'lê process.env fora de api/src/config/')
    }
    if (procurarImportMetaEnv && prop === 'env' && ehImportMeta(no.expression)) {
      achar('G5', no, 'lê import.meta.env fora de web/src/config/')
    }
    // const { env } = process  /  const { env } = import.meta
    if (ts.isVariableDeclaration(no) && ts.isObjectBindingPattern(no.name) && no.initializer) {
      const deProcess = procurarProcessEnv && ehProcess(no.initializer, nomesDeProcess)
      const deImportMeta = procurarImportMetaEnv && ehImportMeta(no.initializer)
      if (deProcess || deImportMeta) {
        for (const el of no.name.elements) {
          const nome = el.propertyName ?? el.name
          if ((ts.isIdentifier(nome) || ts.isStringLiteralLike(nome)) && nome.text === 'env') {
            achar('G5', el, deProcess ? 'desestrutura env de process' : 'desestrutura env de import.meta')
          }
        }
      }
    }
    if (
      procurarEndereco &&
      (ts.isStringLiteralLike(no) || ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no)) &&
      ENDERECO_FIXO.test(no.text)
    ) {
      achar('G11', no, `endereço fixo no código: "${no.text.slice(0, 60)}" (leve para config/)`)
    }
    ts.forEachChild(no, visitar)
  })
  return achados
}

const achados = []
for (const arquivo of arquivos('api/src')) {
  const emConfig = arquivo.startsWith('api/src/config/')
  achados.push(...analisar(arquivo, { procurarProcessEnv: !emConfig, procurarEndereco: !emConfig }))
}
for (const arquivo of arquivos('web/src')) {
  const emConfig = arquivo.startsWith('web/src/config/')
  achados.push(...analisar(arquivo, { procurarImportMetaEnv: !emConfig, procurarEndereco: !emConfig }))
}
process.stdout.write(JSON.stringify(achados))
