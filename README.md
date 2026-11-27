# Balcão

Central de chamados. Clientes abrem chamados, uma IA faz a triagem (categoria e prioridade) em segundo plano, atendentes assumem, respondem e resolvem, e o admin acompanha as estatísticas.

- `api/`: API em Express + Prisma e o worker de triagem.
- `web/`: front em React + Vite.
- `blackbox/`: testes caixa-preta da API (o contrato HTTP).
- `kit-gates/`: kit que testa os gates plantando violações.
- `scripts/`: subida, derrubada, gates e utilitários do harness.

Este repositório também é um harness para agentes de código. Vários agentes trabalham ao mesmo tempo, cada um na sua worktree, guiados por gates e por uma documentação curta ([AGENTS.md](AGENTS.md)).

## Como rodar

### Pré-requisitos

- Node.js 22 ou superior (LTS)
- Docker com `docker compose`, rodando
- Git

Nada mais precisa estar instalado: a subida instala as dependências e sobe o Postgres num container.

### Subir

Na raiz do repositório, num clone limpo:

```bash
npm run up
```

Esse comando, sozinho:

1. instala as dependências da raiz, de `api/` e de `web/` com `npm ci` (só quando o lockfile mudou);
2. escolhe portas livres para API, front e Postgres (de preferência 4000, 5173 e 5432);
3. gera `api/.env` e `web/.env.local` com os endereços desta cópia;
4. sobe um Postgres só desta cópia e cria o banco e o banco de testes;
5. aplica as migrations e carrega a seed (idempotente);
6. liga o hook de pre-commit (`git config core.hooksPath .githooks`);
7. sobe API, worker e front em segundo plano e espera os três responderem.

No fim, ele mostra o que a cópia está usando:

```
Balcão no ar (cópia copia-a-1f2e3d)
  API      http://localhost:4000   (saúde: http://localhost:4000/api/health)
  Front    http://localhost:5173
  Banco    balcao_copia_a_1f2e3d em postgresql://balcao:balcao@localhost:5432 (container do projeto balcao-copia-a-1f2e3d)
  Anexos   /caminho/da/copia/.balcao/uploads
  Logs     /caminho/da/copia/.balcao/logs
  IA       modo fake
```

Pode rodar `npm run up` de novo sem derrubar antes: ele reinicia os processos, mantém portas e dados e não duplica a seed. Os endereços também ficam gravados em `.balcao/estado.json`.

### Derrubar

```bash
npm run down
```

Encerra a API, o worker, o front e o Postgres que a subida desta cópia iniciou, sem tocar em outras cópias. Os dados continuam no volume, e a próxima subida volta nas mesmas portas. Para apagar também o banco e os anexos:

```bash
npm run down -- --apagar-dados
```

### Duas cópias ao mesmo tempo

Cada clone ou worktree é uma cópia independente:

```bash
git worktree add ../copia-b
```

```bash
cd ../copia-b && npm run up
```

A segunda cópia recebe outras portas (ex.: 4001, 5174 e 5433), outro banco, outra pasta de anexos e o próprio worker. O front de cada cópia conversa com a API da mesma cópia.

### Gates

```bash
npm run gates
```

Roda todas as verificações em cerca de 5 segundos, sem parar na primeira falha, e termina com uma linha por violação (`<regra> <arquivo> <detalhe>`). Sai com código 1 se alguma regra falhar. O mesmo comando roda no pre-commit.

### Testes

```bash
cd api && npm test
```

```bash
cd blackbox && npm ci && API_URL=http://localhost:4000 npm test
```

```bash
cd api && npm run test:integration
```

Os unitários não precisam de banco. Na caixa-preta, troque o `API_URL` pelo endereço da API que o `npm run up` mostrou. Os de integração usam o banco `_test` da própria cópia, criado pela subida.

## Contas da seed

| Papel | E-mail | Senha |
|---|---|---|
| admin | `admin@balcao.dev` | `Admin@123` |
| atendente | `agente@balcao.dev` | `Agente@123` |
| cliente | `cliente@balcao.dev` | `Cliente@123` |

## IA

Por padrão a API usa o modo fake (`AI_MODE=fake`), que classifica os chamados por palavras-chave e não precisa de chave. Para usar a OpenAI, coloque `AI_MODE=openai` e `OPENAI_API_KEY` no `api/.env`. O `npm run up` preserva esses valores. Um título com `[falha-ia]` força a falha da triagem no modo fake.

## Gates

| ID | Regra | Ferramenta |
|---|---|---|
| G1 | Zero erro de tipo em `api/` e `web/` | `tsc --noEmit` |
| G2 | Lint sem erro nem warning (variável ou import sem uso, `any` explícito) | ESLint + typescript-eslint |
| G3 | Testes unitários da API passam | Vitest |
| G4 | `api/src/http/` não importa `@prisma/client` nem `repositories/` | dependency-cruiser |
| G5 | `process.env` só em `api/src/config/`; `import.meta.env` só em `web/src/config/` | `scripts/gates/codigo.mjs` |
| G6 | `api/src/services/` não importa `express`, `multer` nem `http/` (nem só de tipo) | dependency-cruiser |
| G7 | `openai` só em `api/src/integrations/` | dependency-cruiser |
| G8 | `web/` não importa nada de `api/` (nem só de tipo) | dependency-cruiser |
| G9 | Nenhum import circular em `api/src/` e `web/src/` | dependency-cruiser |
| G10 | Nenhum arquivo, export ou dependência sem uso em `api/` e `web/` | knip |
| G11 | **Própria:** nenhum endereço fixo (`localhost`, `127.0.0.1`, `/tmp/`…) fora de `config/` | `scripts/gates/codigo.mjs` |
| G12 | **Própria:** em `api/src/`, só `repositories/` importa `@prisma/client` | dependency-cruiser |
| G13 | **Própria:** nenhum `eslint-disable`, `@ts-ignore`, `@ts-expect-error` ou `@ts-nocheck` em `api/src/` e `web/src/` | `scripts/gates/codigo.mjs` |

O `scripts/gates/codigo.mjs` lê a árvore sintática do TypeScript, então pega `process.env`, `process['env']`, `const { env } = process`, `import { env } from 'node:process'`, `import.meta['env']`, `require('node:process').env` e os apelidos (`const proc = process; proc.env`, `this.proc.env`, `const meta = import.meta; meta.env`). A lista completa está em [docs/gates.md](docs/gates.md#formas-de-ler-o-ambiente-g5). O dependency-cruiser roda com `tsPreCompilationDeps: true` para contar também os imports que só existem em tipo. Motivação de cada regra própria e como corrigir cada violação: [docs/gates.md](docs/gates.md).

### Exemplos de violação das regras próprias

Os exemplos ficam versionados em `kit-gates/violacoes/` (`G11-*`, `G12-*` e `G13-*`), no formato do kit. Com o `git status` limpo, o kit aplica um exemplo por vez, roda os gates, confere a linha com o ID e o arquivo e desfaz tudo:

```bash
bash kit-gates/verificar.sh . "npm run gates" G11
```

```bash
bash kit-gates/verificar.sh . "npm run gates" G12
```

```bash
bash kit-gates/verificar.sh . "npm run gates" G13
```

Para aplicar à mão, copie um `.modelo` para o mesmo caminho sem a extensão e rode `npm run gates`. Por exemplo, `kit-gates/violacoes/G11-a-cors-com-origem-fixa/arquivos/api/src/http/origem-front.ts.modelo` vai para `api/src/http/origem-front.ts`. Apague o arquivo depois.

O kit também traz 27 variações das invariantes G1 a G10, com outras formas de escrever o mesmo erro (env entre colchetes, apelido de `process`, tipo inline do Express, reexport de repositório, ciclo de três arquivos, ciclo só de tipo…). Sem o argumento final, ele roda as 54 violações em uns 5 minutos.

## Decisões

### Como as cópias foram isoladas

O Balcão tinha endereço fixo dos dois lados. A API usava a porta 4000, o CORS travado em `http://localhost:5173`, os anexos em `/tmp/balcao/uploads` e o Postgres compartilhado na 5432 com o banco `balcao`. No front, `http://localhost:4000` estava espalhado em três arquivos, e o Vite ficava preso na 5173. Hoje:

- **Identidade:** cada cópia tem uma identidade derivada do caminho da pasta (nome + hash), que nomeia o projeto compose, o volume e o banco.
- **Banco:** cada cópia sobe o próprio Postgres (`docker compose -p balcao-<cópia>`), com porta e volume próprios. Assim, derrubar uma cópia nunca derruba o banco da outra.
- **Portas:** escolhidas livres na subida e gravadas em `.balcao/estado.json`; uma cópia não pega as portas gravadas pelas outras worktrees.
- **Anexos:** vão para `.balcao/uploads/` dentro da própria cópia.
- **Configuração:** porta, CORS, pasta de anexos e URL da API saem de `api/src/config/env.ts` e `web/src/config/env.ts`, que leem o `.env` gerado pela subida. A regra G11 impede que um endereço fixo volte.
- **Processos:** sobem em segundo plano com pid e hora de início gravados. O `down` só derruba os processos que batem com esse registro.
- **Seed:** idempotente, com `upsert` nas contas e criação condicional dos chamados de exemplo.

### Como as violações que já existiam foram corrigidas

Primeiro vieram os gates, que acenderam o código inteiro (73 violações). Depois, a correção guiada pela saída deles:

- **G4:** as rotas viraram fábricas que recebem serviços. O `main.ts` é a raiz de composição (repositórios → serviços → `createApp`). Health, estatísticas e `/me` ganharam serviço e repositório próprios.
- **G6:** os serviços lançam `DomainError(código, mensagem)`. O `http/errors.ts` traduz cada código para o status HTTP. O serviço de anexos recebe o usuário e o arquivo, não o `Request`.
- **G7:** `/suggest-reply` passou a usar `integrations/ai-client.ts` por meio de um `SuggestionService`.
- **G8:** o front declara os próprios tipos do contrato.
- **G9:** `formatTicketRef` mudou para o `notification-service`, o que desfez o ciclo com o `ticket-service`.
- **G10:** saíram `utils/legacy-sla.ts`, `calculateSlaDeadline`, `formatCurrency`, `lodash` e `axios`. Exports internos deixaram de ser exportados.
- **G12:** o worker usa `TriageService` e `ticketRepository` em vez de um `PrismaClient` próprio.
- **G2:** tipos de domínio (`Reply`, `Attachment`, `User`) substituíram o `any`.

A API não mudou. A caixa-preta passou com 51/51 antes e depois. Um teste diferencial com 43 requisições, inclusive casos de borda, comparou o código original e o refatorado no mesmo banco e deu resposta idêntica em todas. Os serviços novos ganharam testes unitários.

### O que mudou na documentação para agentes

- O `CLAUDE.md` original mandava rodar `npm run migrate` (não existia) e apontava pastas que não existem (`api/src/controllers`, `api/tests`, `web/src/store`). Também mandava usar axios (o front usava `fetch`) e usar `any` "para não travar a entrega". Ele saiu de cena e hoje só aponta para o `AGENTS.md`.
- O [AGENTS.md](AGENTS.md) é um índice de menos de 60 linhas: como subir, derrubar e rodar os gates, as contas da seed, as regras de camada e links para o detalhe ([docs/gates.md](docs/gates.md) e [docs/arquitetura.md](docs/arquitetura.md)).
- Cada regra que importa é verificada por um gate, não só escrita. O hook de pre-commit roda os gates, e a G13 impede que um agente cale um gate em vez de corrigir.
- Os erros do agente durante o trabalho viraram mudanças no harness (ver abaixo).

## Registro de incidentes

[docs/incidentes.md](docs/incidentes.md): erros reais do agente durante a instalação do harness e a mudança no harness que impede cada um de se repetir.

## Problemas comuns

- **`npm run up` diz que o Docker não responde:** abra o Docker e rode de novo.
- **Chamado fica "Em triagem" para sempre:** o worker caiu. Veja `.balcao/logs/worker.log` e rode `npm run up` de novo.
- **Erro de CORS no navegador:** abra o front pelo endereço `http://localhost:<porta>` que a subida mostrou, e não por `127.0.0.1`.
- **Algo não subiu:** a subida mostra o final do log do processo que falhou. Os logs completos ficam em `.balcao/logs/`.
