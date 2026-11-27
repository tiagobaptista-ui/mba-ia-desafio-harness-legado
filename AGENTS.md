# AGENTS.md

Balcão: central de chamados com API (`api/`, Express + Prisma), worker de triagem e front (`web/`, React + Vite).
Responda em português. Este arquivo é o índice; o detalhe está nos links.

## Ambiente: cada clone ou worktree é uma cópia isolada

Rode tudo na raiz do repositório.

- `npm run up`: sobe Postgres próprio, migrations, seed, API, worker e front. Mostra API, front, banco e pasta de anexos.
  Pode rodar de novo sem derrubar: reinicia os processos e mantém portas e dados.
- `npm run down`: derruba só o que o up desta cópia iniciou. Com `-- --apagar-dados`, apaga também banco e anexos.
- Endereços desta cópia: saída do up ou `.balcao/estado.json`. Logs em `.balcao/logs/`.
- Nunca fixe porta, URL ou pasta no código (G11): tudo vem de `api/.env` e `web/.env.local`, que o up gera.
- Como o isolamento funciona: [docs/arquitetura.md](docs/arquitetura.md#isolamento-entre-cópias).

## Gates (rodam sozinhos no pre-commit)

- `npm run gates`: todos, em cerca de 5 s. `npm run gates -- G2 G10`: só alguns.
- A saída termina com uma linha por violação: `<regra> <arquivo> <detalhe>`. Corrija a causa; nunca cale (G13).
- Regras, ferramentas e como corrigir cada uma: [docs/gates.md](docs/gates.md).
- Mexeu na configuração de um gate? Rode `bash kit-gates/verificar.sh . "npm run gates"` (exige `git status` limpo).

## Camadas da API (`api/src/`): http → services → repositories → Prisma

- `http/`: rotas recebem serviços prontos; nunca importam `repositories/` nem `@prisma/client` (G4).
- `services/`: regra de negócio; lançam `DomainError` (`domain/errors.ts`); sem express, multer ou `http/` (G6).
- `repositories/`: único lugar com `@prisma/client` (G12). `integrations/`: único com `openai` (G7).
- `config/`: único lugar com `process.env` (G5). `main.ts` monta repositórios, serviços e app.
- Front: `import.meta.env` só em `web/src/config/` (G5); `web/` nunca importa `api/` (G8).
- Detalhe e regras de negócio: [docs/arquitetura.md](docs/arquitetura.md).

## Testes

- Unitários (sem banco): `cd api && npm test`. Um arquivo: `cd api && npx vitest run src/services/ticket-service.test.ts`.
- Caixa-preta, o contrato da API: `cd blackbox && npm ci && API_URL=<API> npm test`.
  Troque `<API>` pelo endereço que o up mostrou (ex.: `http://localhost:4000`).
- Integração (banco `_test` desta cópia, criado pelo up): `cd api && npm run test:integration`.

## Contas da seed (a caixa-preta depende delas)

| Papel | E-mail | Senha |
|---|---|---|
| admin | `admin@balcao.dev` | `Admin@123` |
| atendente | `agente@balcao.dev` | `Agente@123` |
| cliente | `cliente@balcao.dev` | `Cliente@123` |

## Regras de trabalho

- Não mude rotas, corpos, status nem códigos de erro. Rode a caixa-preta antes e depois.
- Não mova as pastas fixas: `api/src/{config,domain,http,services,repositories,integrations}`, `main.ts`, `jobs/triage-worker.ts`, `web/src/main.tsx`.
- Dependências: instale com `npm ci`, nunca com `npm install`. Para remover, use `node scripts/remover-dependencia.mjs <api|web> <pacote>`.
- Errou e o harness não pegou? Registre em [docs/incidentes.md](docs/incidentes.md) e mude o harness.
