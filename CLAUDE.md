# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Responda sempre em português.

## Contexto

Balcão é uma central de chamados: o cliente abre, um worker classifica com IA, o atendente responde e resolve, e o admin vê as estatísticas. Este repositório é o desafio 2 do MBA (`ENUNCIADO.md`). A tarefa é instalar um harness para agentes: subida com um comando, worktrees isoladas, gates G1–G10, hook de pre-commit, `AGENTS.md` e registro de incidentes. **Não é para criar feature nem mudar comportamento**: rotas, corpos, status e códigos de erro da API ficam como estão, e a suíte `blackbox/` é o contrato. Não mova nem renomeie as pastas e entradas fixas: `api/src/{config,domain,http,services,repositories,integrations}/`, `api/src/main.ts`, `api/src/jobs/triage-worker.ts`, `web/src/main.tsx` e o padrão `api/src/**/*.test.ts`. Quando o `AGENTS.md` existir, este arquivo deve passar a apontar para ele.

## Comandos

Requisitos: Node 22+ e Docker. Use `npm ci` em vez de `npm install`, que reescreve metadados do `package-lock.json`. Não existem `npm run migrate`, script de lint nem script de typecheck.

Subida manual (por enquanto não há comando único; são três terminais):

```bash
docker compose up -d                        # Postgres 16 na 5432; banco, usuário e senha: balcao
cd api && npm ci && cp .env.example .env
npx prisma migrate deploy && npm run seed   # a seed NÃO é idempotente
npm run dev                                 # API na :4000 (tsx watch)
npm run worker                              # worker de triagem, em outro terminal, dentro de api/
cd web && npm ci && npm run dev             # front na :5173
```

Verificações:

- Tipos: `cd api && npx tsc --noEmit` e `cd web && npx tsc` (o tsconfig do web já tem `noEmit`).
- Testes unitários da API (sem banco): `cd api && npm test`. Para um arquivo: `npx vitest run src/services/ticket-service.test.ts`. Para um caso: `npx vitest run -t "<nome do teste>"`.
- Testes de integração: usam o banco `balcao_test` via `DATABASE_URL_TEST` do `.env` e apagam todas as tabelas. Prepare uma vez com `docker compose exec db psql -U balcao -c "CREATE DATABASE balcao_test"` e, dentro de `api/`, `DATABASE_URL=postgresql://balcao:balcao@localhost:5432/balcao_test npx prisma migrate deploy`. Depois rode `npm run test:integration`.
- Caixa-preta (precisa da API e do worker no ar, com a seed carregada): `cd blackbox && npm ci && API_URL=http://localhost:4000 npm test`. Para um arquivo: `npx vitest run tests/triage.test.ts`.
- Kit dos gates: `bash kit-gates/verificar.sh . "<comando de gates>" [G4]`. Exige `git status` limpo e gates passando antes da rodada.

Contas da seed (a caixa-preta depende delas, não altere): `admin@balcao.dev` / `Admin@123`, `agente@balcao.dev` / `Agente@123`, `cliente@balcao.dev` / `Cliente@123`.

## Arquitetura

### API (`api/src`)

- `http/`: `app.ts` monta o Express e registra `/api/{health,auth,tickets,attachments,stats}`, com uma rota por arquivo em `http/routes/`. `errors.ts` tem `HttpError(status, code, message)`, `asyncHandler` e o `errorHandler`, que sempre responde `{"error": code, "message": ...}` (MulterError → 422, JSON inválido → 400, o resto → 500). `middlewares/auth.ts` emite JWT de 8h; `requireAuth` preenche `req.user = { id, role }` e `requireRole(...)` restringe por papel.
- `services/`: regras de negócio. Os serviços recebem os repositórios por **interface** no construtor, e os testes unitários passam fakes em memória (ver `ticket-service.test.ts`). Hoje são as rotas que instanciam os serviços com os singletons dos repositórios.
- `repositories/`: cada arquivo exporta uma interface, a implementação `Prisma*Repository` e um singleton. `prisma.ts` cria o `PrismaClient` a partir de `config/env.ts`.
- `domain/ticket.ts`: tipos e listas de papel, status, categoria e prioridade.
- `integrations/ai-client.ts`: classificação e sugestão de resposta. `AI_MODE=fake` (padrão) classifica por palavra-chave; `AI_MODE=openai` usa `gpt-4o-mini`. No modo fake, um título com `[falha-ia]` força falha na triagem.
- `jobs/triage-worker.ts`: processo separado da API (`npm run worker`), com o próprio `PrismaClient`. A cada `TRIAGE_INTERVAL_MS`, pega até 10 chamados com `triageStatus: 'pending'`, classifica e grava `category`, `priority` e `done`, ou `failed` em caso de erro. Sem o worker, o chamado fica "Em triagem" para sempre.

Regras que a caixa-preta cobra (em `ticket-service.ts` e `attachment-service.ts`):

- Só `customer` abre chamado.
- O cliente só vê os próprios chamados. O chamado de outro cliente responde 404, não 403.
- Só `agent` e `admin` assumem chamado.
- Para resolver, o chamado precisa estar `in_progress` e o usuário precisa ser o responsável ou admin.
- Resposta do cliente em chamado resolvido reabre o chamado como `open`.
- Anexos aceitam até 5 MB, nos tipos png, jpeg, pdf e txt, e vão para `UPLOAD_DIR`.

### Front (`web/src`)

React 19, React Router e Vite, sem biblioteca de componentes (o CSS fica em `styles.css`). As chamadas passam por `api/client.ts` (`apiFetch`, que usa `fetch`; o `axios` está no `package.json`, mas nada o usa). O token e o usuário ficam no `localStorage`, e um 401 limpa os dois. O endereço da API vem de `VITE_API_URL`, com padrão `http://localhost:4000`.

## Invariantes do harness

O código novo deve respeitar estas invariantes. O código atual ainda viola várias delas, e corrigir faz parte do trabalho. Não vale esconder: nada de `eslint-disable`, `@ts-ignore`, `@ts-expect-error` ou `@ts-nocheck` em `api/src` e `web/src`, e nenhum arquivo dessas pastas pode ficar fora das ferramentas.

| ID | Regra |
|---|---|
| G1 | Zero erro de tipo em `api/` e em `web/`. |
| G2 | Lint sem erro e sem warning: nada de variável ou import sem uso, nada de `any` explícito. |
| G3 | Os unitários da API passam. |
| G4 | `api/src/http/` não importa `@prisma/client` nem `api/src/repositories/`. |
| G5 | `process.env` só aparece em `api/src/config/`; `import.meta.env` só em `web/src/config/`. |
| G6 | `api/src/services/` não importa `express`, `multer` nem `api/src/http/`, nem mesmo com `import type`. |
| G7 | O pacote `openai` só é importado em `api/src/integrations/`. |
| G8 | `web/` não importa nada de `api/`, nem mesmo com `import type`. |
| G9 | Nenhum import circular em `api/src/` nem em `web/src/`. |
| G10 | Nenhum arquivo, export ou dependência sem uso em `api/` e em `web/`. |

Violações conhecidas no código de hoje:

- **G4:** `http/routes/health.ts` e `http/routes/stats.ts` usam `prisma`. As rotas importam repositórios para montar os serviços, e `/me` em `routes/auth.ts` chama `userRepository` direto.
- **G5:** `process.env` aparece em `main.ts`, `http/middlewares/auth.ts`, `http/routes/tickets.ts`, `services/attachment-service.ts`, `integrations/ai-client.ts` e `jobs/triage-worker.ts`. `import.meta.env` aparece em `web/src/api/client.ts`, `web/src/api/tickets.ts` e `web/src/pages/TicketDetailPage.tsx`.
- **G6:** os serviços lançam `HttpError` de `http/errors`, e `attachment-service.ts` recebe o `Request` do Express.
- **G7:** `/suggest-reply` em `http/routes/tickets.ts` chama a OpenAI direto, enquanto `suggestReply` de `ai-client.ts` está sem uso.
- **G8:** `web/src/api/tickets.ts` e `web/src/pages/TicketDetailPage.tsx` importam tipos de `api/src/domain/ticket`.
- **G9:** há um ciclo entre `services/ticket-service.ts` e `services/notification-service.ts`.
- **G10 (candidatos; confirme com a ferramenta):** `utils/legacy-sla.ts`, `calculateSlaDeadline`, `suggestReply`, os exports `toTicketJson`, `ApiError` e `formatCurrency`, e as dependências `lodash` (api) e `axios` (web).

## Endereços fixos e armadilhas

- Valores fixos impedem duas cópias rodando ao mesmo tempo: a porta 4000 (`PORT`), a 5173 (`vite.config.ts` com `strictPort`), a 5432 e o volume `pgdata` (`docker-compose.yml`), o banco `balcao`, o CORS travado em `http://localhost:5173` (`http/app.ts`), `UPLOAD_DIR=/tmp/balcao/uploads` e os padrões `localhost:4000` de `API_URL` e `VITE_API_URL`.
- A seed usa `create`. Rodar de novo no mesmo banco quebra com "Unique constraint failed".
- Os scripts da API usam `tsx --env-file=.env`, então nada sobe sem `api/.env`. O `config/env.ts` valida só `DATABASE_URL` e `NODE_ENV`; as outras variáveis são lidas soltas, e isso é a violação de G5.
- Para evitar erro de CORS, abra o front em `http://localhost:5173`, não em `127.0.0.1`.
- Não edite migrations que já estão em `api/prisma/migrations/`.
