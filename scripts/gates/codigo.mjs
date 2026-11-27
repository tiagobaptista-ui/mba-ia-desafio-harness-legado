// Gates que olham a árvore sintática do código (TypeScript compiler API), não os imports:
//   G5  process.env só em api/src/config/; import.meta.env só em web/src/config/
//       (inclusive por apelido, cast, require/import() e chave em constante; veja docs/gates.md)
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

// O que um arquivo revelou sobre process e import.meta. Os nomes valem para o arquivo inteiro,
// sem escopo: um nome reaproveitado em outro bloco pode acusar a mais, mas nada passa a menos.
function novoContexto() {
  return {
    process: new Set(['process']), // variáveis e parâmetros que guardam process
    importMeta: new Set(), // variáveis e parâmetros que guardam import.meta
    membrosProcess: new Set(), // campos e propriedades que guardam process (this.proc, obj.p)
    membrosImportMeta: new Set(),
    constantes: new Map(), // nome -> textos que ele recebe (const chave = 'env')
  }
}

// Tira parênteses, `as`, `satisfies`, `!` e `<T>x`: `(process as NodeJS.Process).env` continua sendo process.env.
function semEnvoltorio(no) {
  while (
    ts.isParenthesizedExpression(no) ||
    ts.isAsExpression(no) ||
    ts.isSatisfiesExpression(no) ||
    ts.isNonNullExpression(no) ||
    ts.isTypeAssertionExpression(no)
  ) {
    no = no.expression
  }
  return no
}

// Os valores que uma expressão pode ter: os dois lados de `??`, `||`, `&&` e do ternário, e o último da vírgula.
function candidatos(no) {
  no = semEnvoltorio(no)
  if (ts.isConditionalExpression(no)) return [...candidatos(no.whenTrue), ...candidatos(no.whenFalse)]
  if (ts.isBinaryExpression(no)) {
    const op = no.operatorToken.kind
    const logico = [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken]
    if (logico.includes(op)) return [...candidatos(no.left), ...candidatos(no.right)]
    if (op === ts.SyntaxKind.CommaToken) return candidatos(no.right)
  }
  return [no]
}

// Textos que uma chave calculada pode ter: 'env', `env` ou um nome que recebeu string (process[chave]).
function textosDaExpressao(no, ctx) {
  no = semEnvoltorio(no)
  if (ts.isStringLiteralLike(no)) return [no.text]
  if (ts.isIdentifier(no)) return [...(ctx.constantes.get(no.text) ?? [])]
  return []
}

// Nomes possíveis da propriedade lida em `a.b`, `a['b']` ou `a[chave]`; vazio se não é acesso.
function chavesDoAcesso(no, ctx) {
  if (ts.isPropertyAccessExpression(no)) return [no.name.text]
  if (ts.isElementAccessExpression(no)) return textosDaExpressao(no.argumentExpression, ctx)
  return []
}

// Nome de uma propriedade declarada ou desestruturada: `env`, `'env'`, `#proc` ou `[chave]`.
function chavesDoNome(nome, ctx) {
  if (ts.isIdentifier(nome) || ts.isPrivateIdentifier(nome) || ts.isStringLiteralLike(nome)) return [nome.text]
  if (ts.isComputedPropertyName(nome)) return textosDaExpressao(nome.expression, ctx)
  return []
}

function ehGlobal(no) {
  no = semEnvoltorio(no)
  return ts.isIdentifier(no) && ['globalThis', 'global'].includes(no.text)
}

// require('node:process') ou await import('node:process'). Sem await, import() é só uma promise.
function ehModuloProcess(no) {
  const aguardado = ts.isAwaitExpression(no)
  if (aguardado) no = semEnvoltorio(no.expression)
  if (!ts.isCallExpression(no)) return false
  const modulo = no.arguments[0]
  if (!modulo || !ts.isStringLiteralLike(modulo) || !MODULOS_PROCESS.has(modulo.text)) return false
  if (no.expression.kind === ts.SyntaxKind.ImportKeyword) return aguardado
  return ts.isIdentifier(no.expression) && no.expression.text === 'require'
}

// `process`, `globalThis.process`, o módulo process ou um apelido de qualquer um deles.
function ehProcess(no, ctx) {
  return candidatos(no).some((valor) => {
    if (ts.isIdentifier(valor)) return ctx.process.has(valor.text)
    if (ehModuloProcess(valor)) return true
    const chaves = chavesDoAcesso(valor, ctx)
    if (chaves.some((k) => ctx.membrosProcess.has(k))) return true
    return chaves.includes('process') && ehGlobal(valor.expression)
  })
}

// `import.meta` ou um apelido dele.
function ehImportMeta(no, ctx) {
  return candidatos(no).some((valor) => {
    if (ts.isIdentifier(valor)) return ctx.importMeta.has(valor.text)
    if (ts.isMetaProperty(valor)) return valor.keywordToken === ts.SyntaxKind.ImportKeyword && valor.name.text === 'meta'
    return chavesDoAcesso(valor, ctx).some((k) => ctx.membrosImportMeta.has(k))
  })
}

function ehAtribuicao(no) {
  if (!ts.isBinaryExpression(no)) return false
  const op = no.operatorToken.kind
  return op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment
}

// Onde um valor é guardado: em nomes (variável, parâmetro com padrão, `p = x`, `p ??= x`) ou em
// membros (campo de classe, propriedade de objeto, `this.p = x`). null se o nó não guarda nada.
function destinoDoValor(no, ctx) {
  const comNome = ts.isVariableDeclaration(no) || ts.isParameter(no) || ts.isBindingElement(no)
  if (comNome && ts.isIdentifier(no.name) && no.initializer) return { nomes: [no.name.text], membros: [], valor: no.initializer }
  if (ehAtribuicao(no)) {
    const alvo = semEnvoltorio(no.left)
    if (ts.isIdentifier(alvo)) return { nomes: [alvo.text], membros: [], valor: no.right }
    return { nomes: [], membros: chavesDoAcesso(alvo, ctx), valor: no.right }
  }
  if ((ts.isPropertyDeclaration(no) || ts.isPropertyAssignment(no)) && no.initializer) {
    return { nomes: [], membros: chavesDoNome(no.name, ctx), valor: no.initializer }
  }
  if (ts.isShorthandPropertyAssignment(no)) return { nomes: [], membros: [no.name.text], valor: no.name }
  return null
}

// Marca tudo que passa a guardar process ou import.meta, inclusive apelido de apelido e
// desestruturação (`const { process: p } = globalThis`, `const { proc } = this`). Repete até
// não aparecer nada novo, para não depender da ordem do arquivo.
function marcarApelidos(fonte, ctx) {
  ts.forEachChild(fonte, function constantes(no) {
    const valor = ts.isVariableDeclaration(no) && no.initializer ? semEnvoltorio(no.initializer) : null
    if (valor && ts.isIdentifier(no.name) && ts.isStringLiteralLike(valor)) {
      ctx.constantes.set(no.name.text, (ctx.constantes.get(no.name.text) ?? new Set()).add(valor.text))
    }
    ts.forEachChild(no, constantes)
  })

  let mudou = true
  const guardar = (conjunto, chaves) => {
    for (const chave of chaves) {
      if (!conjunto.has(chave)) {
        conjunto.add(chave)
        mudou = true
      }
    }
  }
  while (mudou) {
    mudou = false
    ts.forEachChild(fonte, function apelidar(no) {
      const destino = destinoDoValor(no, ctx)
      if (destino && ehProcess(destino.valor, ctx)) {
        guardar(ctx.process, destino.nomes)
        guardar(ctx.membrosProcess, destino.membros)
      }
      if (destino && ehImportMeta(destino.valor, ctx)) {
        guardar(ctx.importMeta, destino.nomes)
        guardar(ctx.membrosImportMeta, destino.membros)
      }
      if (ts.isBindingElement(no) && ts.isIdentifier(no.name) && ts.isObjectBindingPattern(no.parent)) {
        const chaves = chavesDoNome(no.propertyName ?? no.name, ctx)
        const origem = no.parent.parent.initializer
        if (chaves.some((k) => ctx.membrosProcess.has(k)) || (chaves.includes('process') && origem && ehGlobal(origem))) {
          guardar(ctx.process, [no.name.text])
        }
        if (chaves.some((k) => ctx.membrosImportMeta.has(k))) guardar(ctx.importMeta, [no.name.text])
      }
      ts.forEachChild(no, apelidar)
    })
  }
}

function analisar(arquivo, { procurarProcessEnv, procurarImportMetaEnv, procurarEndereco }) {
  const texto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8')
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true)
  const achados = supressoes(arquivo, texto, fonte)
  const ctx = novoContexto()
  const linha = (no) => fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1
  const achar = (id, no, mensagem) => achados.push({ id, arquivo, linha: linha(no), mensagem })

  // Primeiro passo: nomes ligados ao módulo process por import (default, namespace,
  // `{ default as p }` e `import p = require('process')`). require() e import() o marcarApelidos acha.
  ts.forEachChild(fonte, function marcar(no) {
    if (ts.isImportDeclaration(no) && ts.isStringLiteral(no.moduleSpecifier) && MODULOS_PROCESS.has(no.moduleSpecifier.text)) {
      const clausula = no.importClause
      if (clausula?.name) ctx.process.add(clausula.name.text)
      const nomeados = clausula?.namedBindings
      if (nomeados && ts.isNamespaceImport(nomeados)) ctx.process.add(nomeados.name.text)
      for (const el of nomeados && ts.isNamedImports(nomeados) ? nomeados.elements : []) {
        const importado = (el.propertyName ?? el.name).text
        if (importado === 'default') ctx.process.add(el.name.text)
        if (procurarProcessEnv && importado === 'env') achar('G5', el, "importa env de 'process'")
      }
    }
    if (
      ts.isImportEqualsDeclaration(no) &&
      ts.isExternalModuleReference(no.moduleReference) &&
      ts.isStringLiteralLike(no.moduleReference.expression) &&
      MODULOS_PROCESS.has(no.moduleReference.expression.text)
    ) {
      ctx.process.add(no.name.text)
    }
    ts.forEachChild(no, marcar)
  })
  marcarApelidos(fonte, ctx)

  ts.forEachChild(fonte, function visitar(no) {
    const leEnv = chavesDoAcesso(no, ctx).includes('env')
    if (procurarProcessEnv && leEnv && ehProcess(no.expression, ctx)) {
      achar('G5', no, 'lê process.env fora de api/src/config/')
    }
    if (procurarImportMetaEnv && leEnv && ehImportMeta(no.expression, ctx)) {
      achar('G5', no, 'lê import.meta.env fora de web/src/config/')
    }
    // const { env } = process, function f({ env } = process), const { env } = import.meta (ou de um apelido)
    const desestrutura = ts.isVariableDeclaration(no) || ts.isParameter(no) || ts.isBindingElement(no)
    if (desestrutura && ts.isObjectBindingPattern(no.name) && no.initializer) {
      const deProcess = procurarProcessEnv && ehProcess(no.initializer, ctx)
      const deImportMeta = procurarImportMetaEnv && ehImportMeta(no.initializer, ctx)
      if (deProcess || deImportMeta) {
        for (const el of no.name.elements) {
          if (chavesDoNome(el.propertyName ?? el.name, ctx).includes('env')) {
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
