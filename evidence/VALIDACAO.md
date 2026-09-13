# Validação local · 12 de setembro de 2026

## Execução e comportamento

Aplicação local em `http://127.0.0.1:5173`. Build de produção e TypeScript aprovados. **14 testes Vitest e 9 testes Playwright passaram.** Os testes Vitest verificam determinismo, valores iniciais, totalização, percentuais, sessões, cenários, intensidade, orçamento de partículas, filtros e cancelamento de assinaturas.

Os testes Playwright cobrem os painéis em Full HD e 4K, origens dos fluxos com tolerância de 2 px, cenários, seleção, filtros, pausa, teclado, tela cheia, fallback SVG, movimento reduzido e reorganização em 1024, 390 e 320 px. Um teste adicional aguarda a geometria WebGL pronta, compara capturas com movimento ativo e verifica a interrupção dos frames animados ao pausar.

As capturas usam seed 42, relógio injetado e amostras/animações inicialmente congeladas. O processo aguarda explicitamente o primeiro frame da cena antes da captura. A referência foi comparada visualmente considerando apenas sua tela útil; foram corrigidos núcleo ausente na captura inicial, fluxos não montados, transbordamento de tabelas, escala de fluxos em 4K e espaço dos eixos.

| Evidência | Resolução / finalidade |
| --- | --- |
| [Full HD](full-hd.png) | 1920 × 1080, interface completa sem rolagem |
| [4K](4k.png) | 3840 × 2160, interface completa sem rolagem |
| [Compacta](compact.png) | 1024 × 768, reorganização em duas colunas com rolagem |
| [Mobile](mobile.png) | 390 × 844, coluna única com rolagem |
| [Pico ERP](erp.png) | Fluxo e volume maiores no ERP |
| [Coleta indisponível](unavailable.png) | Valores ausentes, ausência de partículas e banco não confirmado |
| [Fallback](fallback.png) | Cilindro SVG sem WebGL |

## Desempenho medido

Chrome for Testing 153.0.8010.12, macOS, Apple M4 Pro. Janela de 8 segundos por combinação, após aquecimento, com simulação e animações ativas, cenário normal e DPR do navegador igual a 1. O resultado é a cadência dos callbacks `useFrame` do R3F; não mede a varredura física de um televisor. Fonte: [performance-gpu.json](performance-gpu.json).

| Viewport | Qualidade | FPS observado | Intervalo de frame p95 |
| --- | --- | --- | --- |
| 1920 × 1080 | Alta | 57,12 | 17,6 ms |
| 1920 × 1080 | Econômica | 57,00 | 17,8 ms |
| 3840 × 2160 | Alta | 56,87 | 17,7 ms |
| 3840 × 2160 | Econômica | 57,25 | 17,5 ms |

O objetivo de 60 FPS foi aproximado, mas não foi alcançado de forma constante. Nenhum erro de execução ocorreu nessas medições. A execução headless utilizou SwiftShader por software: 54,03 / 55,75 FPS em Full HD e 27,62 / 43,40 FPS em 4K, nas qualidades alta/econômica respectivamente. Esse segundo perfil está em [performance.json](performance.json).

Reproduzir com `npm run test:performance` (headless) ou `HEADED=1 npm run test:performance` (janela/GPU, quando disponível). O perfil é habilitado apenas por `?profile=1`; a coleção é limitada a 5.000 timestamps.

## Limites da validação

- Não houve conexão ao DB2, coletor real, deploy externo nem prova física no telão de 65 polegadas.
- A composição preserva a estrutura, paleta e hierarquia da referência, com geometria própria; não é uma reprodução pixel a pixel da imagem gerada.
- Abaixo de 700 px os fluxos entre colunas são omitidos para preservar leitura. O núcleo, as métricas e os controles continuam disponíveis.
- Acessibilidade foi verificada por teclado, semântica e preferência de movimento; não houve auditoria completa com leitor de tela nem certificação WCAG.
- A medição de desempenho não é teste prolongado de estabilidade e não cobre todos os cenários, navegadores, GPUs ou pixel ratios.
