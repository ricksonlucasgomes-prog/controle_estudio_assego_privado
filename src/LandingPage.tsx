import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  PackageCheck,
  Radio,
  ShieldCheck,
  Video,
} from 'lucide-react';

type LandingPageProps = {
  onLogin: () => void;
};

const features = [
  {
    icon: CalendarDays,
    label: 'Agenda integrada',
    title: 'Reservas sem conflito',
    description: 'Consulte horários, solicite o estúdio e acompanhe cada aprovação em um único fluxo.',
  },
  {
    icon: PackageCheck,
    label: 'Patrimônio protegido',
    title: 'Controle de equipamentos',
    description: 'Registre retiradas, devoluções, fotos e conferências com histórico completo.',
  },
  {
    icon: ShieldCheck,
    label: 'Processos seguros',
    title: 'Rastreabilidade real',
    description: 'Permissões por perfil, termos digitais e registros centralizados para toda a equipe.',
  },
];

export function LandingPage({ onLogin }: LandingPageProps) {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="#inicio" aria-label="Assego Studio — início">
          <span className="landing-logo"><img src="/logo.png" alt="" /></span>
          <span className="landing-brand-copy">
            <strong>ASSEGO Studio</strong>
            <small>PM &amp; BM</small>
          </span>
        </a>

        <nav className="landing-nav-links" aria-label="Navegação principal">
          <a href="#recursos">Recursos</a>
          <a href="#processo">Como funciona</a>
          <a href="#seguranca">Segurança</a>
        </nav>

        <button type="button" className="landing-nav-cta" onClick={onLogin}>
          Entrar no sistema <ArrowRight size={17} />
        </button>
      </header>

      <section className="landing-hero" id="inicio">
        <div className="landing-hero-copy">
          <div className="landing-status-pill">
            <span /> Plataforma interna ASSEGO
          </div>
          <h1>O estúdio,<br />sob controle.<em>Do agendamento à entrega.</em></h1>
          <p>
            Uma plataforma exclusiva para gerenciar reservas, equipamentos e rotinas do estúdio da ASSEGO com clareza, segurança e controle.
          </p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-primary-btn" onClick={onLogin}>
              Acessar plataforma <ArrowRight size={19} />
            </button>
            <a className="landing-secondary-btn" href="#recursos">Conhecer recursos</a>
          </div>
          <div className="landing-trust-row" aria-label="Diferenciais da plataforma">
            <span><Check size={15} /> Acesso controlado</span>
            <span><Check size={15} /> Histórico completo</span>
            <span><Check size={15} /> Responsivo e instalável</span>
          </div>
        </div>

        <div className="landing-product-stage" aria-label="Prévia da tela Agenda do Assego Studio">
          <div className="landing-stage-glow" />
          <div className="landing-app-preview">
            <div className="landing-preview-marquee">SISTEMA EM DESENVOLVIMENTO • NOVIDADES EM BREVE • ASSEGO STUDIO</div>
            <div className="landing-preview-topbar">
              <div className="landing-preview-brand">
                <span><img src="/logo.png" alt="" /></span>
                <div><small>ASSEGO PM &amp; BM</small><strong>Assego Studio</strong></div>
              </div>
              <div className="landing-preview-session"><Bell size={13} /><b>LR</b></div>
            </div>
            <div className="landing-preview-content">
              <section className="landing-preview-hero">
                <div>
                  <small>PAINEL OPERACIONAL</small>
                  <h3>O Estúdio da ASSEGO em uma única visão</h3>
                  <p>Reservas, gravações, conferências e equipamentos.</p>
                </div>
                <div className="landing-preview-hero-action"><span><CalendarDays size={13} /> Solicitar agendamento</span><small><Activity size={10} /> Sistema operacional</small></div>
              </section>
              <div className="landing-preview-grid">
                <article className="landing-preview-card">
                  <div className="landing-preview-card-head"><span><Clock3 size={15} /></span><b className="online">Agenda</b></div>
                  <div className="landing-preview-card-body"><small>PRÓXIMA GRAVAÇÃO</small><strong>Agenda disponível</strong><p>Nenhuma gravação aprovada.</p></div>
                  <em>Consultar horários <ArrowRight size={12} /></em>
                </article>
                <article className="landing-preview-card">
                  <div className="landing-preview-card-head"><span><ShieldCheck size={15} /></span><b>Operação</b></div>
                  <div className="landing-preview-card-body"><strong>Estúdio pronto</strong><p>24 de 24 itens no estúdio</p><i><span /></i></div>
                  <div className="landing-preview-stats"><span><b>24</b> conferidos</span><span><b>0</b> pendências</span></div>
                </article>
                <article className="landing-preview-card landing-preview-actions">
                  <div className="landing-preview-card-head"><div><small>ACESSO RÁPIDO</small><strong>O que você quer fazer?</strong></div></div>
                  <div className="landing-preview-actions-grid"><span><CalendarDays size={14} /> Reservar</span><span><Radio size={14} /> Ao Vivo</span><span><ClipboardCheck size={14} /> Conferir</span><span><PackageCheck size={14} /> Equipamentos</span></div>
                </article>
              </div>
            </div>
            <nav className="landing-preview-tabs" aria-label="Abas do app">
              <span className="active"><CalendarDays size={13} /> Agenda</span><span><Video size={13} /> Ao Vivo</span><span><ClipboardCheck size={13} /> Conferência</span><span><PackageCheck size={13} /> Equipamento</span>
            </nav>
          </div>
        </div>
      </section>

      <section className="landing-section" id="recursos">
        <div className="landing-section-heading">
          <div><span className="landing-kicker">GESTÃO CENTRALIZADA</span><h2>Tudo o que o estúdio precisa.<br />Nada além do necessário.</h2></div>
          <p>Menos planilhas, mensagens dispersas e dúvidas. Mais autonomia para a equipe e visibilidade para a gestão.</p>
        </div>
        <div className="landing-feature-grid">
          {features.map(({ icon: Icon, label, title, description }, index) => (
            <article className="landing-feature-card" key={title}>
              <div className="landing-feature-top"><span><Icon size={22} /></span><small>0{index + 1}</small></div>
              <em>{label}</em><h3>{title}</h3><p>{description}</p>
              <button type="button" onClick={onLogin}>Explorar recurso <ArrowRight size={16} /></button>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-process" id="processo">
        <div className="landing-process-copy">
          <span className="landing-kicker">FLUXO SIMPLES</span>
          <h2>Da solicitação à conclusão em quatro passos.</h2>
          <p>Cada etapa fica registrada para que todos saibam o que acontece agora e o que vem depois.</p>
          <button type="button" className="landing-text-btn" onClick={onLogin}>Começar agora <ArrowRight size={17} /></button>
        </div>
        <ol className="landing-process-list">
          <li><span>01</span><div><strong>Solicite</strong><p>Escolha data, horário e recursos necessários.</p></div><CheckCircle2 size={20} /></li>
          <li><span>02</span><div><strong>Confirme</strong><p>Acompanhe a análise e receba a confirmação.</p></div><CheckCircle2 size={20} /></li>
          <li><span>03</span><div><strong>Utilize</strong><p>Acesse o estúdio com tudo previamente preparado.</p></div><CheckCircle2 size={20} /></li>
          <li><span>04</span><div><strong>Finalize</strong><p>Registre termos, devoluções e observações.</p></div><CheckCircle2 size={20} /></li>
        </ol>
      </section>

      <section className="landing-security" id="seguranca">
        <div className="landing-security-icon"><ShieldCheck size={36} /></div>
        <div><span className="landing-kicker">SEGURANÇA POR PADRÃO</span><h2>Informação certa, para a pessoa certa.</h2><p>Autenticação individual, níveis de acesso e rastreabilidade das operações protegem os processos e o patrimônio da associação.</p></div>
        <div className="landing-security-points"><span><Check size={16} /> Perfis e permissões</span><span><Check size={16} /> Termos digitais</span><span><Check size={16} /> Registros auditáveis</span></div>
      </section>

      <section className="landing-final-cta">
        <div><span className="landing-kicker">ASSEGO STUDIO</span><h2>Seu próximo agendamento começa aqui.</h2><p>Acesse a plataforma e organize toda a operação do estúdio em um só lugar.</p></div>
        <button type="button" className="landing-primary-btn" onClick={onLogin}>Entrar no sistema <ArrowRight size={19} /></button>
      </section>

      <footer className="landing-footer">
        <div className="landing-brand"><span className="landing-logo"><img src="/logo.png" alt="" /></span><span className="landing-brand-copy"><strong>ASSEGO Studio</strong><small>PM &amp; BM</small></span></div>
        <p>Plataforma interna de gestão do estúdio.</p><small>Desenvolvido por Lucas Rickson</small>
      </footer>
    </main>
  );
}

export default LandingPage;
