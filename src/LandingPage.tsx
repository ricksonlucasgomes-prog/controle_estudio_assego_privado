type LandingPageProps = {
  onLogin: () => void;
};

export function LandingPage({ onLogin }: LandingPageProps) {
  return (
    <main className="landing-page">
      <div className="assego-marquee" role="marquee" aria-label="Aviso do app">
        <div className="assego-marquee__track">
          <span className="assego-marquee__item">APP AINDA EM DESENVOLVIMENTO - DEV: LUCAS RICKSON - NOVAS ATUALIZAÇÕES EM BREVE</span>
          <span className="assego-marquee__item">APP AINDA EM DESENVOLVIMENTO - DEV: LUCAS RICKSON - NOVAS ATUALIZAÇÕES EM BREVE</span>
          <span className="assego-marquee__item">APP AINDA EM DESENVOLVIMENTO - DEV: LUCAS RICKSON - NOVAS ATUALIZAÇÕES EM BREVE</span>
          <span className="assego-marquee__item">APP AINDA EM DESENVOLVIMENTO - DEV: LUCAS RICKSON - NOVAS ATUALIZAÇÕES EM BREVE</span>
        </div>
      </div>

      <section className="landing-shell">
        <header className="landing-topbar">
          <div className="landing-brand">
            <div className="logo-chip landing-logo">
              <img src="/logo.png" alt="ASSEGO PM & BM" />
            </div>

            <div>
              <p className="eyebrow">ASSEGO PM &amp; BM</p>
              <strong>Assego Studio</strong>
            </div>
          </div>

          <div className="landing-actions">
            <button type="button" className="landing-link-btn" onClick={onLogin}>
              Entrar
            </button>

            <button type="button" className="btn btn-yellow landing-main-btn" onClick={onLogin}>
              Acessar app
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="eyebrow">Plataforma completa</p>

            <h1>O estúdio da ASSEGO em uma única plataforma</h1>

            <p>
              Gerencie agenda, reservas, gravações, termos digitais, conferência
              e equipamentos em um só lugar, com segurança e praticidade.
            </p>

            <div className="landing-hero-actions">
              <button type="button" className="btn btn-yellow" onClick={onLogin}>
                Entrar no app
                <span aria-hidden="true">→</span>
              </button>

              <a className="btn ghost" href="#como-funciona">
                Saiba mais
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>

          <div className="landing-hero-art" aria-hidden="true">
            <span className="landing-orbit landing-orbit-one" />
            <span className="landing-orbit landing-orbit-two" />
            <span className="landing-glow" />
          </div>
        </section>

        <section className="landing-feature-grid" aria-label="Recursos principais">
          <article className="landing-card">
            <span className="landing-icon">📅</span>
            <div>
              <h2>Reservas</h2>
              <p>Agende estúdios e recursos com facilidade e antecedência.</p>
              <button type="button" onClick={onLogin}>Saiba mais →</button>
            </div>
          </article>

          <article className="landing-card">
            <span className="landing-icon">📡</span>
            <div>
              <h2>Ao Vivo</h2>
              <p>Acompanhe transmissões e conteúdos do estúdio.</p>
              <button type="button" onClick={onLogin}>Saiba mais →</button>
            </div>
          </article>

          <article className="landing-card">
            <span className="landing-icon">📦</span>
            <div>
              <h2>Equipamentos</h2>
              <p>Consulte, solicite e controle equipamentos com segurança.</p>
              <button type="button" onClick={onLogin}>Saiba mais →</button>
            </div>
          </article>
        </section>

        <section className="landing-steps" id="como-funciona">
          <p className="eyebrow landing-center">Como funciona</p>

          <div className="landing-step-grid">
            <article className="landing-step">
              <span>1</span>
              <div>
                <h3>Agende</h3>
                <p>Escolha data, horário e recursos disponíveis.</p>
              </div>
            </article>

            <article className="landing-step">
              <span>2</span>
              <div>
                <h3>Confirme</h3>
                <p>Revise os detalhes e confirme sua reserva.</p>
              </div>
            </article>

            <article className="landing-step">
              <span>3</span>
              <div>
                <h3>Utilize</h3>
                <p>Acesse o estúdio ou acompanhe a transmissão.</p>
              </div>
            </article>

            <article className="landing-step">
              <span>4</span>
              <div>
                <h3>Finalize</h3>
                <p>Assine termos, conclua o processo e mantenha tudo registrado.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="landing-cta">
          <div>
            <p className="eyebrow">Pronto para começar?</p>
            <h2>Acesse o sistema e aproveite todos os recursos do Assego Studio.</h2>
            <p>Uma plataforma completa para reservar, transmitir e gerenciar com eficiência.</p>
          </div>

          <div className="landing-cta-action">
            <button type="button" className="btn btn-yellow" onClick={onLogin}>
              Acessar o sistema
              <span aria-hidden="true">→</span>
            </button>

            <small>⌁ Sistema operacional</small>
          </div>
        </section>
      </section>
    </main>
  );
}

export default LandingPage;