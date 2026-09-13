# Serviço de coleta Db2

O backend mantém um coletor, uma conexão e um histórico por origem. A API distribui a mesma amostra a todos os navegadores por SSE, portanto abrir mais painéis não multiplica as consultas ao banco.

## Configuração

Copie [db2.example.json](db2.example.json) para `db2.json` e, se necessário, crie `db2-aix.json` com o mesmo formato:

```json
{
  "database": "DATABASE_NAME",
  "host": "DB_HOST",
  "port": 60000,
  "username": "MONITOR_USER",
  "password": "REPLACE_OUTSIDE_GIT"
}
```

Os arquivos reais são ignorados pelo Git. Em produção, guarde-os fora da árvore da aplicação com modo `0600` e entregue-os ao processo por `systemd LoadCredential`. O modelo [dashdb.service](dashdb.service) escuta apenas em `127.0.0.1`; exponha o painel por um proxy HTTPS autenticado quando houver acesso fora de uma rede confiável.

O usuário do banco precisa apenas de `CONNECT` e `EXECUTE` nas funções de monitoramento utilizadas. [db2-monitor-grants.example.sql](db2-monitor-grants.example.sql) serve como referência Db2 e deve ser revisado para o banco e a política de cada ambiente. Não conceda privilégios administrativos ou acesso a tabelas de negócio.

## Semântica das métricas

| Métrica | Origem Db2 | Observação |
| --- | --- | --- |
| Conexões | `MON_GET_CONNECTION` | Inclui a conexão do monitor |
| Sessões executando | `MON_GET_ACTIVITY` | Handles em estado `EXECUTING` |
| Identidades | `MON_GET_CONNECTION` | Identidades distintas, não pessoas |
| SQL/s | Delta de `TOTAL_APP_SECTION_EXECUTIONS` | Taxa calculada entre duas coletas |
| Resposta | Delta de `TOTAL_ACT_TIME / ACT_COMPLETED_TOTAL` | Tempo médio de atividade do banco |
| CPU e memória | `ENV_GET_SYSTEM_RESOURCES` | Recursos do host do banco |
| Cache hit | Leituras lógicas e físicas | `null` quando o intervalo não permite razão válida |
| Consultas pesadas | `MON_GET_PKG_CACHE_STMT` | Amostra agregada, sem publicar o texto SQL |
| Disponibilidade | Sucessos observados pelo coletor | Não equivale a SLA histórico |
| IOPS | Sem fonte integrada | Permanece `null` até existir telemetria de disco |

Contadores acumulados são convertidos em taxas com relógio monotônico. O primeiro ciclo somente estabelece a referência. Reinício, redução de contador, reconexão ou lacuna superior a 30 segundos invalida o delta em vez de produzir um valor enganoso.

## Proteções

- SQL fixo, sem aceitar consultas fornecidas pela API.
- Timeout de conexão e consulta, ciclos sequenciais e limite de linhas.
- No máximo 32 clientes SSE e uma amostra pendente por cliente.
- Credenciais ausentes das respostas, logs e arquivos versionados.
- `MonitorDash` definido no handshake para identificar o coletor no Db2.
- Valores vencidos ficam indisponíveis após 10 segundos; o banco passa a estado não confirmado.

## Operação

```sh
systemctl status dashdb
journalctl -u dashdb -n 50 --no-pager
curl http://127.0.0.1:8088/api/health
```

Uma atualização deve validar os testes, criar uma versão separada, trocar o link da aplicação e reiniciar somente o serviço do coletor. Guarde o destino anterior para reversão. Não reinicie nem altere o banco monitorado.

```sh
PYTHONPATH=service python3 -m unittest discover -s service -v
npm test
VITE_DATA_MODE=live npm run build
```

Para adicionar outro mecanismo de banco, siga [../docs/ADAPTANDO-OUTROS-BANCOS.md](../docs/ADAPTANDO-OUTROS-BANCOS.md).
