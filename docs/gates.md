# Gates

`npm run gates` roda todas as verificações em paralelo (cerca de 5 s), não para na primeira falha e termina com uma linha por violação:

```
G4 api/src/http/routes/stats.ts importa api/src/repositories/prisma.ts (G4-http-nao-acessa-dados)
G10 api/package.json lodash (dependência sem uso)
```

Formato: `<regra> <arquivo> <detalhe>`. O comando sai com código 1 se houver qualquer violação. Para rodar só algumas regras, use `npm run gates -- G2 G10`. O hook `.githooks/pre-commit` roda todos os gates antes de cada commit; o `npm run up` liga o hook com `git config core.hooksPath .githooks`.

Os gates precisam das dependências instaladas na raiz, em `api/` e em `web/` (o `npm run up` cuida disso).

## Regras

| ID | Regra | Ferramenta | Onde está a configuração |
|---|---|---|---|
| G1 | Zero erro de tipo em `api/` (src, prisma, test) e em `web/` (src, vite.config.ts) | `tsc --noEmit` | `api/tsconfig.json`, `web/tsconfig.json` |
| G2 | Lint sem erro e sem warning em `api/` e `web/`: nada de variável ou import sem uso nem de `any` explícito | ESLint + typescript-eslint, `--max-warnings 0` | `eslint.config.js` |
| G3 | Testes unitários da API (`api/src/**/*.test.ts`) passam | Vitest | `api/vitest.config.mts` |
| G4 | `api/src/http/` não importa `@prisma/client` nem `api/src/repositories/` | dependency-cruiser | `.dependency-cruiser.cjs` |
| G5 | `process.env` só em `api/src/config/`; `import.meta.env` só em `web/src/config/` | `scripts/gates/codigo.mjs` (árvore sintática do TypeScript) | o próprio script |
| G6 | `api/src/services/` não importa `express`, `multer` nem `api/src/http/`, nem só de tipo | dependency-cruiser | `.dependency-cruiser.cjs` |
| G7 | `openai` só é importado em `api/src/integrations/` | dependency-cruiser | `.dependency-cruiser.cjs` |
| G8 | Nada em `web/` importa arquivos de `api/`, nem só de tipo | dependency-cruiser | `.dependency-cruiser.cjs` |
| G9 | Nenhum import circular em `api/src/` nem em `web/src/` (ciclo só de tipo também conta) | dependency-cruiser | `.dependency-cruiser.cjs` |
| G10 | Nenhum arquivo, export (inclusive de tipo) ou dependência sem uso em `api/` e `web/` | knip | `api/knip.json`, `web/knip.json` |
| G11 | **Regra própria.** Nenhum endereço fixo (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, `/tmp/`) em `api/src/` e `web/src/` fora de `config/` | `scripts/gates/codigo.mjs` | o próprio script |
| G12 | **Regra própria.** Dentro de `api/src/`, só `api/src/repositories/` importa `@prisma/client` | dependency-cruiser | `.dependency-cruiser.cjs` |
| G13 | **Regra própria.** Nenhum comentário de supressão (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`) em `api/src/` e `web/src/` | `scripts/gates/codigo.mjs` | o próprio script |

As únicas exceções são as que a própria regra define: `config/` na G5 e na G11. Nenhum arquivo de `api/src/` ou `web/src/` fica fora das ferramentas.

### Imports só de tipo (G6, G8, G9)

O TypeScript apaga `import type` na compilação. Ferramentas que leem o JavaScript gerado (ou o grafo do bundler) não enxergam esses imports, e a G6 e a G8 deixariam a violação passar. O dependency-cruiser roda com `tsPreCompilationDeps: true`: ele lê o TypeScript antes da compilação e conta `import type`, `import { type X }`, `import('x').T`, `/// <reference types>`, `import x = require()`, `require()`, `import()` dinâmico e `export ... from`. As violações extras do kit (`G06-c`, `G06-d`, `G08-b` e `G09-d`) cobrem esses casos.

### Por que as regras próprias existem

- **G11, sem endereço fixo.** O Balcão "achava que era a única cópia no mundo". O CORS estava travado em `http://localhost:5173`, o front caía em `http://localhost:4000` e os anexos iam para `/tmp/balcao/uploads`. Com duas worktrees no ar, o front da segunda falava com a API da primeira e os anexos das duas se misturavam. Hoje todo endereço vem de `config/`, que lê o `.env` gerado pelo `npm run up` de cada cópia. A G11 impede que um endereço fixo volte a aparecer em qualquer outro lugar.
- **G12, Prisma só em repositories.** O worker de triagem criava o próprio `PrismaClient`, lia `DATABASE_URL` direto do ambiente e fazia as consultas por fora da camada de dados. A G4 só protege a camada http, então nada impedia um serviço ou um job de repetir isso. A G12 fecha a porta: dado só passa por `repositories/`.
- **G13, sem supressão.** Diante de um gate vermelho, o atalho de um agente é calar a ferramenta. Uma supressão esconde a violação de todos os gates, e o enunciado proíbe isso. A G13 transforma a proibição numa verificação mecânica.

## Como aplicar os exemplos de violação

Os exemplos ficam em `kit-gates/violacoes/`, no formato do kit: um `manifesto` com a regra e os arquivos `.modelo`, que nenhuma ferramenta analisa. O kit aplica uma violação por vez, roda os gates, confere se aparece uma linha com o ID e o arquivo, e desfaz tudo. Ele exige `git status` limpo.

```bash
bash kit-gates/verificar.sh . "npm run gates" G11
```

```bash
bash kit-gates/verificar.sh . "npm run gates" G12
```

```bash
bash kit-gates/verificar.sh . "npm run gates" G13
```

Sem o argumento final, o kit roda todas as 49 violações (as 19 originais e 30 extras), o que leva uns 4 minutos. Para aplicar um exemplo à mão, copie o `.modelo` para o caminho indicado sem a extensão, rode `npm run gates` e apague o arquivo depois:

```bash
cp kit-gates/violacoes/G11-a-cors-com-origem-fixa/arquivos/api/src/http/origem-front.ts.modelo api/src/http/origem-front.ts
```

```bash
npm run gates
```

```bash
rm api/src/http/origem-front.ts
```

Sempre que mudar a configuração de uma ferramenta de gate, rode o kit inteiro de novo: uma opção errada pode desligar uma regra em silêncio, e os gates continuam verdes.

## Como corrigir cada regra

- **G1/G2:** corrija o tipo ou o código. Troque `any` por um tipo de domínio (`api/src/domain/`) ou por `unknown` com validação. Um parâmetro posicional obrigatório que não é usado leva `_` na frente, como o `_next` do error handler do Express.
- **G3:** um teste quebrou. Rode só esse arquivo com `cd api && npx vitest run <arquivo>`.
- **G4:** a rota chama um serviço, e o serviço chama o repositório. Serviço novo é montado em `api/src/main.ts`, a raiz de composição, e chega à rota por `createApp`.
- **G5:** acrescente a variável ao schema de `api/src/config/env.ts` (ou a `web/src/config/env.ts`) e importe `env`.
- **G6:** o serviço lança `DomainError` (`api/src/domain/errors.ts`). O status HTTP de cada código fica em `api/src/http/errors.ts`. Arquivo enviado entra no serviço como `UploadedFile`, não como `Request`.
- **G7:** chame a IA por funções de `api/src/integrations/ai-client.ts`.
- **G8:** o front declara os próprios tipos do contrato (ver `web/src/api/tickets.ts`).
- **G9:** mova a função compartilhada para quem a usa, ou para um terceiro módulo.
- **G10:** apague o que está sem uso ou deixe de exportar. Para tirar uma dependência, use `node scripts/remover-dependencia.mjs <api|web> <pacote>` (não use `npm uninstall`).
- **G11:** o endereço vai para `config/` e, se mudar por cópia, também para o `npm run up` (`scripts/up.mjs`).
- **G12:** crie ou estenda um repositório em `api/src/repositories/`.
- **G13:** remova o comentário e corrija o que ele escondia.
