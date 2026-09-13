import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Activity,
  Bell,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Cpu,
  Database,
  HeartPulse,
  Layers,
  Maximize,
  MemoryStick,
  Minimize,
  Pause,
  Play,
  Radio,
  Settings2,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  demoConfig,
  runtime,
  scenarios,
  type Environment,
  type LiveSourceId,
  type Quality,
  type Scenario,
} from "./config";
import { MockDataSource } from "./data/MockDataSource";
import type { DashboardDataSource, DemoControls } from "./data/contracts";
import { periodHistory, trend } from "./data/simulation";
import {
  Delta,
  Gauge,
  number,
  Panel,
  timeLabel,
} from "./components/Primitives";
import { AccessChart, Sparkline } from "./components/Charts";
import Applications from "./components/Applications";
import Core from "./scene/Core";
import EnergyFlows from "./scene/EnergyFlows";
import s from "./styles/Dashboard.module.css";

function useMedia(query: string) {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export default function App({
  source: supplied,
  controls: suppliedControls,
}: {
  source?: DashboardDataSource;
  controls?: DemoControls;
}) {
  const mock = useMemo(
    () => (supplied ? null : new MockDataSource(runtime.seed, runtime.clock)),
    [supplied],
  );
  const source: DashboardDataSource = supplied ?? mock!,
    controls = suppliedControls ?? mock;
  const sample = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const live = sample.source === "db2";
  const sourceOptions = source.getSources?.() ?? [];
  const liveSource = source.getSource?.() ?? sample.metadata?.sourceId ?? "huawei";
  const [paused, setPaused] = useState(runtime.frozen),
    [period, setPeriod] = useState(24),
    [scenario, setScenario] = useState<Scenario>("normal"),
    [environment, setEnvironment] = useState<Environment>("production");
  const [selected, setSelected] = useState<string | null>(null),
    [highlighted, setHighlighted] = useState<string | null>(null),
    [quality, setQuality] = useState<Quality>("high");
  const [settings, setSettings] = useState(false),
    [screen, setScreen] = useState(false),
    [hiddenCursor, setHiddenCursor] = useState(false),
    [alertFilter, setAlertFilter] = useState("all"),
    [sort, setSort] = useState("time");
  const [now, setNow] = useState(runtime.clock),
    [visible, setVisible] = useState(!document.hidden),
    [notice, setNotice] = useState("");
  const reduced = useMedia("(prefers-reduced-motion: reduce)"),
    compact = useMedia("(max-width: 1150px)");
  const board = useRef<HTMLDivElement>(null),
    settingsButton = useRef<HTMLButtonElement>(null);
  const actualQuality = compact ? "eco" : quality;
  const moving = !paused && !reduced && visible;
  useEffect(() => {
    controls?.setPaused(paused || !visible);
  }, [controls, paused, visible]);
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (!document.hidden && !runtime.frozen) setNow(runtime.clock());
    }, 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const onFullscreen = () => {
      setScreen(!!document.fullscreenElement);
      setHiddenCursor(false);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);
  useEffect(() => {
    if (!screen) return;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      setHiddenCursor(false);
      clearTimeout(timer);
      timer = setTimeout(() => setHiddenCursor(true), 3000);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setScreen(false);
        setHiddenCursor(false);
      } else show();
    };
    window.addEventListener("mousemove", show);
    window.addEventListener("keydown", escape);
    show();
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", show);
      window.removeEventListener("keydown", escape);
    };
  }, [screen]);
  useEffect(() => {
    if (!settings) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSettings(false);
        settingsButton.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [settings]);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        setSettings(false);
      }
    } catch {
      setNotice(
        "Tela cheia indisponível neste navegador. Use o modo de apresentação do navegador.",
      );
    }
  };
  const history = useMemo(
    () => periodHistory(sample.history, period),
    [sample.history, period],
  );
  const alerts = sample.alerts.filter(
    (a) => alertFilter === "all" || a.severity === alertFilter,
  );
  const queries = [...sample.queries].sort((a, b) =>
    sort === "time"
      ? (b.averageMs ?? 0) - (a.averageMs ?? 0)
      : (b.executions ?? 0) - (a.executions ?? 0),
  );
  const missing = sample.collector === "unavailable",
    idle = sample.metrics.sql.value === 0,
    metrics = sample.metrics;
  const healthLabel =
    sample.health === "unknown"
      ? "NÃO CONFIRMADA"
      : sample.health === "attention"
        ? "ATENÇÃO"
        : "SAUDÁVEL";
  const healthClass = sample.health === "healthy" ? s.good : s.warning;
  const periodControl = (
    <select
      aria-label="Período dos gráficos"
      className={s.smallSelect}
      value={period}
      onChange={(e) => setPeriod(+e.target.value)}
    >
      <option value={1}>Última hora</option>
      <option value={6}>Últimas 6 h</option>
      <option value={24}>Últimas 24 h</option>
    </select>
  );
  return (
    <div
      className={`${s.dashboard} ${screen ? s.screen : ""} ${hiddenCursor ? s.hiddenCursor : ""} ${!moving ? s.still : ""}`}
      data-testid="dashboard"
      data-sample={sample.id}
      data-collector={sample.collector}
      data-source={sample.source}
      data-moving={moving}
    >
      <a className={s.skipLink} href="#monitoramento">
        Ir para o monitoramento
      </a>
      <header className={s.header}>
        <div className={s.identity}>
          <div className={s.brandMark} aria-hidden="true" />
          <div>
            <h1>
              DASH<span>DB</span>
            </h1>
            <p>
              OBSERVABILIDADE EM TEMPO REAL <b /> PERFORMANCE <b />{" "}
              DISPONIBILIDADE <b /> SEGURANÇA
            </p>
          </div>
        </div>
        <div className={s.headerRight}>
          <label className={s.environment}>
            Ambiente
            <select
              aria-label={
                live ? "Ambiente monitorado" : "Ambiente de demonstração"
              }
              value={live ? liveSource : environment}
              onChange={(e) => {
                if (live) {
                  source.setSource?.(e.target.value as LiveSourceId);
                  setSelected(null);
                  setHighlighted(null);
                  return;
                }
                const next = e.target.value as Environment;
                setEnvironment(next);
                controls?.setEnvironment(next);
              }}
              disabled={live ? !source.setSource : !controls}
            >
              {live ? (
                sourceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    ● {option.label}
                  </option>
                ))
              ) : (
                <>
                  <option value="production">● Produção — demo</option>
                  <option value="staging">● Homologação — demo</option>
                </>
              )}
            </select>
          </label>
          <div className={s.clock}>
            <span>
              {new Date(now).toLocaleDateString("pt-BR", {
                weekday: "short",
                day: "2-digit",
                month: "short",
                year: "numeric",
                timeZone: "America/Sao_Paulo",
              })}
            </span>
            <time>
              {new Date(now).toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}
            </time>
          </div>
          <div className={s.wordmark}>
            <strong>
              CREA<span>SP</span>
              <i> / </i>
              <em>DB2</em>
            </strong>
            <small>INTELIGÊNCIA EM OPERAÇÃO</small>
          </div>
        </div>
      </header>
      <main id="monitoramento" className={s.board} ref={board}>
        <div className={s.leftColumn}>
          <div className={s.gauges}>
            <Panel title="CPU" icon={Cpu}>
              <Gauge
                value={metrics.cpu.value}
                color="var(--blue)"
                label="CPU"
              />
              <div className={s.gaugeCaption}>Uso de CPU do servidor</div>
              <div className={s.gaugeState}>
                {metrics.cpu.value === null ? (
                  <span className={s.warning}>Sem telemetria</span>
                ) : (
                  <span
                    className={metrics.cpu.value! > 80 ? s.warning : s.good}
                  >
                    <Activity />
                    {metrics.cpu.value! > 80
                      ? "Uso elevado"
                      : "Dentro do esperado"}
                  </span>
                )}
              </div>
            </Panel>
            <Panel title="Memória" icon={MemoryStick} tone="magenta">
              <Gauge
                value={metrics.memory.value}
                color="var(--magenta)"
                label="Memória"
              />
              <div className={s.gaugeCaption}>
                {live
                  ? "Memória ocupada · inclui cache do SO"
                  : "Uso de memória do servidor"}
              </div>
              <div className={s.gaugeState}>
                <span
                  className={
                    metrics.memory.value === null ? s.warning : s.muted
                  }
                >
                  {metrics.memory.value === null
                    ? "Sem telemetria"
                    : "Capacidade monitorada"}
                </span>
              </div>
            </Panel>
          </div>
          <Applications
            sample={sample}
            selected={selected}
            setSelected={setSelected}
            setHighlighted={setHighlighted}
          />
          <Panel
            title="Picos de acesso"
            icon={Activity}
            className={s.accessPanel}
            action={periodControl}
          >
            <div className={s.chartMeta}>
              <span>EXECUÇÕES SQL/s</span>
              <span>
                Pico{" "}
                <strong>
                  {number(Math.max(0, ...history.map((p) => p.sql ?? 0)))}
                </strong>
              </span>
            </div>
            <AccessChart data={history} />
          </Panel>
          <Panel
            title="Consultas mais pesadas"
            icon={Database}
            className={s.sqlPanel}
            action={
              <select
                className={s.smallSelect}
                aria-label="Ordenar consultas"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="time">Tempo</option>
                <option value="executions">Execuções</option>
              </select>
            }
          >
            <table className={s.sqlTable}>
              <thead>
                <tr>
                  <th>{live ? "SQL ID · CACHE" : "SQL ID · FICTÍCIO"}</th>
                  <th>MÉDIA (ms)</th>
                  <th>EXEC./s</th>
                  <th>IMPACTO</th>
                </tr>
              </thead>
              <tbody>
                {live && !queries.length && (
                  <tr>
                    <td colSpan={4}>
                      Sem execuções medidas nesta janela de 15 s
                    </td>
                  </tr>
                )}
                {queries.map((q) => (
                  <tr key={q.id}>
                    <td>{q.statement}</td>
                    <td>{number(q.averageMs, 1)}</td>
                    <td>{number(q.executions, live ? 2 : 0)}</td>
                    <td>
                      <span
                        className={
                          q.averageMs === null
                            ? s.muted
                            : q.impact === "Alto"
                              ? s.critical
                              : q.impact === "Médio"
                                ? s.warning
                                : s.cyan
                        }
                      >
                        {q.averageMs === null ? "—" : q.impact}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
        <div className={s.centerColumn}>
          <section className={s.corePanel} aria-label="Atividade do banco DB2">
            <div className={s.connections}>
              <div className={s.liveLabel}>
                <i /> {live ? `TELEMETRIA DB2 · ${(sample.metadata?.location ?? "").toUpperCase()}` : "TELEMETRIA SIMULADA"}
              </div>
              <h2>Conexões abertas</h2>
              <div className={s.connectionMetric}>
                <strong data-testid="connections">
                  {number(metrics.connections.value)}
                </strong>
                <Delta
                  value={trend(sample.history, "connections", 1)}
                  period="1 h"
                />
              </div>
              <p>
                {live ? (
                  `${sample.metadata?.database ?? "PRODUCAO"} · ${sample.metadata?.host || "—"}`
                ) : (
                  <>
                    de <b>{demoConfig.connectionLimit}</b> permitidas na
                    demonstração
                  </>
                )}
              </p>
            </div>
            <Core sample={sample} quality={actualQuality} moving={moving} />
            <div className={s.flowLegend}>
              <span><i /> ESQUERDA · EXECUÇÕES SQL/s</span>
              <span><i /> DIREITA · SESSÕES EM EXECUÇÃO</span>
            </div>
          </section>
          <div className={s.performance}>
            <Panel
              title={
                live
                  ? "Tempo médio de atividade SQL"
                  : "Tempo médio de execução SQL"
              }
              icon={Zap}
              tone="magenta"
              className={s.responsePanel}
            >
              <div className={s.responseMetric}>
                <strong data-testid="response">
                  {number(metrics.response.value)}
                  <span>ms</span>
                </strong>
                <Delta
                  value={trend(sample.history, "response", period)}
                  lowerBetter
                  period={`${period} h`}
                />
              </div>
              <Sparkline data={history} metric="response" color="#6677ff" />
              <span className={s.metricNote}>
                {metrics.response.quality === "unavailable"
                  ? "Medição indisponível"
                  : metrics.response.quality === "not-applicable" || idle
                    ? "Sem execuções no intervalo"
                    : metrics.response.value !== null && metrics.response.value > 150
                      ? "Acima do limite de 150 ms"
                      : live
                        ? "Atividades concluídas · inclui esperas"
                        : "Execuções concluídas no intervalo"}
              </span>
            </Panel>
            <Panel
              title="IOPS e Cache Hit"
              icon={Database}
              tone="blue"
              className={s.ioPanel}
            >
              <div className={s.ioMetrics}>
                <div>
                  <h3>IOPS</h3>
                  <strong>
                    {metrics.iops.value === null
                      ? "—"
                      : `${number(metrics.iops.value / 1000, 1)}k`}
                  </strong>
                  {!(live && metrics.iops.value === null) && (
                    <>
                      <Sparkline
                        data={history}
                        metric="iops"
                        color="#326bff"
                        bars
                      />
                      <Delta
                        value={trend(sample.history, "iops", period)}
                        period={`${period} h`}
                      />
                    </>
                  )}
                  {live && metrics.iops.value === null && (
                    <small className={s.metricNote}>
                      Aguardando coleta de disco
                    </small>
                  )}
                </div>
                <div>
                  <h3>Cache Hit</h3>
                  <strong>
                    {number(metrics.cache.value, 1)}
                    <span>%</span>
                  </strong>
                  <Sparkline
                    data={history}
                    metric="cache"
                    color="#25baff"
                    bars
                  />
                  <Delta
                    value={trend(sample.history, "cache", period)}
                    period={`${period} h`}
                  />
                </div>
              </div>
            </Panel>
          </div>
          <div className={s.centerMotto}>
            <Layers />
            <span>
              ESTABILIDADE <i>·</i> DESEMPENHO <i>·</i> INSIGHTS
            </span>
            <div />
          </div>
        </div>
        <div className={s.rightColumn}>
          <div className={s.healthPanels}>
            <Panel title="Saúde do banco" icon={HeartPulse} tone="good">
              <div className={`${s.healthBody} ${healthClass}`}>
                <div className={s.heartDisc}>
                  {sample.health === "healthy" ? (
                    <HeartPulse />
                  ) : (
                    <CircleHelp />
                  )}
                </div>
                <strong>{healthLabel}</strong>
                <p>
                  {missing
                    ? "Estado do banco sem confirmação"
                    : sample.health === "attention"
                      ? live ? "Desvio nas métricas monitoradas" : "Tempo SQL acima do ideal"
                      : live
                        ? "Sem desvios nas métricas coletadas"
                        : "Todos os componentes operacionais"}
                </p>
              </div>
            </Panel>
            <Panel
              title={live ? "Coletas com sucesso" : "Disponibilidade"}
              icon={ShieldCheck}
              tone="blue"
            >
              <div className={s.availability}>
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#102d3a"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke={missing ? "#776743" : "#00d9aa"}
                    strokeWidth="8"
                    strokeDasharray={`${((metrics.availability.value ?? 0) / 100) * 252} 252`}
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <strong>
                  {number(metrics.availability.value, 2)}
                  {metrics.availability.value === null ? "" : "%"}
                </strong>
                <span>
                  {live
                    ? "Período observado · até 30 dias"
                    : "Últimos 30 dias · simulado"}
                </span>
              </div>
            </Panel>
          </div>
          <Panel
            title="Usuários / Sessões"
            icon={Users}
            tone="magenta"
            className={s.usersPanel}
            action={<span className={s.sampleTag}>{live ? "AO VIVO" : "AGORA"}</span>}
          >
            <div className={s.sessionMetrics}>
              <div>
                <strong>{number(metrics.users.value)}</strong>
                <span>{live ? "Identidades Db2" : "Usuários conectados"}</span>
              </div>
              <div>
                <strong data-testid="executing-sessions">
                  {number(metrics.executingSessions.value)}
                </strong>
                <span>Sessões executando</span>
              </div>
            </div>
            <table className={s.sessionTable}>
              <thead>
                <tr>
                  <th>{live ? "APLICAÇÃO" : "GRUPO DEMO"}</th>
                  <th>EXECUTANDO</th>
                  <th>ESTADO</th>
                </tr>
              </thead>
              <tbody>
                {sample.sessionGroups.map((group, index) => (
                  <tr
                    key={group.id}
                    data-session-row={group.id}
                    data-active={group.executing !== null && group.executing > 0}
                    style={{ "--session-delay": `${-index * 0.37}s` } as React.CSSProperties}
                  >
                    <td>
                      <span className={s.sessionOrigin} data-session-origin={group.id} aria-hidden="true" />
                      {group.label}
                    </td>
                    <td>
                      <div className={s.sessionCount}>
                        <b>{number(group.executing)}</b>
                        {group.executing !== null && group.executing > 0 && (
                          <span className={s.sessionActivity} aria-hidden="true" data-session-motion>
                            <i /><i /><i /><i />
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span
                        className={
                          group.executing === null
                            ? s.warning
                            : group.executing === 0
                              ? s.muted
                              : s.good
                        }
                      >
                        {group.executing === null ? (
                          <CircleHelp />
                        ) : group.executing === 0 ? (
                          <Radio />
                        ) : (
                          <CircleCheck />
                        )}
                        {group.executing === null
                          ? "Sem dados"
                          : group.executing === 0
                            ? "Ocioso"
                            : "Executando"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={s.sessionsFoot}>
              <span>
                Conexões abertas <b>{number(metrics.connections.value)}</b>
              </span>
              <span>
                {live ? (
                  "Inclui monitoramento"
                ) : (
                  <>
                    Limite demo <b>{demoConfig.connectionLimit}</b>
                  </>
                )}
              </span>
            </div>
          </Panel>
          <Panel
            title="Alertas recentes"
            icon={Bell}
            tone="magenta"
            className={s.alertsPanel}
            action={
              <select
                className={s.smallSelect}
                aria-label="Filtrar alertas"
                value={alertFilter}
                onChange={(e) => setAlertFilter(e.target.value)}
              >
                <option value="all">Todos</option>
                <option value="critical">Críticos</option>
                <option value="warning">Atenção</option>
                <option value="info">Informações</option>
              </select>
            }
          >
            <div className={s.alerts}>
              {alerts.map((a) => (
                <div key={a.id} className={s.alert}>
                  <time>{timeLabel(a.time)}</time>
                  {a.severity === "info" ? (
                    <CircleCheck className={s.good} />
                  ) : (
                    <CircleAlert
                      className={
                        a.severity === "critical" ? s.critical : s.warning
                      }
                    />
                  )}
                  <span>{a.message}</span>
                </div>
              ))}
              {!alerts.length && (
                <div className={s.emptyAlerts}>
                  <CircleCheck />
                  <strong>Nenhum alerta neste filtro</strong>
                  <button onClick={() => setAlertFilter("all")}>
                    Ver todos os alertas
                  </button>
                </div>
              )}
            </div>
            <div className={s.collectorState}>
              <Radio className={missing ? s.warning : s.good} />
              <span>
                {missing
                  ? "Coletor indisponível"
                  : live
                    ? "Coletor conectado ao Db2"
                    : "Coletor simulado operacional"}
              </span>
              <span className={s.collectorDot} />
            </div>
          </Panel>
          <div className={s.rightMotto}>
            DADOS QUE MOVEM <strong>DECISÕES.</strong>
          </div>
        </div>
        <EnergyFlows
          board={board}
          apps={sample.applications}
          sessions={sample.sessionGroups}
          selected={highlighted ?? selected}
          quality={actualQuality}
          moving={moving}
        />
      </main>
      <footer className={s.footer}>
        <div className={s.demoBadge}>
          <span />
          {live ? "PRODUÇÃO • DADOS DO DB2" : "DEMONSTRAÇÃO • DADOS SIMULADOS"}
        </div>
        <span className={s.lastSample}>
          {missing ? "Última coleta válida" : "Última amostra"}{" "}
          <time>
            {sample.lastGoodAt
              ? timeLabel(sample.lastGoodAt)
              : "Aguardando coleta"}
          </time>
          {paused
            ? live
              ? " · Movimento pausado"
              : " · Pausada"
            : missing
              ? " · Dados indisponíveis"
              : " · Atualização a cada 2 s"}
        </span>
        <div className={s.toolbar}>
          <span className={s.scenarioLabel}>
            {live ? "Conexão real" : scenarios[scenario]}
          </span>
          <button
            aria-label={
              live
                ? paused
                  ? "Retomar movimento"
                  : "Pausar movimento"
                : paused
                  ? "Retomar simulação"
                  : "Pausar simulação"
            }
            onClick={() => setPaused(!paused)}
            aria-pressed={paused}
          >
            {paused ? <Play /> : <Pause />}
          </button>
          <button
            ref={settingsButton}
            aria-label={live ? "Configurar painel" : "Configurar demonstração"}
            aria-expanded={settings}
            aria-controls="demo-settings"
            onClick={() => setSettings(!settings)}
          >
            <Settings2 />
          </button>
          <button
            aria-label={screen ? "Sair da tela cheia" : "Ativar modo telão"}
            onClick={fullscreen}
          >
            {screen ? <Minimize /> : <Maximize />}
          </button>
        </div>
      </footer>
      {settings && (
        <section
          id="demo-settings"
          className={s.settings}
          aria-label={
            live ? "Configurações do painel" : "Configurações da demonstração"
          }
        >
          <div>
            <h2>
              {live ? "Configurações do painel" : "Controles da demonstração"}
            </h2>
            <button
              aria-label="Fechar configurações"
              onClick={() => {
                setSettings(false);
                settingsButton.current?.focus();
              }}
            >
              <X />
            </button>
          </div>
          {!live && (
            <label>
              Cenário
              <select
                aria-label="Cenário"
                value={scenario}
                disabled={!controls}
                onChange={(e) => {
                  const next = e.target.value as Scenario;
                  setScenario(next);
                  controls?.setScenario(next);
                }}
              >
                {Object.entries(scenarios).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Qualidade gráfica
            <select
              aria-label="Qualidade gráfica"
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
            >
              <option value="high">Alta</option>
              <option value="eco">Econômica</option>
            </select>
          </label>
          <p>
            {reduced
              ? "Movimento reduzido conforme preferência do sistema."
              : "As partículas representam atividade agregada."}
          </p>
          <span>
            {live
              ? "Contadores do Db2 a cada 2 s; servidor a cada 10 s. SQL inclui o monitor. OUTROS inclui atividade sem origem atribuída. IOPS aguarda integração de disco."
              : "Todos os ambientes e cenários são simulados."}
          </span>
        </section>
      )}
      <div role="status" className={notice ? s.notice : s.srOnly}>
        {notice}
      </div>
    </div>
  );
}
