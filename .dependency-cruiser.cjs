// Regras de import do Balcão (gates G4, G6, G7, G8, G9 e G12), rodadas por scripts/gates.mjs.
// O nome de cada regra começa com o ID do gate: é assim que a lista final mostra o ID.
//
// tsPreCompilationDeps: true faz o dependency-cruiser ler o TypeScript antes da compilação, então
// contam também `import type`, `import { type X }`, `import('x').T`, `/// <reference types>`,
// `import x = require()`, `require()`, `import()` dinâmico e `export ... from`.
// Sem isso, imports só de tipo somem (o compilador apaga) e G6/G8 deixariam passar a violação.

const PRISMA = ['(^|/)node_modules/(@prisma/client|\\.prisma)(/|$)', '^@prisma/client(/|$)']
const EXPRESS_E_MULTER = [
  '(^|/)node_modules/(@types/)?(express|express-serve-static-core|multer)(/|$)',
  '^(express|express-serve-static-core|multer)(/|$)',
]
const OPENAI = ['(^|/)node_modules/openai(/|$)', '^openai(/|$)']

module.exports = {
  forbidden: [
    {
      name: 'G4-http-nao-acessa-dados',
      comment: 'api/src/http/ não importa @prisma/client nem api/src/repositories/: rota chama serviço.',
      severity: 'error',
      from: { path: '^api/src/http/' },
      to: { path: ['^api/src/repositories/', ...PRISMA] },
    },
    {
      name: 'G6-servico-nao-conhece-http',
      comment: 'api/src/services/ não importa express, multer nem api/src/http/, nem só de tipo.',
      severity: 'error',
      from: { path: '^api/src/services/' },
      to: { path: ['^api/src/http/', ...EXPRESS_E_MULTER] },
    },
    {
      name: 'G7-openai-so-em-integrations',
      comment: 'O pacote openai só é importado em api/src/integrations/.',
      severity: 'error',
      from: { path: '^(api|web)/', pathNot: '^api/src/integrations/' },
      to: { path: OPENAI },
    },
    {
      name: 'G8-web-nao-importa-api',
      comment: 'Nada em web/ importa arquivos de api/, nem só de tipo. O front tem os próprios tipos.',
      severity: 'error',
      from: { path: '^web/' },
      to: { path: ['^api/', '^(\\.\\./)+api/'] },
    },
    {
      name: 'G9-sem-import-circular',
      comment: 'Nenhum ciclo de imports em api/src/ nem em web/src/ (imports só de tipo contam).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'G12-prisma-so-em-repositories',
      comment:
        'Regra própria: dentro de api/src, só api/src/repositories/ importa @prisma/client. ' +
        'O worker de triagem criava o próprio PrismaClient e lia DATABASE_URL por fora da camada de dados.',
      severity: 'error',
      from: { path: '^api/src/', pathNot: '^api/src/repositories/' },
      to: { path: PRISMA },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
  },
}
