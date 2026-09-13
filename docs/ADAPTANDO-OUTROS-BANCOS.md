# Adaptando o DashDB para outro banco de dados

O frontend não precisa conhecer as consultas de cada banco. Ele recebe amostras normalizadas pelo contrato `DashboardSample`, definido em `src/data/contracts.ts`. A adaptação deve acontecer no serviço de coleta e no cadastro da nova origem.

## 1. Defina a origem

Escolha um identificador curto e estável, por exemplo `postgres`, `oracle`, `sqlserver` ou `mysql`. Cadastre a origem em:

- `LiveSourceId` e `liveSources`, no frontend;
- `SOURCE_SPECS`, no backend;
- um arquivo de configuração `*.example`, sem endereço ou credencial real.

Cada origem precisa de rótulo, banco, plataforma e localização. O host real deve vir da configuração privada em tempo de execução. Preserve uma instância separada de coletor, histórico SQLite, estado atual e assinantes SSE.

## 2. Crie um adaptador do mecanismo

`service/collector.py` contém consultas e cálculos específicos do Db2. Para outro mecanismo, crie um módulo próprio, como `service/postgres_collector.py`, em vez de traduzir artificialmente suas colunas para nomes Db2.

O adaptador deve:

1. abrir e reutilizar uma conexão com timeout;
2. executar somente consultas de monitoramento previamente definidas no código;
3. limitar tempo, linhas e tamanho dos resultados;
4. converter contadores acumulados em deltas válidos;
5. produzir um `DashboardSample` completo;
6. fechar recursos na parada do serviço;
7. devolver uma amostra indisponível sem inventar números quando ocorrer uma falha.

Extraia utilitários compartilhados, como histórico, criação de métricas e estado indisponível, apenas se isso simplificar os adaptadores sem mudar a semântica Db2 já testada.

## 3. Mapeie as métricas

Documente a origem e a fórmula de cada valor. As visões de monitoramento e as permissões variam por versão, edição e configuração do banco; confirme tudo na documentação oficial do mecanismo alvo e em uma instância de teste.

| Campo do DashDB | Significado exigido | Quando usar `null` |
| --- | --- | --- |
| `cpu` | Uso de CPU do host ou processo do banco, em percentual | A visão do banco não comprova a mesma grandeza |
| `memory` | Memória usada com denominador e escopo conhecidos | Cache, RSS e memória do host não podem ser comparados com segurança |
| `connections` | Conexões ou sessões abertas | A fonte mostra apenas sessões ativas |
| `executingSessions` | Sessões executando naquele instante | O mecanismo não expõe estado comparável |
| `users` | Identidades técnicas distintas conectadas | Só existe uma contagem aproximada ou de usuários cadastrados |
| `sql` | Comandos concluídos por segundo no intervalo | Não há contador monotônico confiável |
| `response` | Tempo médio por execução no intervalo, em ms | Numerador, denominador ou unidade são incompatíveis |
| `cache` | Razão entre leituras lógicas e físicas no intervalo | Não houve leitura ou os contadores reiniciaram |
| `iops` | Operações reais de disco por segundo | Há apenas páginas lidas, bytes ou métricas de buffer |
| `applications` | Distribuição de atividade por aplicação técnica | O cliente não informa identidade suficiente |
| `queries` | Até cinco agregados de maior impacto, sem texto sensível | A visão exigiria privilégio excessivo ou exporia SQL |
| `availability` | Sucessos observados pelo coletor | Não existe período observado suficiente |

`executingSessions` não representa conexões abertas. `availability` mede a coleta observada pelo DashDB, não um SLA anterior à instalação.

Como ponto de partida, consulte as visões oficiais de estatísticas do mecanismo: catálogo estatístico no PostgreSQL, visões dinâmicas de desempenho no Oracle, DMVs no SQL Server e Performance Schema no MySQL. Os nomes, campos e privilégios devem ser confirmados para a versão real antes de escrever as consultas.

## 4. Preserve o contrato da API

O frontend espera os mesmos endpoints e eventos, independentemente do banco:

- `/api/sources` lista origens e disponibilidade;
- `/api/health?source=<id>` informa a saúde do coletor;
- `/api/snapshot?source=<id>` retorna a última amostra;
- `/api/events?source=<id>` envia eventos SSE do tipo `snapshot`.

O campo `source` do contrato atual aceita `db2` ou `simulated`. Para um novo mecanismo, amplie esse tipo com um identificador explícito e atualize `isLiveSample`; não marque dados Oracle ou PostgreSQL como Db2 apenas para passar na validação.

Uma troca no seletor deve encerrar o stream anterior, limpar as métricas atuais, abrir o stream da nova origem e rejeitar amostras atrasadas da origem anterior.

## 5. Configure segurança e identidade

- Crie uma conta técnica exclusiva, sem login interativo quando o sistema operacional permitir.
- Conceda somente conexão e leitura das visões de monitoramento necessárias.
- Defina um nome de aplicação durante a conexão, quando o driver oferecer essa opção.
- Guarde credenciais em arquivo externo com permissão restrita ou em um gerenciador de segredos.
- Não exponha o listener do Uvicorn diretamente na internet; use proxy HTTPS, autenticação e regras de rede.
- Não inclua endereço, usuário, senha, texto SQL, parâmetros ou dados de negócio nas amostras.

Se uma métrica exigir privilégio administrativo, busque uma fonte menos invasiva, como um agente de host ou uma plataforma de monitoramento. Se não houver alternativa segura, mantenha a métrica indisponível e documente a limitação.

## 6. Valide antes de implantar

O conjunto mínimo de testes deve comprovar:

- amostra válida com todas as unidades corretas;
- diferença entre zero, indisponível e não aplicável;
- primeira coleta sem taxas inventadas;
- descarte de deltas após reconexão ou reinício de contador;
- timeout e limite de linhas;
- falha de uma origem sem afetar as demais;
- troca de origem no frontend e rejeição de evento atrasado;
- ausência de credenciais e topologia privada nos arquivos versionados;
- build real com `VITE_DATA_MODE=live`.

Execute:

```sh
npm run typecheck
npm test
PYTHONPATH=service python3 -m unittest discover -s service -v
VITE_DATA_MODE=live npm run build
```

Valide em uma instância não produtiva antes de apontar para produção. No relatório, diferencie teste automatizado, conexão real, implantação e observação do painel em execução.

## Prompt para outra IA

Copie e complete o texto abaixo:

> Adapte o DashDB para monitorar **[MECANISMO E VERSÃO]** na nova origem **[ID E RÓTULO]**. Preserve o contrato `DashboardSample`, a interface e as origens existentes. Crie um adaptador isolado com consultas fixas e somente leitura, timeout e limites de resultado. Use uma conta técnica de privilégio mínimo e nunca grave credenciais ou topologia privada no Git. Mapeie cada métrica para uma fonte oficial do mecanismo e use `null` quando não houver equivalência comprovada. Mantenha coletor, histórico e SSE independentes por origem. Atualize `LiveSourceId`, `liveSources`, `SOURCE_SPECS`, a configuração de exemplo e a documentação. Teste primeira coleta, deltas, falha, reconexão, troca de origem, eventos atrasados e zero versus indisponível. Execute typecheck, testes do frontend e backend e build no modo real. Não implante em produção; entregue também os pré-requisitos, privilégios mínimos e o procedimento de validação e reversão.
