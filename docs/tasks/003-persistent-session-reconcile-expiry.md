# 003 — Implementar reconciliação, expiração e retenção

## Objetivo

Garantir recuperação após restart e expiração segura de sessões managed, sem destruir tmux por inconsistência de DB ou rede.

## Contexto

- Repo remoto `/home/admin/termix`; depende do lifecycle/REST e WS das tasks anteriores.
- Reuse gateway, repository, markers e connection pool; não duplique SSH/credenciais.
- Produção continua intocada nesta task.

## Escopo

- Reconciler assíncrono após readiness, startup + 60s, sem overlap, concorrência 4, timeouts; `start/stop/runOnce` e graceful shutdown.
- Reconciliar hosts de rows ativas: marker match observa; marker sem row recupera managed; unmarked vira discovered; missing somente após listagem completa; offline preserva.
- Reconciliation nunca mata tmux.
- Expirer manual/idle 1h/6h/24h/7d/custom 5m–30d; expiresAt após último detach.
- Antes de kill: claim idempotente, requery, marker exato e zero clients tmux inclusive externos. Attached posterga; offline retry; mismatch nunca kill.
- Retenção de ended/events por 30 dias apenas no DB.
- Eventos lifecycle e logs redigidos.
- Testes fake clock/gateway para restart recovery, discovered, missing/offline, cycles concorrentes, expiry attached/mismatch/offline/manual e retention.
- Smoke backend temporário incluindo start/stop de schedulers; atualizar docs/LOG.

## Fora de escopo

- UI e deploy.

## Dependências

- 001, 002.

## Critérios de aceite

- [ ] Restart/runOnce recupera markers e external sessions sem kill.
- [ ] Offline nunca vira missing/expired.
- [ ] Expiry só mata marker correto e zero attached clients.
- [ ] Intervals não vazam nem impedem shutdown/testes.
- [ ] Testes, type-check, backend build e smoke temporário passam.

## Verificação

```bash
NODE_ENV=test npx vitest run src/backend/tests/hosts/sessions
NODE_ENV=test npx vitest run src/backend/tests/database/repositories/persistent-session-repository.test.ts
NODE_OPTIONS=--max-old-space-size=1536 npm run type-check
NODE_OPTIONS=--max-old-space-size=1536 npm run build:backend
git diff --check
```

Use Node 24, DB temporário e nenhum host real.
