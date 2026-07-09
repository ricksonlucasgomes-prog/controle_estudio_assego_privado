// Textos dos Termos de Uso exibidos no popup de leitura obrigatória (scroll-to-accept).
// Estrutura simples (título + seções) para renderização em src/TermsScrollPopup.tsx.

export type TermSection = { heading: string; paragraphs: string[] };

export type TermDocument = {
  title: string;
  subtitle: string;
  intro: string;
  sections: TermSection[];
  declaration: string;
};

// Termo de Uso e Responsabilidade do Estúdio de Gravação — Versão 2.0
// (usado no fluxo de agendamento/reserva do estúdio — aba Agenda)
export const BOOKING_TERMS: TermDocument = {
  title: 'Termo de Uso e Responsabilidade do Estúdio de Gravação',
  subtitle: 'Assego Studio — ASSEGO PM & BM — Versão 2.0',
  intro:
    'Leia com atenção antes de solicitar ou confirmar uma reserva. O envio da solicitação pelo app, o aceite das regras e a assinatura digital significam concordância com este Termo e responsabilidade pelas informações prestadas.',
  sections: [
    {
      heading: '1. Objeto e finalidade',
      paragraphs: [
        'Este Termo regula o uso do estúdio de gravação da ASSEGO PM & BM, denominado Assego Studio, por solicitantes, convidados, apresentadores, participantes, acompanhantes e demais pessoas autorizadas pela administração.',
        'O estúdio destina-se à realização de gravações, podcasts, entrevistas, transmissões, conteúdos institucionais e demais atividades previamente autorizadas pela ASSEGO.',
      ],
    },
    {
      heading: '2. Agendamento, horário de funcionamento e permanência',
      paragraphs: [
        'O uso do estúdio depende de solicitação pelo app Assego Studio e de aprovação pela administração ou pelos responsáveis autorizados.',
        'O horário regular de funcionamento para reservas é de segunda a sexta-feira, das 9h às 17h. Caso a gravação se inicie às 17h, deverá obrigatoriamente ser encerrada até às 18h, incluindo desmontagem, retirada de materiais pessoais e liberação do ambiente.',
        'Atrasos do solicitante, convidados ou equipe não prorrogam automaticamente o horário reservado. A ASSEGO poderá cancelar, encerrar ou reagendar a utilização em caso de atraso relevante, conflito de agenda, necessidade administrativa, manutenção, segurança ou descumprimento deste Termo.',
        'Não haverá agendamento fora do horário regular, salvo autorização expressa da administração.',
      ],
    },
    {
      heading: '3. Cadastro, controle de acesso e responsabilidade pelas informações',
      paragraphs: [
        'Para reservar o estúdio, o solicitante deverá informar, no app, seus dados e os dados dos participantes/convidados, incluindo nome, RG, CPF, WhatsApp, e-mail, rede social, data e horário pretendidos, além de assinatura digital quando exigida.',
        'O solicitante declara que as informações prestadas são verdadeiras, completas e atualizadas, responsabilizando-se por dados incorretos, omissões, uso indevido de identidade de terceiros ou inclusão de participantes sem autorização.',
        'Somente pessoas previamente informadas e autorizadas poderão acessar ou permanecer no estúdio. A administração poderá solicitar documento de identificação e impedir a entrada de pessoas não cadastradas, não autorizadas ou que representem risco à segurança ou à ordem do local.',
      ],
    },
    {
      heading: '4. Participantes, convidados e acompanhantes',
      paragraphs: [
        'Apenas participantes diretamente envolvidos na gravação poderão permanecer no estúdio. Será permitido, no máximo, 1 acompanhante autorizado, salvo autorização expressa da administração.',
        'Pessoas que não participarem diretamente da gravação deverão aguardar em local indicado pela administração, sem interferir na rotina do estúdio, da equipe técnica ou das demais áreas da ASSEGO.',
        'O solicitante é responsável pela conduta de seus convidados, participantes e acompanhante, inclusive quanto ao cumprimento das regras de acesso, segurança, organização, silêncio e preservação do ambiente.',
      ],
    },
    {
      heading: '5. Uso dos equipamentos e área técnica',
      paragraphs: [
        'Todos os equipamentos do estúdio pertencem ou estão sob responsabilidade da ASSEGO e somente poderão ser manuseados por técnicos autorizados pela administração, incluindo Lucas Rickson, Wagner Badu ou outro responsável formalmente designado.',
        'É proibido ao solicitante, convidados ou acompanhantes ligar, desligar, deslocar, configurar, desmontar, conectar ou desconectar câmeras, microfones, mesa de áudio, computadores, iluminação, cabos, interfaces, tripés, softwares ou quaisquer equipamentos do estúdio sem autorização expressa.',
        'A ilha de edição, computadores, sistemas de transmissão, contas, painéis de controle e áreas técnicas são de acesso restrito. Ninguém poderá permanecer próximo aos produtores, técnicos ou operadores sem autorização.',
      ],
    },
    {
      heading: '6. Sistemas, contas digitais e softwares',
      paragraphs: [
        'É proibido alterar logins, senhas, configurações, contas, e-mails, bibliotecas de mídia, bancos de arquivos, sistemas, plugins, presets, plataformas de edição, transmissão ou assinatura utilizados pela ASSEGO, incluindo Gmail, Envato ou outros serviços conectados ao estúdio.',
        'Também é proibido instalar programas, extensões, plugins, baixar arquivos suspeitos, conectar dispositivos externos não autorizados, alterar configurações de rede ou acessar contas pessoais nos equipamentos do estúdio sem autorização.',
        'Qualquer necessidade técnica deverá ser comunicada à equipe responsável antes do início da gravação.',
      ],
    },
    {
      heading: '7. Organização, cenário, decoração e materiais pessoais',
      paragraphs: [
        'A decoração, móveis, iluminação, equipamentos, objetos de cena, cabos e demais itens do estúdio não poderão ser movidos, retirados ou modificados sem autorização da equipe responsável.',
        'Materiais pessoais como copos, garrafas, canecas, figurinos, objetos de apoio, produtos, brindes, equipamentos próprios e demais pertences são de responsabilidade exclusiva do solicitante e deverão ser retirados ao final da utilização.',
        'A ASSEGO não se responsabiliza por objetos pessoais esquecidos, perdidos, danificados ou deixados no estúdio, salvo quando houver comprovação de responsabilidade direta da instituição.',
      ],
    },
    {
      heading: '8. Limpeza, alimentação e conservação do ambiente',
      paragraphs: [
        'O solicitante deverá retirar todo material pessoal, embalagens, restos de alimentos, garrafas, copos, papéis e lixo produzido durante a gravação.',
        'Alimentos e bebidas somente poderão ser consumidos em locais autorizados e não poderão ser colocados sobre equipamentos, mesas técnicas, computadores, cabos, microfones ou superfícies sensíveis.',
        'O ambiente deverá ser devolvido limpo, organizado e em condições adequadas para o próximo uso.',
      ],
    },
    {
      heading: '9. Conduta, segurança e proibições',
      paragraphs: [
        'Durante a permanência no estúdio, todos deverão manter postura respeitosa, colaborativa e compatível com o ambiente institucional da ASSEGO.',
        'É proibido:',
        '• praticar atos ofensivos, discriminatórios, ameaçadores, tumultuosos ou incompatíveis com a finalidade do espaço;',
        '• danificar, ocultar, retirar ou utilizar indevidamente bens, documentos, equipamentos ou materiais da ASSEGO;',
        '• fumar, consumir drogas ilícitas ou portar itens perigosos no ambiente do estúdio, salvo hipóteses legalmente permitidas e previamente autorizadas pela administração;',
        '• realizar gravações paralelas, lives, fotos ou captação de bastidores em áreas restritas sem autorização;',
        '• produzir conteúdo ilegal, difamatório, discriminatório, que viole direitos de terceiros ou que possa comprometer a imagem institucional da ASSEGO.',
      ],
    },
    {
      heading: '10. Responsabilidade por danos',
      paragraphs: [
        'O solicitante responderá por danos, perdas, extravios, mau uso, quebras ou prejuízos causados por si, por convidados, participantes ou acompanhantes aos equipamentos, móveis, cenário, estrutura física, sistemas ou materiais do estúdio.',
        'Constatada avaria, uso indevido ou desaparecimento de item, a administração poderá registrar ocorrência interna, exigir ressarcimento, suspender novas reservas e adotar as medidas administrativas ou legais cabíveis.',
      ],
    },
    {
      heading: '11. Conteúdo gravado, imagem, voz e direitos autorais',
      paragraphs: [
        'O solicitante é responsável pelo conteúdo produzido, pelas falas, imagens, músicas, marcas, vinhetas, materiais de terceiros, opiniões, autorizações de imagem e voz de convidados, direitos autorais, direitos conexos e demais permissões necessárias à gravação, exibição, edição, transmissão ou publicação.',
        'A reserva do estúdio não garante publicação em canais oficiais da ASSEGO, nem autorização automática para uso institucional do conteúdo. Quando houver publicação, transmissão ou divulgação pelos canais da ASSEGO, poderão ser exigidas autorizações específicas, aprovação editorial ou adequação às normas internas de comunicação.',
        'Quando o conteúdo for produzido, transmitido ou publicado pela própria ASSEGO, os participantes declaram ciência de que sua imagem e voz poderão aparecer na gravação, observadas as finalidades informadas, as regras internas e a legislação aplicável.',
      ],
    },
    {
      heading: '12. Tratamento de dados pessoais e LGPD',
      paragraphs: [
        'Para realizar controle de acesso, gestão de reservas, segurança do estúdio, registro de aceite, responsabilização, comunicação administrativa e prevenção de incidentes, a ASSEGO poderá tratar dados pessoais do solicitante e dos participantes cadastrados no app.',
        'Poderão ser tratados: nome, RG, CPF, telefone/WhatsApp, e-mail, rede social, data e horário da reserva, assinatura digital, aceite do termo, registros técnicos do app, dados de dispositivo/navegador, endereço IP quando disponível, histórico da solicitação e dados necessários à segurança e administração do espaço.',
        'Os dados serão acessados apenas por pessoas autorizadas, pelo tempo necessário ao cumprimento das finalidades acima, observadas obrigações legais, administrativas, segurança institucional e eventual necessidade de defesa de direitos.',
        'O titular poderá solicitar informações, correção ou tratamento adequado de seus dados pelos canais indicados pela ASSEGO, observadas as limitações legais e a necessidade de manutenção de registros para segurança, prestação de contas e defesa de direitos.',
      ],
    },
    {
      heading: '13. Assinatura digital e aceite eletrônico',
      paragraphs: [
        'O aceite deste Termo poderá ocorrer por meio eletrônico no app Assego Studio, mediante marcação de concordância, assinatura digital pelo nome completo e envio da solicitação de reserva.',
        'Ao assinar eletronicamente, o solicitante declara ter lido e aceito integralmente este Termo, assumindo responsabilidade por sua conduta e pela conduta dos convidados/participantes cadastrados.',
        'O app poderá registrar data, hora, usuário autenticado, e-mail, dispositivo, navegador, IP quando disponível e hash/registro técnico do aceite para fins de segurança, auditoria e comprovação administrativa.',
      ],
    },
    {
      heading: '14. Encerramento da utilização',
      paragraphs: [
        'Ao final da gravação, os técnicos autorizados farão o encerramento dos equipamentos e sistemas. O solicitante e seus convidados deverão aguardar a liberação da equipe técnica, retirar seus materiais pessoais, descartar o lixo produzido e deixar o ambiente organizado.',
        'O descumprimento das regras de encerramento poderá gerar restrição a novos agendamentos.',
      ],
    },
    {
      heading: '15. Descumprimento, suspensão e cancelamento',
      paragraphs: [
        'O descumprimento deste Termo poderá resultar em advertência, encerramento imediato da gravação, cancelamento da reserva, suspensão temporária ou definitiva de novos agendamentos, cobrança de ressarcimento e adoção de medidas administrativas ou legais cabíveis.',
        'A ASSEGO poderá negar, suspender ou cancelar reserva quando houver risco à segurança, conflito de agenda, manutenção técnica, indisponibilidade de equipe, irregularidade cadastral, uso incompatível do espaço ou descumprimento de regra interna.',
      ],
    },
    {
      heading: '16. Disposições finais',
      paragraphs: [
        'Este Termo poderá ser atualizado pela ASSEGO para refletir melhorias no funcionamento do estúdio, adequações técnicas, mudanças administrativas ou exigências legais. A versão vigente será disponibilizada no app ou por meio indicado pela administração.',
        'Casos omissos serão avaliados pela administração da ASSEGO, considerando a finalidade institucional do estúdio, a segurança do espaço, a preservação dos equipamentos e a boa-fé das partes.',
        'Fica eleito o foro competente da sede da ASSEGO, salvo regra legal obrigatória diversa, para dirimir eventuais controvérsias relacionadas a este Termo.',
      ],
    },
  ],
  declaration:
    'Declaro que li, compreendi e aceito o presente Termo de Uso e Responsabilidade do Estúdio de Gravação — Assego Studio, responsabilizando-me pelas informações prestadas e pela conduta dos convidados/participantes vinculados à minha solicitação de reserva. O aceite eletrônico é registrado automaticamente pelo app Assego Studio (usuário autenticado, data/hora e IP quando disponível).',
};
