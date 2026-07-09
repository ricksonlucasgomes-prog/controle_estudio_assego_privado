// Popup de leitura obrigatória do Termo de Uso: o texto fica inline (sem
// download de PDF), rolável com mouse/touch. O botão "Concordo" só aparece
// habilitado depois que o usuário rola até o final do documento.
// Reutilizável: recebe o TermDocument (ver src/termsContent.ts) tanto para o
// termo da Agenda (reserva do estúdio) quanto para o termo de equipamentos.

import { useRef, useState } from 'react';
import type { TermDocument } from './termsContent';

type TermsScrollPopupProps = {
  document: TermDocument;
  onAccept: () => void;
  onClose: () => void;
};

export function TermsScrollPopup({ document: doc, onAccept, onClose }: TermsScrollPopupProps) {
  const [reachedEnd, setReachedEnd] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  function handleScroll() {
    const el = bodyRef.current;
    if (!el || reachedEnd) return;
    const threshold = 32; // tolerância em px para considerar "chegou ao fim"
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      setReachedEnd(true);
    }
  }

  return (
    <div className="terms-popup-overlay" onClick={onClose}>
      <div className="terms-popup" onClick={(event) => event.stopPropagation()}>
        <div className="terms-popup__head">
          <div>
            <p className="terms-popup__eyebrow">Termo de uso</p>
            <h3>{doc.title}</h3>
            <span className="terms-popup__subtitle">{doc.subtitle}</span>
          </div>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>

        <div className="terms-popup__body" ref={bodyRef} onScroll={handleScroll}>
          <p className="terms-popup__intro">{doc.intro}</p>

          {doc.sections.map((section) => (
            <div className="terms-popup__section" key={section.heading}>
              <h4>{section.heading}</h4>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ))}

          <div className="terms-popup__declaration">
            <strong>Declaração de aceite</strong>
            <p>{doc.declaration}</p>
          </div>

          <div className="terms-popup__end-marker" aria-hidden="true">— Fim do documento —</div>
        </div>

        <div className="terms-popup__foot">
          <span className="terms-popup__hint">
            {reachedEnd
              ? 'Você leu até o final. Pode confirmar o aceite.'
              : 'Role o texto até o final para habilitar o botão de aceite.'}
          </span>
          <div className="terms-popup__foot-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Fechar sem aceitar
            </button>
            <button
              type="button"
              className="btn btn-yellow"
              disabled={!reachedEnd}
              onClick={onAccept}
            >
              Concordo com os termos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
