# Instruções para agentes de IA

Este repositório é o **DashDB**. Antes de alterar uma integração, leia `src/data/contracts.ts`, `src/data/LiveDataSource.ts`, `service/app.py`, `service/collector.py` e `docs/ADAPTANDO-OUTROS-BANCOS.md`.

## Regras obrigatórias

1. Preserve o contrato `DashboardSample` e o comportamento visual existente.
2. Implemente cada mecanismo de banco em um adaptador isolado. Não force conceitos de Db2 em PostgreSQL, Oracle, SQL Server, MySQL ou outro mecanismo.
3. Use somente consultas fixas de monitoramento. A API nunca pode aceitar SQL, nomes de tabelas ou filtros SQL enviados pelo navegador.
4. Use uma conta técnica somente leitura e com o menor conjunto possível de privilégios de monitoramento.
5. Nunca grave senhas, tokens, nomes de usuários reais, IPs internos, hostnames privados ou evidências de produção no Git. Inclua apenas arquivos `*.example` com valores fictícios.
6. Uma métrica sem equivalente comprovado deve ter `value: null` e qualidade `unavailable` ou `not-applicable`. Nunca substitua ausência por zero nem use números simulados no modo real.
7. Preserve um coletor, uma conexão, um histórico e um stream SSE independentes por origem. Uma falha não pode contaminar as demais origens.
8. Calcule taxas somente a partir de deltas válidos e relógio monotônico. Descarte o intervalo após reinício, redução de contador, reconexão ou lacuna excessiva.
9. Não publique texto SQL, parâmetros, registros de negócio ou credenciais nas respostas e nos logs.
10. Identifique a conexão técnica no banco durante o handshake quando o driver oferecer essa opção. O adaptador Db2 atual usa `MonitorDash` por compatibilidade.

## Entrega mínima

- Adaptador e configuração de exemplo do novo mecanismo.
- Registro da origem na API e no seletor do frontend.
- Mapeamento documentado de cada métrica, incluindo as indisponíveis.
- Testes do adaptador, troca de origem, falha, reconexão, zero versus `null` e descarte de deltas inválidos.
- `npm run typecheck`, `npm test`, testes Python e `npm run build` aprovados.

Não altere ou implante um serviço de produção durante uma adaptação local sem uma solicitação explícita. Separe no relatório o que foi implementado, testado localmente e validado em um banco real.
