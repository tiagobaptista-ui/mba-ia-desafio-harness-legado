# Arquitetura

O Balcão é uma central de chamados. O cliente abre um chamado, o worker classifica com IA (categoria e prioridade), o atendente assume, responde e resolve, e o admin acompanha as estatísticas.

São três processos por cópia, mais o Postgres:

| Processo | Entrada | Comando (dentro da pasta) |
|---|---|---|
| API (Express + Prisma) | `api/src/main.ts` | `npm run dev` em `api/` |
| Worker de triagem | `api/src/jobs/triage-worker.ts` | `npm run worker` em `api/` |
| Front (React + Vite) | `web/src/main.tsx` | `npm run dev` em `web/` |

O `npm run up`, na raiz, sobe os três com o ambiente certo da cópia. Rodar à mão só funciona depois de um `up`, que é quem gera `api/.env` e `web/.env.local`.

## Camadas da API (`api/src/`)

```
http/ ──► services/ ──► repositories/ ──► @prisma/client
  │           │               │
  └──────► domain/ ◄──────────┘          config/  (único que lê process.env)
                ▲                        integrations/  (único que importa openai)
main.ts: monta repositórios → serviços → createApp(serviços)
jobs/triage-worker.ts: monta TriageService com ticketRepository e classifyTicket
```

- **`http/`**: `app.ts` exporta `createApp(services)`. Cada arquivo de `routes/` é uma fábrica que recebe os serviços de que precisa. `errors.ts` tem `asyncHandler`, `HttpError` (erros que só existem na borda, como um corpo inválido) e o `errorHandler`, que responde sempre `{"error": código, "message": texto}` e traduz o código de cada `DomainError` para o status HTTP. `middlewares/auth.ts` emite e valida o JWT (8 h) e preenche `req.user = { id, role }`.
- **`services/`**: as regras de negócio. Cada serviço recebe repositórios por interface no construtor, e os testes passam fakes em memória. Os serviços lançam `DomainError(código, mensagem)` e não conhecem Express nem multer.
- **`repositories/`**: cada arquivo exporta uma interface e um singleton com a implementação Prisma (a classe não é exportada). É o único lugar que fala com o banco.
- **`domain/`**: tipos (`Ticket`, `Reply`, `Attachment`, `User`, `CurrentUser`), as listas de status, categoria e prioridade, e `DomainError`.
- **`integrations/ai-client.ts`**: classificação e sugestão de resposta. Com `AI_MODE=fake` (padrão, sem chave), a classificação é por palavra-chave, e um título com `[falha-ia]` força a falha da triagem. Com `AI_MODE=openai`, usa a OpenAI.
- **`config/env.ts`**: lê e valida o ambiente. `DATABASE_URL` só é exigida por `repositories/prisma.ts`, para que os testes unitários rodem sem banco.

### Regras de negócio que a caixa-preta cobra

- Só `customer` abre chamado.
- O cliente só vê os próprios chamados. O chamado de outro cliente responde 404, não 403.
- Só `agent` e `admin` assumem chamado. Chamado resolvido não pode ser assumido (409).
- Para resolver, o chamado precisa estar `in_progress` e o usuário precisa ser o responsável ou admin.
- Resposta do cliente num chamado resolvido reabre o chamado como `open`.
- Anexos aceitam até 5 MB, nos tipos png, jpeg, pdf e txt, e são gravados em `UPLOAD_DIR`.
- O worker pega até 10 chamados `pending` por rodada, a cada `TRIAGE_INTERVAL_MS`. Se der certo, grava `done`, categoria e prioridade; se der erro, grava `failed`.

A suíte `blackbox/` é o contrato HTTP. Rotas, corpos, status e códigos de erro não mudam.

## Front (`web/src/`)

React Router, sem biblioteca de componentes (o CSS fica em `styles.css`). Toda chamada passa por `api/client.ts` (`apiFetch`, com `fetch`). O token e o usuário ficam no `localStorage`, e um 401 limpa os dois. O endereço da API vem de `web/src/config/env.ts` (`VITE_API_URL`). O front declara os próprios tipos do contrato e não importa nada de `api/`.

## Isolamento entre cópias

Cada clone ou worktree é uma cópia, com uma identidade derivada do caminho: o nome da pasta mais 6 caracteres de hash. A mesma pasta sempre gera a mesma identidade. Para cada cópia, o `scripts/up.mjs`:

- **Postgres próprio:** `docker compose -p balcao-<cópia>`, com volume próprio (`balcao-<cópia>_pgdata`), banco `balcao_<cópia>` e banco de testes `balcao_<cópia>_test`.
- **Portas livres:** a partir de 4000 (API), 5173 (front) e 5432 (Postgres). Ficam guardadas em `.balcao/estado.json` para a cópia voltar nas mesmas, e não usam as portas gravadas pelas outras worktrees.
- **Anexos:** pasta `.balcao/uploads/` dentro da própria cópia.
- **Configuração:** grava `api/.env` (`DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `UPLOAD_DIR`) e `web/.env.local` (`VITE_API_URL`), preservando o resto do que já estiver no `.env`, como `AI_MODE`.
- **Processos:** sobe API, worker e front em segundo plano, cada um no seu grupo de processos, com log em `.balcao/logs/`. Guarda o pid e a hora de início para que o `npm run down` só derrube o que esta cópia iniciou.
- **Ambiente explícito:** as variáveis vão direto para os processos filhos. `--env-file` e o Prisma não sobrescrevem uma variável já exportada no shell, então um `PORT` ou `DATABASE_URL` perdido no terminal faria a cópia usar o endereço errado.

Rodar a subida de novo reinicia os processos e reaplica migrations e seed (que é idempotente).
