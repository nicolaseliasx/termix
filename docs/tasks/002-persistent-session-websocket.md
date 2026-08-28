# 002 — Integrar Persistent Sessions ao terminal WebSocket

## Objetivo

Implementar attach/detach/takeover multi-device usando um SSH/PTy por dispositivo e o tmux remoto como fonte de persistência.

## Contexto

- Repo remoto `/home/admin/termix`; preserve todo o worktree e resultado da task 001.
- Terminal atual: `src/backend/hosts/terminal/index.ts` e `session-manager.ts`; frontend terminal em `src/ui/features/terminal/Terminal.tsx`.
- Registry/tmux adapter em `src/backend/hosts/sessions/` e lifecycle service/REST vêm da 001.
- Decisão fixa: um writer/N viewers, viewers com `tmux attach-session -r`, sem control-mode, PTY separado por dispositivo.
- Produção não deve ser tocada.

## Escopo

- Mensagens cliente `persistent_attach`, `persistent_detach`, `persistent_take_control` e respostas `persistent_attached`, `persistent_detached`, `persistent_control_changed`, `persistent_control_revoked`, `persistent_error`.
- Autenticar/autorizar pelo usuário do WS; resolver host/credenciais server-side pelo persistentSessionId.
- Criar PTY/SSH distinto por dispositivo; writer attach normal, viewer `-r`.
- Rejeitar input forjado de viewer no servidor; resize apenas no PTY daquele cliente.
- Takeover deve realmente encerrar/rebaixar o PTY writer antigo e reconectar roles sem janela com dois writers. Registry isolado não basta.
- WS close/error/detach/backend shutdown fecha apenas PTY/SSH local e registra detach; nunca kill tmux.
- Preservar protocolos legacy e session sharing atuais.
- Adicionar tipos compartilhados e metadados de tab necessários para a futura UI.
- Testes de auth/ownership, writer conflict, N viewers, forged input, takeover, duplicate client, reconnect, capacity e disconnect não destrutivo.
- Atualizar docs/LOG.

## Fora de escopo

- Scheduler/reconciler/expirer, página Sessions, deploy.

## Dependências

- 1.

## Critérios de aceite

- [ ] Um writer/N viewers é imposto no backend.
- [ ] Viewers executam attach `-r` e não conseguem escrever com mensagem forjada.
- [ ] Takeover não mantém dois PTYs writable.
- [ ] Fechar browser/WS/SSH não chama kill-session.
- [ ] Protocolos legacy e testes terminal continuam passando.
- [ ] Type-check/build backend/diff check passam; produção intocada.

## Verificação

```bash
NODE_ENV=test npx vitest run src/backend/tests/hosts/sessions
NODE_ENV=test npx vitest run src/backend/tests/hosts/terminal
NODE_OPTIONS=--max-old-space-size=1536 npm run type-check
NODE_OPTIONS=--max-old-space-size=1536 npm run build:backend
git diff --check
docker ps --filter name=termix
```

Use Node 24 isolado; fake SSH/tmux apenas.
