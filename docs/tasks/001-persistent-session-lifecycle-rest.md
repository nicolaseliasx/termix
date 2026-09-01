# 001 — Concluir lifecycle e REST de Persistent Sessions

## Objetivo

Concluir no worktree remoto `/home/admin/termix` a camada backend de lifecycle e REST para sessões tmux persistentes, aproveitando schema, repository, adapter e registry já existentes.

## Contexto

- Acesso: use o alias SSH local do host; `rtk` existe apenas na máquina controladora,
  não no host remoto. Nunca registre o endereço privado no repositório.
- Branch `fork/baseline`, worktree sujo com mudanças legítimas de Phase 0–1 e fundação Phase 2. Preserve tudo; não faça reset, stage, commit ou push.
- Já existem `persistent_sessions`, `persistent_session_events`, runtime migration SQLite, schemas gerados, repository/factory e `src/backend/hosts/sessions/{types,registry,tmux-adapter,index}.ts`.
- Validações anteriores: schema check, type-check Node 24 e session-manager tests passaram.
- Produção `termix` deve permanecer saudável e intocada. Testes usam DB temporário e fake SSH/tmux.
- O dump grande já está fora do repo em `/tmp/termix-core-dumps/termix-core-20260826-021512.22`.

## Escopo

- Revisar/testar migration/repository/tmux adapter existentes, incluindo cwd `/`, `~`, `~/…`, markers e kill verificado.
- Criar erros tipados com códigos/status/mensagens públicas seguras; log técnico redigido.
- Criar gateway remoto injetável reutilizando host resolver, credenciais, pool SSH e helpers tmux existentes.
- Criar lifecycle service owner-scoped: list/get/create+marker+confirm, rename, expiry policy, kill idempotente verificado, adoption e refresh síncrono por host.
- Refresh: recuperar markers, descobrir unmarked, marcar missing somente após listagem completa; offline nunca destrutivo.
- Montar rotas autenticadas `/api/v1/persistent-sessions`, `/:id`, `/persistent-session-adoptions` e `/hosts/:hostId/persistent-session-reconciliations`.
- Listagem paginada `{data,meta}`; respostas de erro `{error:{code,message,details?}}`; status 400/401/403/404/409/422/503 corretos.
- Criar testes de schema/repository/adapter/service/routes com fake gateway; nenhum host real.
- Atualizar `docs/fork/LOG.md` e `PERSISTENT_SESSIONS.md`.

## Fora de escopo

- WebSocket, schedulers, UI, deploy, produção, commits/push.

## Dependências

- Nenhuma; fundação já está no worktree.

## Critérios de aceite

- [ ] REST completo montado e owner-scoped.
- [ ] Operações remotas nunca matam marker divergente/unmarked.
- [ ] Falha remota/local parcial é tipada e não executa compensating kill.
- [ ] Migration idempotente em DB temporário fresh/upgrade.
- [ ] Testes focused, schema check, type-check, backend build e diff check passam em Node 24.
- [ ] Produção permanece intocada e saudável.

## Verificação

```bash
npm run schema:generate
npm run schema:check
NODE_OPTIONS=--max-old-space-size=1536 npm run type-check
NODE_ENV=test npx vitest run src/backend/tests/hosts/sessions
NODE_ENV=test npx vitest run src/backend/tests/database/repositories/persistent-session-repository.test.ts
NODE_ENV=test npx vitest run src/backend/tests/database/routes/persistent-sessions.test.ts
NODE_OPTIONS=--max-old-space-size=1536 npm run build:backend
git diff --check
docker ps --filter name=termix
```

Use container Node 24 quando necessário e aguarde processos ativos até 10 minutos.
