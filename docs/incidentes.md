# Registro de incidentes

Erros reais cometidos pelo agente (Claude Code) durante a instalação do harness. Cada erro virou uma mudança no harness para não se repetir. A pergunta de cada entrada é: o que impede o próximo agente de errar igual?

Formato: o que aconteceu, por que passou, a mudança no harness e o commit que a fez.

---

## 1. Verificação de volume do Postgres deu falso negativo

**O que aconteceu.** Antes de subir o banco pela primeira vez, o agente quis saber se já havia dados do Balcão na máquina e rodou `docker volume ls | grep -i balcao`. Não apareceu nada, e ele concluiu que não havia volume. Mas o `docker compose` nomeia o projeto (e o volume) pelo nome da pasta, então o volume se chamaria `mba-ia-desafio-harness-legado_pgdata`, sem "balcao" no nome. A checagem nunca poderia achar o volume. Desta vez não houve perda, porque o volume de fato não existia (a seed rodou num banco vazio), mas a mesma checagem mandaria apagar ou reaproveitar o volume errado em outra máquina.

**Por que passou.** O nome dos recursos do Docker dependia de onde o repositório foi clonado. Com duas worktrees, haveria dois projetos com nomes arbitrários e nenhum jeito estável de saber qual volume é de qual cópia.

**Mudança no harness.** O `npm run up` e o `npm run down` usam um projeto compose com nome explícito, `balcao-<cópia>`. O volume passa a ser `balcao-<cópia>_pgdata` e o banco `balcao_<cópia>`. O up mostra o projeto e o banco na saída, e o `docs/arquitetura.md` documenta a regra. Hoje `docker volume ls | grep balcao` acha os volumes de todas as cópias.

**Commit:** `65e6b49`

---

## 2. Seed quebrada por edição com substituição de texto

**O que aconteceu.** Para tornar a seed idempotente, o agente editou `api/prisma/seed.ts` com substituições de string num script Python, em vez de reescrever o arquivo. As trocas acertaram só parte dos blocos e deixaram chaves desbalanceadas (sobrou um `},\n  })` solto). O agente só percebeu ao imprimir o arquivo, e depois o reescreveu inteiro.

**Por que passou.** Nada verificava `api/prisma/` nem `api/test/`. Um arquivo que não compila poderia ter sido commitado, e a quebra só apareceria no próximo `npm run seed`, já dentro da subida.

**Mudança no harness.** Os gates cobrem `api/` inteiro, não só `src/`. O G1 roda `tsc -p api/tsconfig.json`, que inclui `src`, `prisma` e `test`, e o G2 roda o ESLint sobre `api/` inteiro. O hook de pre-commit roda os dois antes de qualquer commit (`6f2de4c`). Um `seed.ts` que não compila hoje bloqueia o commit.

**Commit:** `ec29332` (gates). O hook veio em `6f2de4c`.

---

## 3. `npm uninstall` reescreveu o lockfile inteiro

**O que aconteceu.** Para cumprir a G10, o agente rodou `npm uninstall lodash` em `api/`. O comando tirou o lodash, mas também regravou metadados de dezenas de outros pacotes no `api/package-lock.json` (entradas `"peer": true` novas). O diff do lockfile ficou com 51 linhas alteradas para uma dependência de 7 linhas. O enunciado já avisava que o npm faz isso.

**Por que passou.** O `CLAUDE.md` antigo não dizia nada sobre como mexer em dependências, e não havia ferramenta para remover uma sem passar pelo `npm`.

**Mudança no harness.**
- `scripts/remover-dependencia.mjs` tira a dependência do `package.json` e do lockfile, poda os pacotes que ficaram órfãos e confere tudo com `npm ci`. Com ele, a remoção do lodash virou um diff de 7 linhas, e a do axios no web levou junto as 26 dependências transitivas órfãs.
- O `npm run up` instala com `npm ci`, que respeita o lockfile.
- `AGENTS.md` e `docs/gates.md` (na correção da G10) mandam usar o script e nunca `npm install` ou `npm uninstall`.

**Commit:** `2fcab9d` (script). A regra no `AGENTS.md` veio em `36c668b`.
