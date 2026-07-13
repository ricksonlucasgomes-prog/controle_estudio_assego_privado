import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ClipboardCheck, PackageCheck, Video, CalendarDays, Camera, LogOut, ChevronRight, ChevronUp, ChevronDown, Clock3, Radio, ShieldCheck, Package, ArrowRight, Activity, ScanFace, Download, Upload, Link2, FileText, Mail, MessageCircle, X, type LucideIcon } from 'lucide-react';
import { edgeFunctionUrl, supabase, supabaseConfigured, type Profile, type UserRole } from './supabase';
import { TermsScrollPopup } from './TermsScrollPopup';
import { BOOKING_TERMS, EQUIPMENT_TERMS } from './termsContent';
import { LandingPage } from './LandingPage';
import {
  DEFAULT_DRIVE_FOLDER,
  STUDIO_KEY,
  addConference,
  addMedia,
  addObservation,
  deleteCheckout,
  deleteMedia,
  emptyStudioState,
  loadStudio,
  resetChecks,
  setCheck,
  upsertCheckout,
  writeLocalStudio,
  listBookingRequests,
  updateBookingStatus,
  listEquipmentRequests,
  updateEquipmentRequestStatus,
  type Checkout,
  type MediaItem,
  type NotificationEvent,
  type ObservationRecord,
  type ConferenceRecord,
  type StudioState,
  type BookingRequest,
  type BookingStatus,
  type EquipmentRequest,
  type EquipmentRequestStatus,
} from './studioApi';

type Equipment = {
  id: string;
  name: string;
  qty: number;
  alert?: string;
};

type EquipmentGroup = {
  cat: string;
  items: Equipment[];
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// 1. Adicionado 'agenda' ao tipo de abas
type MainTab = 'agenda' | 'camera' | 'conference' | 'custody';

type TabItem = {
  id: MainTab;
  label: string;
  icon: LucideIcon;
};

const EQUIPMENT: EquipmentGroup[] = [
  { cat: 'Vídeo & Switching', items: [
    { id: 'cam', name: 'Câmeras Blackmagic', qty: 3 },
    { id: 'atem', name: 'ATEM Mini Pro', qty: 2 },
    { id: 'bat', name: 'Baterias Blackmagic', qty: 3 },
  ] },
  { cat: 'Áudio', items: [
    { id: 'mesa', name: 'Mesa de áudio', qty: 1 },
    { id: 'mic', name: 'Microfones condensadores podcast', qty: 4 },
    { id: 'akg', name: 'Fone AKG', qty: 1 },
  ] },
  { cat: 'Iluminação', items: [
    { id: 'soft', name: 'Softbox', qty: 1 },
    { id: 'led', name: 'LEDs coloridos', qty: 2 },
  ] },
  { cat: 'Suporte', items: [
    { id: 'tripe', name: 'Tripés', qty: 3, alert: 'Falta 1' },
    { id: 'tripe_led', name: 'Tripés dos LEDs RGB', qty: 2 },
  ] },
  { cat: 'Energia', items: [
    { id: 'filtro', name: 'Filtro de linha', qty: 1 },
  ] },
];

const ALL_EQUIPMENT = EQUIPMENT.flatMap((group) => group.items);
const PROFILE_KEY = 'assego-profile-photos-v3';
type AvailabilitySlot = { time: string; available: boolean };
type AvailabilityDay = { date: string; weekday: number; slots: AvailabilitySlot[]; hasAvailability: boolean };

const EMAIL_RECIPIENTS = ['ricksonlucasgomes@gmail.com', 'comunicacaoassego@gmail.com', 'P3dacao@gmail.com'];
// Destinatários da aprovação do agendamento. O texto do Termo de Uso agora
// vive em src/termsContent.ts e é exibido inline no popup (ver TermsScrollPopup).
// Admins oficiais após aprovação manual: Badu, Sérgio Vinicius e Sgt. Tiago
// Raiz ('Serginho' é só um possível apelido de Sérgio Vinicius, não um
// quarto usuário). Lucas Rickson é 'developer' (acesso total), não admin,
// mas continua sendo o aprovador único — ver isLeadApprover.
const BOOKING_APPROVERS = ['Lucas Rickson', 'Badu', 'Sergio Vinicius', 'Sgt. Tiago Raiz'];
const PODCAST_NOTICE = 'App ainda em desenvolvimento - dev: Lucas Rickson - Novas atualizações em breve';
const UPLOAD_ENDPOINT = import.meta.env.VITE_UPLOAD_ENDPOINT as string | undefined;
const ACCESS_REQUEST_ENDPOINT = import.meta.env.VITE_ACCESS_REQUEST_ENDPOINT as string | undefined;
const BOOKING_MATERIALS_BUCKET = 'booking-materials';
const MAX_BOOKING_MATERIALS = 10;
const MAX_BOOKING_MATERIAL_BYTES = 50 * 1024 * 1024;
const MAX_BOOKING_MATERIALS_TOTAL_BYTES = 100 * 1024 * 1024;

type BookingMaterialUpload = {
  path: string;
  name: string;
  type: string;
  size: number;
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'admin',
  developer: 'desenvolvedor',
  borrower: 'retirada',
  viewer: 'visualização',
};

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  requested: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
};

// Data 'YYYY-MM-DD' + hora 'HH:MM' -> 'dd/mm/aaaa às HH:MM' sem sofrer
// deslocamento de fuso (parse manual, não via Date).
function formatBookingWhen(date: string | null, time: string | null): string {
  let out = '';
  if (date) {
    const [y, m, d] = date.split('-');
    out = d && m && y ? `${d}/${m}/${y}` : date;
  }
  if (time) out = out ? `${out} às ${time}` : time;
  return out || 'Sem data informada';
}

function formatDateInputValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function safeStorageFileName(name: string): string {
  const normalized = name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-');
  return normalized.replace(/^[-.]+|[-.]+$/g, '').slice(0, 120) || 'material';
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function parseMaterialLinks(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

// 2. Adicionada a aba de Agenda no Menu
const MAIN_TABS: TabItem[] = [
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'camera', label: 'Ao Vivo', icon: Video },
  { id: 'conference', label: 'Conferência', icon: ClipboardCheck },
  { id: 'custody', label: 'Equipamento', icon: PackageCheck },
];

// Único aprovador de solicitações (agendamento e equipamento) — regra de
// negócio: só Lucas Rickson (role 'developer') aprova/rejeita. Os 3 admins
// oficiais — Badu, Sérgio Vinicius e Sgt. Tiago Raiz — continuam vendo as
// listas (RLS de SELECT libera os admins), sem poder de aprovar/rejeitar.
const LEAD_APPROVER_EMAIL = 'ricksonlucasgomes@gmail.com';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function newRecordId() {
  return crypto.randomUUID();
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '--';
}

function equipmentName(id: string) {
  if (id === 'geral') return 'Geral do estúdio';
  return ALL_EQUIPMENT.find((item) => item.id === id)?.name ?? 'Equipamento';
}

function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Escolha uma imagem.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida.'));
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function resizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Escolha uma imagem.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida.'));
      img.onload = () => {
        const max = 320;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function borrowDueText(checkout: Checkout) {
  const dayMs = 86_400_000;
  const deadline = checkout.ts + 7 * dayMs;
  const now = Date.now();
  const dueDate = new Date(deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (now > deadline) {
    const days = Math.max(1, Math.floor((now - deadline) / dayMs));
    return `Atrasado, venceu ${dueDate} (${days}d)`;
  }
  const left = Math.max(0, Math.ceil((deadline - now) / dayMs));
  return left === 0 ? `Devolver hoje (${dueDate})` : `Devolver até ${dueDate}, faltam ${left}d`;
}

function friendlyAuthError(message: string) {
  const msg = message.toLowerCase();
  if (msg.includes('invalid login')) return 'Email ou senha incorretos.';
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'Esse email já tem cadastro. Faça login.';
  if (msg.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return 'Email inválido.';
  if (msg.includes('email not confirmed')) return 'Confirme seu email pelo link que enviamos antes de entrar.';
  if (msg.includes('email address not authorized')) return 'O envio de confirmação ainda não está liberado para este email. Avise o administrador.';
  if (msg.includes('rate limit') || msg.includes('email rate limit')) return 'Limite de emails atingido. Aguarde alguns minutos e tente novamente.';
  return message;
}

export function App() {
  const [studio, setStudio] = useState<StudioState>(() => readJson(STUDIO_KEY, emptyStudioState));
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>(() => readJson(PROFILE_KEY, {}));

  // Autenticacao (Supabase)
  const [showLogin, setShowLogin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState('');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState('');
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [formEmail, setFormEmail] = useState('');
  const [formPass, setFormPass] = useState('');
  const [formName, setFormName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authInfo, setAuthInfo] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);

  useEffect(() => {
    function handlePopState() {
      setShowLogin(window.history.state?.assegoView === 'login');
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function openLogin() {
    if (window.history.state?.assegoView !== 'login') {
      window.history.pushState({ ...window.history.state, assegoView: 'login' }, '');
    }
    setShowLogin(true);
  }

  // Instalacao (PWA)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);

  // Estudio / Estados Gerais
  const [pendingTake, setPendingTake] = useState('');
  const [pendingQty, setPendingQty] = useState(1);
  const [pendingJustification, setPendingJustification] = useState('');
  const [observationDraft, setObservationDraft] = useState(() => studio.notes);
  const [mediaEquipment, setMediaEquipment] = useState('geral');
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  // Toast de confirmação: vazio = escondido. É preenchido por flash() quando
  // algo é salvo e some sozinho depois de alguns segundos.
  const [savedNote, setSavedNote] = useState('');
  const flashTimer = useRef<number | undefined>(undefined);
  const [accessRequestBusy, setAccessRequestBusy] = useState(false);
  const [accessRequestInfo, setAccessRequestInfo] = useState('');
  // Papel que o próprio usuário está pedindo em "Pedir liberação". Quem
  // decide se libera é sempre um admin/developer manualmente no SQL Editor
  // — isto só define o texto do pedido enviado por email.
  const [requestedRoleChoice, setRequestedRoleChoice] = useState<'borrower' | 'admin'>('borrower');

  // A Agenda é a entrada principal do painel.
  const [activeTab, setActiveTab] = useState<MainTab>('agenda');

  // 4. Estados da Nova Feature de Agendamento
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showLegalPopup, setShowLegalPopup] = useState(false);
  const [requesterData, setRequesterData] = useState({
    name: '', rg: '', cpf: '', email: '', whatsapp: '', social: '', date: '', time: ''
  });
  const [guestsData, setGuestsData] = useState<{name: string, rg: string, cpf: string, email: string, whatsapp: string, social: string}[]>([]);

  // 5. Gate jurídico: leitura completa do Termo (popup com scroll obrigatório) + assinatura digital
  const [showTermPopup, setShowTermPopup] = useState(false);
  const [termAccepted, setTermAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [bookingBusy, setBookingBusy] = useState(false);
  const bookingIdempotencyKey = useRef(crypto.randomUUID());
  const [programName, setProgramName] = useState('');
  const [programFormat, setProgramFormat] = useState<'recorded' | 'live'>('recorded');
  const [productionNotes, setProductionNotes] = useState('');
  const [youtubeChannelUrl, setYoutubeChannelUrl] = useState('');
  const [youtubePermissionAcknowledged, setYoutubePermissionAcknowledged] = useState(false);
  const [bookingMaterialFiles, setBookingMaterialFiles] = useState<File[]>([]);
  const [bookingMaterialLinks, setBookingMaterialLinks] = useState('');

  // Popup de disponibilidade (agenda real do estúdio via studio-availability).
  const [showAvailability, setShowAvailability] = useState(false);
  const [availabilityDays, setAvailabilityDays] = useState<AvailabilityDay[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityMonthCursor, setAvailabilityMonthCursor] = useState(() => new Date());
  const [availabilitySelectedDate, setAvailabilitySelectedDate] = useState('');
  const [afterHoursMode, setAfterHoursMode] = useState(false);

  // Painel de admin: solicitações de agendamento para aprovar/rejeitar.
  const [bookingRequests, setBookingRequests] = useState<BookingRequest[]>([]);
  const [bookingListBusy, setBookingListBusy] = useState(false);
  const [bookingListError, setBookingListError] = useState('');
  const [bookingActionId, setBookingActionId] = useState('');
  const [expandedEquipmentRequestId, setExpandedEquipmentRequestId] = useState('');

  // Gate jurídico do fluxo "Pegar Equipamento do Estúdio" (mesmo mecanismo
  // do agendamento: popup com scroll obrigatório + assinatura digital).
  const [showEquipmentTermPopup, setShowEquipmentTermPopup] = useState(false);
  const [equipmentTermAccepted, setEquipmentTermAccepted] = useState(false);
  const [equipmentSignatureName, setEquipmentSignatureName] = useState('');
  // Categorias recolhidas por padrão: só mostram os itens após "Expandir".
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  // Selfie de validação facial capturada no popup de "Pegar" (base64).
  const [takeFacePhoto, setTakeFacePhoto] = useState('');
  const [takeFaceBusy, setTakeFaceBusy] = useState(false);

  // Solicitação de equipamento por quem não é admin/borrower.
  const [showEquipmentAccessGate, setShowEquipmentAccessGate] = useState(false);
  const [showEquipmentRequestForm, setShowEquipmentRequestForm] = useState(false);
  const [equipmentRequestTarget, setEquipmentRequestTarget] = useState('');
  const [equipmentRequestJustification, setEquipmentRequestJustification] = useState('');
  const [equipmentRequestBusy, setEquipmentRequestBusy] = useState(false);
  const [equipmentRequestInfo, setEquipmentRequestInfo] = useState('');
  const equipmentRequestIdempotencyKey = useRef(crypto.randomUUID());

  // Painel de admin: solicitações de equipamento pedidas por não-admins.
  const [equipmentRequests, setEquipmentRequests] = useState<EquipmentRequest[]>([]);
  const [equipmentListBusy, setEquipmentListBusy] = useState(false);
  const [equipmentListError, setEquipmentListError] = useState('');
  const [equipmentActionId, setEquipmentActionId] = useState('');

  const role: UserRole = profile?.role ?? 'viewer';
  // 'developer' tem acesso total, equivalente a 'admin', em tudo.
  const isAdmin = role === 'admin' || role === 'developer';
  const canManage = isAdmin || role === 'borrower';
  // Só Lucas Rickson aprova/rejeita solicitações (agendamento e
  // equipamento). Badu, Sérgio Vinicius e Sgt. Tiago Raiz continuam vendo
  // as listas.
  const isLeadApprover = isAdmin && userEmail.trim().toLowerCase() === LEAD_APPROVER_EMAIL;
  // A aba Conferência só aparece para admin. "Pegar Equipamento do
  // Estúdio" fica visível para todos, mas com o conteúdo bloqueado para
  // quem não é admin (popup + fluxo de solicitação com justificativa).
  const visibleTabs = useMemo(
    () => MAIN_TABS.filter((tab) => tab.id !== 'conference' || isAdmin),
    [isAdmin],
  );
  // Se o papel do usuário for rebaixado enquanto ele está na Conferência,
  // tira ele da aba que deixou de existir para o perfil dele.
  useEffect(() => {
    if (activeTab === 'conference' && !isAdmin) setActiveTab('agenda');
  }, [activeTab, isAdmin]);
  const userName = profile?.full_name || (userEmail ? userEmail.split('@')[0] : '');
  const isAuthed = Boolean(userId);
  const driveFolder = studio.driveFolder || DEFAULT_DRIVE_FOLDER;
  const checkedCount = useMemo(() => ALL_EQUIPMENT.filter((item) => studio.checks[item.id]).length, [studio.checks]);
  const currentMissingIds = useMemo(
    () => ALL_EQUIPMENT.filter((item) => !studio.checks[item.id] || item.alert).map((item) => item.id),
    [studio.checks],
  );
  const conferenceObservation = observationDraft.trim();
  const conferenceNeedsObservation = currentMissingIds.length > 0;
  const canSaveConference = canManage && (!conferenceNeedsObservation || Boolean(conferenceObservation));
  const outsideCount = Object.keys(studio.checkouts).length;
  const lastConference = studio.conferences[0];
  const pendingBookingCount = useMemo(
    () => bookingRequests.filter((req) => req.status === 'requested').length,
    [bookingRequests],
  );
  const pendingEquipmentRequestCount = useMemo(
    () => equipmentRequests.filter((req) => req.status === 'requested').length,
    [equipmentRequests],
  );
  const totalPendingCount = pendingBookingCount + pendingEquipmentRequestCount;
  const nextBooking = useMemo(
    () => bookingRequests
      .filter((request) => request.status === 'approved' && request.requested_date)
      .sort((a, b) => `${a.requested_date ?? ''}T${a.requested_time ?? ''}`.localeCompare(`${b.requested_date ?? ''}T${b.requested_time ?? ''}`))[0],
    [bookingRequests],
  );

  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const canShowInstall = !installed && !isStandalone && (Boolean(installPrompt) || isIos);

  useEffect(() => {
    writeLocalStudio(studio);
  }, [studio]);

  useEffect(() => {
    writeJson(PROFILE_KEY, profilePhotos);
  }, [profilePhotos]);

  // Sessao Supabase + carregamento do perfil
  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let active = true;
    const client = supabase;

    async function applySession(session: { user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } } | null) {
      if (!active) return;
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? '');
        // Login com Google preenche avatar_url/picture no user_metadata.
        setGoogleAvatarUrl(
          (session.user.user_metadata?.avatar_url as string) ??
          (session.user.user_metadata?.picture as string) ??
          ''
        );
        await loadProfile(session.user.id, session.user.email ?? '', (session.user.user_metadata?.full_name as string) ?? '');
      } else {
        setUserId('');
        setUserEmail('');
        setGoogleAvatarUrl('');
        setProfile(null);
      }
      setAuthReady(true);
    }

    client.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthed || !supabase) return;
    let active = true;

    loadStudio().then((sharedStudio) => {
      if (active) setStudio(sharedStudio);
    });

    return () => {
      active = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed || !supabase) return;
    const client = supabase;
    let reloadTimer: number | undefined;

    function scheduleReload() {
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        loadStudio().then(setStudio);
      }, 250);
    }

    const tables = [
      'studio_checklist',
      'studio_checkouts',
      'studio_observations',
      'studio_conferences',
      'studio_media',
    ];

    const channel = tables.reduce(
      (current, table) => current.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload),
      client.channel('studio-shared-data'),
    );

    channel.subscribe();

    return () => {
      window.clearTimeout(reloadTimer);
      client.removeChannel(channel);
    };
  }, [isAuthed]);

  async function loadProfile(id: string, email: string, metaName: string) {
    if (!supabase) return;
    const { data } = await supabase.from('profiles').select('id, full_name, role').eq('id', id).maybeSingle();
    if (data) {
      setProfile(data as Profile);
      return;
    }
    setProfile({ id, full_name: metaName || (email ? email.split('@')[0] : 'Usuario'), role: 'viewer' });
  }

  // Botao de instalar (PWA)
  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setInstallPrompt(null);
      return;
    }
    if (isIos) setShowIosHint(true);
  }

  function flash(message = 'Salvo') {
    setSavedNote(message);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedNote(''), 2200);
  }

  function persist(action: () => Promise<void>) {
    action().catch((error) => {
      console.warn('Falha ao sincronizar com Supabase.', error);
      flash('Salvo neste aparelho; sincronização pendente');
    });
  }

  function emailEvent(type: NotificationEvent['type'], payload: Record<string, unknown>): NotificationEvent {
    return {
      id: `${type}-${Date.now()}`,
      type,
      recipients: EMAIL_RECIPIENTS,
      payload,
      createdAt: Date.now(),
    };
  }

  function switchAuthMode(mode: 'login' | 'signup') {
    setAuthMode(mode);
    setAuthError('');
    setAuthInfo('');
    setConfirmationEmail('');
  }

  async function handleEmailAuth(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setAuthError('');
    setAuthInfo('');

    const email = formEmail.trim().toLowerCase();
    const password = formPass;
    if (!email || !password) {
      setAuthError('Preencha email e senha.');
      return;
    }

    setAuthBusy(true);
    try {
      if (authMode === 'signup') {
        const fullName = formName.trim();
        if (!fullName) {
          setAuthError('Informe seu nome.');
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
        });
        if (error) {
          setAuthError(friendlyAuthError(error.message));
          return;
        }
        if (!data.session) {
          setConfirmationEmail(email);
          setAuthInfo('Confira a caixa de entrada e o spam. Se o cadastro foi criado, você receberá um link para confirmar o email.');
          setAuthMode('login');
          setFormPass('');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setAuthError(friendlyAuthError(error.message));
          if (error.message.toLowerCase().includes('email not confirmed')) setConfirmationEmail(email);
          return;
        }
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendConfirmation() {
    if (!supabase || !confirmationEmail || resendBusy) return;
    setAuthError('');
    setAuthInfo('');
    setResendBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: confirmationEmail,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        setAuthError(friendlyAuthError(error.message));
        return;
      }
      setAuthInfo('Novo link solicitado. Confira a caixa de entrada e o spam.');
    } finally {
      setResendBusy(false);
    }
  }

  async function handleGoogle() {
    if (!supabase) return;
    setAuthError('');
    setAuthInfo('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setAuthError(friendlyAuthError(error.message));
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setUserId('');
    setUserEmail('');
    setProfile(null);
    setFormEmail('');
    setFormPass('');
    setFormName('');
    setShowLogin(false);
  }

  async function requestAccess() {
    if (!supabase || !isAuthed) return;
    setAccessRequestBusy(true);
    setAccessRequestInfo('');

    try {
      const endpoint = ACCESS_REQUEST_ENDPOINT || edgeFunctionUrl('request-access');
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: userName,
          email: userEmail,
          requestedRole: requestedRoleChoice,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Falha ao enviar pedido.');
      }

      setAccessRequestInfo('Pedido enviado aos admins por email.');
    } catch (error) {
      console.warn('Falha ao pedir liberacao.', error);
      setAccessRequestInfo('Não foi possível enviar o email. Verifique deploy/secrets da função.');
    } finally {
      setAccessRequestBusy(false);
    }
  }

  function toggleCheck(id: string, value: boolean) {
    if (!canManage) return;
    setStudio((current) => ({ ...current, checks: { ...current.checks, [id]: value } }));
    persist(() => setCheck(id, value, userId));
    flash();
  }

  // Gate do termo de equipamento (mesmo mecanismo do agendamento): só
  // libera "Confirmar retirada" depois de ler até o fim e assinar.
  const equipmentSignatureReady = equipmentTermAccepted && equipmentSignatureName.trim().length >= 3;
  // O popup de "Pegar" exige, além do termo e assinatura, a justificativa
  // preenchida e a selfie de validação facial capturada.
  const takeReady = equipmentSignatureReady && pendingJustification.trim().length > 0 && Boolean(takeFacePhoto);

  // Abre/fecha o popup de retirada, sempre partindo de um formulário limpo.
  function openTakeModal(id: string) {
    setPendingTake(id);
    setPendingQty(1);
    setPendingJustification('');
    setEquipmentTermAccepted(false);
    setEquipmentSignatureName('');
    setTakeFacePhoto('');
  }
  function closeTakeModal() {
    setPendingTake('');
    setPendingJustification('');
    setEquipmentTermAccepted(false);
    setEquipmentSignatureName('');
    setTakeFacePhoto('');
  }

  // Captura a selfie de validação facial (câmera frontal no celular via
  // capture="user"; no desktop cai no seletor de arquivos).
  async function handleFaceCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTakeFaceBusy(true);
    try {
      const photo = await resizePhoto(file);
      setTakeFacePhoto(photo);
    } catch {
      flash('Não foi possível processar a selfie de validação');
    } finally {
      setTakeFaceBusy(false);
    }
  }

  function takeItem(id: string, qty: number, justification: string) {
    if (!canManage || !isAuthed) return;
    const trimmedJustification = justification.trim();
    if (!trimmedJustification) {
      flash('Informe a justificativa antes de salvar');
      return;
    }
    if (!equipmentSignatureReady) {
      flash('Leia o termo de uso, aceite e assine antes de confirmar a retirada');
      return;
    }
    if (!takeFacePhoto) {
      flash('Faça a validação facial (selfie) antes de confirmar a retirada');
      return;
    }
    const ts = Date.now();
    const checkout: Checkout = { user: userName, userId, userEmail, ts, qty, justification: trimmedJustification, photo: takeFacePhoto };
    setStudio((current) => ({
      ...current,
      checkouts: { ...current.checkouts, [id]: checkout },
      notificationEvents: [
        emailEvent('equipment_checkout', {
          user: userName,
          email: userEmail,
          equipmentId: id,
          equipmentName: equipmentName(id),
          qty,
          justification: trimmedJustification,
          photo: takeFacePhoto,
          checkedOutAt: ts,
        }),
        ...(current.notificationEvents ?? []),
      ].slice(0, 80),
    }));
    persist(() => upsertCheckout(id, checkout));
    setPendingTake('');
    setPendingQty(1);
    setPendingJustification('');
    setEquipmentTermAccepted(false);
    setEquipmentSignatureName('');
    setTakeFacePhoto('');
    flash('Retirada registrada');
  }

  function returnItem(id: string) {
    const checkout = studio.checkouts[id];
    const isOwner = checkout && (checkout.userId ? checkout.userId === userId : checkout.user === userName);
    if (!canManage || !checkout || (!isAdmin && !isOwner)) return;
    setStudio((current) => {
      const next = { ...current.checkouts };
      delete next[id];
      return { ...current, checkouts: next };
    });
    persist(() => deleteCheckout(id));
    flash('Devolução registrada');
  }

  function resetChecklist() {
    if (!canManage) return;
    setStudio((current) => ({ ...current, checks: {} }));
    persist(() => resetChecks(ALL_EQUIPMENT.map((item) => item.id), userId));
    flash('Checklist zerado');
  }

  function saveConference() {
    if (!canManage || !isAuthed) return;
    const checkedIds = ALL_EQUIPMENT.filter((item) => studio.checks[item.id]).map((item) => item.id);
    const missingIds = currentMissingIds;
    const notes = conferenceObservation;

    if (missingIds.length && !notes) {
      flash('Informe uma observação para salvar com pendências');
      return;
    }

    const ts = Date.now();
    const record: ConferenceRecord = {
      id: newRecordId(),
      user: userName,
      ts,
      checkedIds,
      missingIds,
      notes,
    };
    const observationRecord: ObservationRecord | null = notes ? {
      id: newRecordId(),
      user: userName,
      ts,
      text: notes,
    } : null;

    setStudio((current) => ({
      ...current,
      conferences: [record, ...(current.conferences ?? [])].slice(0, 30),
      observations: observationRecord
        ? [observationRecord, ...(current.observations ?? [])].slice(0, 80)
        : current.observations,
      notificationEvents: [
        emailEvent('conference', {
          user: userName,
          email: userEmail,
          checkedIds,
          missingIds,
          missingNames: missingIds.map(equipmentName),
          notes: record.notes,
          savedAt: ts,
        }),
        ...(observationRecord ? [emailEvent('observation', {
          user: userName,
          email: userEmail,
          text: notes,
          savedAt: ts,
        })] : []),
        ...(current.notificationEvents ?? []),
      ].slice(0, 80),
    }));
    persist(() => addConference(record, userId));
    if (observationRecord) persist(() => addObservation(observationRecord, userId));
    if (observationRecord) setObservationDraft('');
    flash(missingIds.length ? 'Conferência salva com pendências' : 'Conferência salva sem faltas');
  }

  function saveObservation() {
    if (!canManage || !isAuthed) return;
    const text = observationDraft.trim();
    if (!text) {
      flash('Escreva uma observação antes de salvar');
      return;
    }

    const ts = Date.now();
    const record: ObservationRecord = {
      id: newRecordId(),
      user: userName,
      ts,
      text,
    };

    setStudio((current) => ({
      ...current,
      notes: '',
      observations: [record, ...(current.observations ?? [])].slice(0, 80),
      notificationEvents: [
        emailEvent('observation', {
          user: userName,
          email: userEmail,
          text,
          savedAt: ts,
        }),
        ...(current.notificationEvents ?? []),
      ].slice(0, 80),
    }));
    persist(() => addObservation(record, userId));
    setObservationDraft('');
    flash('Observação salva e aviso registrado');
  }

  async function handleProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !isAuthed) return;
    const photo = await resizeAvatar(file);
    setProfilePhotos((current) => ({ ...current, [userId]: photo }));
    flash('Foto de perfil salva');
    event.target.value = '';
  }

  async function uploadMediaPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canManage) return;

    setMediaBusy(true);
    try {
      const photo = await resizePhoto(file);
      const equipmentId = mediaEquipment;
      const title = mediaTitle.trim() || `${equipmentName(equipmentId)} - ${formatDateTime(Date.now())}`;
      const id = newRecordId();
      const ts = Date.now();

      let syncStatus: MediaItem['syncStatus'] = 'local';

      if (supabase) {
        const uploadEndpoint = UPLOAD_ENDPOINT || edgeFunctionUrl('upload-media');
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          const response = await fetch(uploadEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              equipmentId,
              equipmentName: equipmentName(equipmentId),
              title,
              photo,
              user: userName,
              email: userEmail,
              driveFolder,
            }),
          });
          syncStatus = response.ok ? 'sent' : 'error';
        } catch {
          syncStatus = 'error';
        }
      }

      const record: MediaItem = {
        id,
        equipmentId,
        title,
        photo,
        addedBy: userName,
        ts,
        syncStatus,
      };

      setStudio((current) => ({
        ...current,
        media: [record, ...current.media],
        notificationEvents: [
          emailEvent('media_photo', {
            user: userName,
            email: userEmail,
            equipmentId,
            equipmentName: equipmentName(equipmentId),
            title,
            photo,
            driveFolder,
            uploadedAt: ts,
          }),
          ...(current.notificationEvents ?? []),
        ].slice(0, 80),
      }));
      persist(() => addMedia(record, userId));

      setMediaTitle('');
      flash(syncStatus === 'sent' ? 'Foto enviada ao Drive e email' : 'Foto salva (envio ao Drive/email pendente de backend)');
    } catch {
      flash('Não foi possível processar a foto');
    } finally {
      setMediaBusy(false);
    }
  }

  function removeMedia(id: string) {
    if (!canManage) return;
    setStudio((current) => ({ ...current, media: current.media.filter((item) => item.id !== id) }));
    persist(() => deleteMedia(id));
    flash('Mídia removida');
  }

  // ==========================================
  // FUNÇÕES DA NOVA AGENDA
  // ==========================================

  // Gate liberado só quando o Termo foi lido até o fim (popup) e assinado.
  const signatureReady = termAccepted && signatureName.trim().length >= 3;
  const afterHoursMinDate = formatDateInputValue(new Date());
  const afterHoursMaxDate = formatDateInputValue(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  function resetBookingForm() {
    bookingIdempotencyKey.current = crypto.randomUUID();
    setRequesterData({ name: '', rg: '', cpf: '', email: userEmail, whatsapp: '', social: '', date: '', time: '' });
    setGuestsData([]);
    setAfterHoursMode(false);
    setProgramName('');
    setProgramFormat('recorded');
    setProductionNotes('');
    setYoutubeChannelUrl('');
    setYoutubePermissionAcknowledged(false);
    setBookingMaterialFiles([]);
    setBookingMaterialLinks('');
    setShowTermPopup(false);
    setTermAccepted(false);
    setSignatureName('');
  }

  // Mapa 'YYYY-MM-DD' -> dia retornado pela função studio-availability.
  const availabilityByDate = useMemo(() => {
    const map: Record<string, AvailabilityDay> = {};
    availabilityDays.forEach((day) => { map[day.date] = day; });
    return map;
  }, [availabilityDays]);

  // Grade do mês (domingo a sábado) para o popup de disponibilidade.
  function buildAvailabilityMonthGrid(cursor: Date): (string | null)[] {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    return cells;
  }

  async function loadAvailability() {
    if (!supabase) return;
    setAvailabilityLoading(true);
    setAvailabilityError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');
      const response = await fetch(edgeFunctionUrl('studio-availability'), {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Erro ao carregar disponibilidade da agenda.');
      setAvailabilityDays(result.days ?? []);
    } catch (error: any) {
      setAvailabilityError(error.message || 'Erro ao carregar disponibilidade da agenda.');
    } finally {
      setAvailabilityLoading(false);
    }
  }

  function openAvailabilityPopup() {
    const selectedDate = afterHoursMode ? '' : requesterData.date;
    if (afterHoursMode) {
      setAfterHoursMode(false);
      setRequesterData((current) => ({ ...current, date: '', time: '' }));
    }
    setShowAvailability(true);
    setAvailabilitySelectedDate(selectedDate);
    setAvailabilityMonthCursor(selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date());
    loadAvailability();
  }

  function pickAvailabilitySlot(date: string, time: string) {
    setAfterHoursMode(false);
    setRequesterData((current) => ({ ...current, date, time }));
    setShowAvailability(false);
  }

  function toggleAfterHoursMode() {
    setAfterHoursMode((current) => !current);
    setRequesterData((current) => ({ ...current, date: '', time: '' }));
  }

  function selectBookingMaterials(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!incoming.length) return;

    const next = [...bookingMaterialFiles, ...incoming];
    if (next.length > MAX_BOOKING_MATERIALS) {
      alert(`Envie no máximo ${MAX_BOOKING_MATERIALS} arquivos por solicitação.`);
      return;
    }

    const invalidType = next.find((file) =>
      !file.type.startsWith('image/')
      && !file.type.startsWith('video/')
      && file.type !== 'application/pdf',
    );
    if (invalidType) {
      alert(`O arquivo "${invalidType.name}" não é uma imagem, vídeo ou PDF permitido.`);
      return;
    }

    const oversized = next.find((file) => file.size > MAX_BOOKING_MATERIAL_BYTES);
    if (oversized) {
      alert(`O arquivo "${oversized.name}" excede 50 MB. Para arquivos maiores, use o campo de links.`);
      return;
    }

    const totalBytes = next.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_BOOKING_MATERIALS_TOTAL_BYTES) {
      alert('O conjunto de arquivos excede 100 MB. Envie os arquivos maiores por link.');
      return;
    }

    setBookingMaterialFiles(next);
  }

  async function uploadBookingMaterials(): Promise<BookingMaterialUpload[]> {
    if (!supabase || bookingMaterialFiles.length === 0) return [];

    const uploads: BookingMaterialUpload[] = [];
    for (let index = 0; index < bookingMaterialFiles.length; index += 1) {
      const file = bookingMaterialFiles[index];
      const fingerprint = await fileSha256(file);
      const path = [
        userId,
        bookingIdempotencyKey.current,
        `${String(index + 1).padStart(2, '0')}-${fingerprint.slice(0, 24)}-${safeStorageFileName(file.name)}`,
      ].join('/');
      const { error } = await supabase.storage
        .from(BOOKING_MATERIALS_BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error && !/already exists|duplicate|resource exists/i.test(error.message)) {
        throw new Error(`Não foi possível enviar "${file.name}": ${error.message}`);
      }
      uploads.push({ path, name: file.name.slice(0, 160), type: file.type, size: file.size });
    }
    return uploads;
  }

  const handleBookingSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (bookingBusy) return;

    if (!signatureReady) {
      alert('Antes de enviar: leia o Termo de Uso até o final, clique em Concordo e assine com seu nome completo.');
      return;
    }

    if (!requesterData.date || !requesterData.time) {
      alert(afterHoursMode
        ? 'Informe a data e o horário após as 17h antes de enviar.'
        : 'Escolha uma data e horário disponível na agenda antes de enviar.');
      return;
    }

    if (afterHoursMode && !/^(17:30|1[89]:(00|30)|2[0-3]:(00|30))$/.test(requesterData.time)) {
      alert('O horário excepcional deve estar entre 17h30 e 23h30, em intervalos de 30 minutos.');
      return;
    }

    if (afterHoursMode && (requesterData.date < afterHoursMinDate || requesterData.date > afterHoursMaxDate)) {
      alert('Escolha uma data entre hoje e os próximos 365 dias.');
      return;
    }

    if (programName.trim().length < 2) {
      alert('Informe o nome do programa ou podcast.');
      return;
    }

    const externalMaterialLinks = parseMaterialLinks(bookingMaterialLinks);
    if (externalMaterialLinks.length > 10) {
      alert('Informe no máximo 10 links de materiais.');
      return;
    }
    if (externalMaterialLinks.some((item) => {
      try {
        const url = new URL(item);
        return url.protocol !== 'https:';
      } catch {
        return true;
      }
    })) {
      alert('Use links completos e seguros, começando com https://.');
      return;
    }

    if (programFormat === 'live') {
      try {
        const channel = new URL(youtubeChannelUrl);
        if (channel.protocol !== 'https:' || !/(^|\.)youtube\.com$/i.test(channel.hostname)) throw new Error();
      } catch {
        alert('Informe um link completo do canal em youtube.com.');
        return;
      }
      if (!youtubePermissionAcknowledged) {
        alert('Confirme que o acesso ao canal será concedido por permissão do YouTube Studio, sem compartilhar senha.');
        return;
      }
    }

    setBookingBusy(true);
    let uploadedMaterials: BookingMaterialUpload[] = [];
    try {
      if (!supabase) throw new Error('Banco de dados não configurado.');

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        alert('Sua sessão expirou. Você precisa fazer login novamente.');
        return;
      }

      uploadedMaterials = await uploadBookingMaterials();

      // Metadados da assinatura digital (não-repúdio). O hash SHA-256 + IP
      // (x-forwarded-for) são carimbados no backend pela Edge Function.
      const signature = {
        fullName: signatureName.trim(),
        acceptedTerms: true,
        termDocument: 'Termo_de_Uso_Assego.pdf',
        termRead: true,
        signedByUserId: userId,
        signedByEmail: userEmail,
        signedAt: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      };

      // Timeout defensivo: se a função demorar demais para responder, o
      // botão não pode ficar preso em "Enviando..." para sempre.
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);

      let response: Response;
      try {
        response = await fetch(edgeFunctionUrl('submit-booking'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionData.session.access_token}`,
            'Idempotency-Key': bookingIdempotencyKey.current,
          },
          body: JSON.stringify({
            idempotencyKey: bookingIdempotencyKey.current,
            requester: { ...requesterData, email: userEmail },
            guests: guestsData,
            booking_details: {
              date: requesterData.date,
              time: requesterData.time,
              scheduleType: afterHoursMode ? 'after_hours' : 'regular',
              program: {
                name: programName.trim(),
                format: programFormat,
                productionNotes: productionNotes.trim(),
                youtubeChannelUrl: programFormat === 'live' ? youtubeChannelUrl.trim() : '',
                youtubeAccessMethod: programFormat === 'live' ? 'delegated_permission' : 'not_applicable',
              },
              materials: uploadedMaterials,
              materialLinks: externalMaterialLinks,
            },
            signature,
            approvers: BOOKING_APPROVERS,
          }),
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw new Error('O servidor demorou a responder. Sua solicitação pode ter sido registrada — aguarde e evite reenviar; confirme com a diretoria antes de tentar de novo.');
        }
        throw err;
      } finally {
        window.clearTimeout(timeout);
      }

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Erro no servidor. Tente novamente mais tarde.');
      }

      if (result.notification_status === 'pending_retry') {
        alert('Solicitação registrada e assinada. O aviso por email está aguardando uma nova tentativa automática.');
      } else if (result.notification_status === 'sent') {
        alert('Sucesso! Sua solicitação assinada foi enviada e o aviso por email foi processado.');
      } else {
        alert('Sucesso! Sua solicitação assinada foi enviada e está sob análise da diretoria.');
      }
      setShowBookingModal(false);
      resetBookingForm();
    } catch (error: any) {
      alert(`Falha no agendamento: ${error.message}`);
    } finally {
      setBookingBusy(false);
    }
  };

  const addGuest = () => {
    setGuestsData((current) => [...current, { name: '', rg: '', cpf: '', email: '', whatsapp: '', social: '' }]);
  };

  const removeGuest = (index: number) => {
    setGuestsData((current) => current.filter((_, i) => i !== index));
  };

  // Atualização imutável (corrige mutação direta do estado dos convidados).
  const updateGuest = (index: number, field: keyof (typeof guestsData)[number], value: string) => {
    setGuestsData((current) => current.map((guest, i) => (i === index ? { ...guest, [field]: value } : guest)));
  };

  // ==========================================
  // PAINEL DE ADMIN: solicitações de agendamento
  // ==========================================
  const loadBookingRequests = async () => {
    if (!supabase) return;
    setBookingListBusy(true);
    setBookingListError('');
    try {
      setBookingRequests(await listBookingRequests());
    } catch (error: any) {
      setBookingListError(error?.message || 'Não foi possível carregar as solicitações.');
    } finally {
      setBookingListBusy(false);
    }
  };

  async function decideBooking(id: string, status: BookingStatus) {
    // Reforço no client: só o aprovador único decide. O RLS também bloqueia
    // no servidor (booking_req_update_admin usa current_user_is_lead_approver).
    if (!isLeadApprover) return;
    setBookingActionId(id);
    // Atualização otimista; se falhar, recarrega do servidor.
    setBookingRequests((current) => current.map((req) => (req.id === id ? { ...req, status } : req)));
    try {
      await updateBookingStatus(id, status);
      flash(status === 'approved' ? 'Solicitação aprovada' : 'Solicitação rejeitada');
    } catch (error: any) {
      flash(error?.message || 'Falha ao atualizar solicitação');
      loadBookingRequests();
    } finally {
      setBookingActionId('');
    }
  }

  // Carrega e atualiza as solicitações enquanto um aprovador oficial esta logado.
  useEffect(() => {
    if (!isAdmin || !supabaseConfigured) {
      setBookingRequests([]);
      return;
    }

    loadBookingRequests();
    const timer = window.setInterval(loadBookingRequests, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, supabaseConfigured]);

  // ==========================================
  // PAINEL DE ADMIN: solicitações de equipamento (não-admin pedindo acesso)
  // ==========================================
  const loadEquipmentRequests = async () => {
    if (!supabase) return;
    setEquipmentListBusy(true);
    setEquipmentListError('');
    try {
      setEquipmentRequests(await listEquipmentRequests());
    } catch (error: any) {
      setEquipmentListError(error?.message || 'Não foi possível carregar os pedidos de equipamento.');
    } finally {
      setEquipmentListBusy(false);
    }
  };

  async function decideEquipmentRequest(id: string, status: EquipmentRequestStatus) {
    if (!isLeadApprover) return;
    setEquipmentActionId(id);
    setEquipmentRequests((current) => current.map((req) => (req.id === id ? { ...req, status } : req)));
    try {
      await updateEquipmentRequestStatus(id, status);
      flash(status === 'approved' ? 'Pedido de equipamento aprovado' : 'Pedido de equipamento rejeitado');
    } catch (error: any) {
      flash(error?.message || 'Falha ao atualizar pedido de equipamento');
      loadEquipmentRequests();
    } finally {
      setEquipmentActionId('');
    }
  }

  useEffect(() => {
    if (!isAdmin || !supabaseConfigured) {
      setEquipmentRequests([]);
      return;
    }

    loadEquipmentRequests();
    const timer = window.setInterval(loadEquipmentRequests, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, supabaseConfigured]);

  // Usuário sem admin/borrower pedindo equipamento mesmo assim, com
  // justificativa. Dispara email aos 3 admins via edge function.
  function openEquipmentRequestForm(equipmentId: string) {
    equipmentRequestIdempotencyKey.current = crypto.randomUUID();
    setEquipmentRequestTarget(equipmentId);
    setEquipmentRequestJustification('');
    setEquipmentRequestInfo('');
    setEquipmentTermAccepted(false);
    setEquipmentSignatureName('');
    setShowEquipmentAccessGate(false);
    setShowEquipmentRequestForm(true);
  }

  async function submitEquipmentRequest(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !isAuthed || equipmentRequestBusy) return;
    const justification = equipmentRequestJustification.trim();
    if (!justification) {
      setEquipmentRequestInfo('Escreva por que você precisa do equipamento.');
      return;
    }

    setEquipmentRequestBusy(true);
    setEquipmentRequestInfo('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sua sessão expirou. Faça login novamente.');

      const response = await fetch(edgeFunctionUrl('request-equipment'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': equipmentRequestIdempotencyKey.current,
        },
        body: JSON.stringify({
          idempotencyKey: equipmentRequestIdempotencyKey.current,
          equipmentId: equipmentRequestTarget,
          equipmentName: equipmentName(equipmentRequestTarget),
          justification,
          requesterName: userName,
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Erro no servidor. Tente novamente mais tarde.');
      }

      setEquipmentRequestInfo('Pedido enviado! Os admins foram avisados por email.');
      window.setTimeout(() => {
        setShowEquipmentRequestForm(false);
        setEquipmentRequestTarget('');
        setEquipmentRequestJustification('');
        setEquipmentTermAccepted(false);
        setEquipmentSignatureName('');
      }, 1600);
    } catch (error: any) {
      setEquipmentRequestInfo(error?.message || 'Não foi possível enviar o pedido.');
    } finally {
      setEquipmentRequestBusy(false);
    }
  }


  const installFab = canShowInstall ? (
    <button className="install-fab" type="button" onClick={handleInstallClick}>
      <Download className="install-fab-icon" size={18} aria-hidden="true" />
      Instalar app
    </button>
  ) : null;

  const iosModal = showIosHint ? (
    <div className="ios-hint" role="dialog" aria-modal="true" onClick={() => setShowIosHint(false)}>
      <div className="ios-hint-card" onClick={(event) => event.stopPropagation()}>
        <h3>Instalar no iPhone/iPad</h3>
        <ol>
          <li>Toque no botão Compartilhar do Safari.</li>
          <li>Escolha "Adicionar à Tela de Início".</li>
          <li>Confirme em "Adicionar".</li>
        </ol>
        <button className="btn" type="button" onClick={() => setShowIosHint(false)}>Entendi</button>
      </div>
    </div>
  ) : null;

  if (!authReady) {
    return (
      <main className="login-screen">
        <div className="login-card"><p className="eyebrow">Carregando...</p></div>
        {installFab}
        {iosModal}
      </main>
    );
  }

  if (!isAuthed && !showLogin) {
    return <LandingPage onLogin={openLogin} />;
  }

  if (!isAuthed) {
    return (
      <main className="login-screen">
        <form className="login-card" onSubmit={handleEmailAuth}>
          <div className="logo-chip"><img src="/logo.png" alt="ASSEGO PM & BM" /></div>
          <p className="eyebrow">ASSEGO PM &amp; BM</p>
          <h1>Assego Studio</h1>

          <div className="auth-tabs">
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => switchAuthMode('login')}>Entrar</button>
            <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => switchAuthMode('signup')}>Cadastrar-se</button>
          </div>

          {!supabaseConfigured && (
            <div className="login-error">Configuração do Supabase pendente. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.</div>
          )}

          {authMode === 'signup' && (
            <>
              <label htmlFor="formName">Nome</label>
              <input id="formName" value={formName} onChange={(event) => setFormName(event.target.value)} autoComplete="name" disabled={!supabaseConfigured} />
            </>
          )}

          <label htmlFor="formEmail">Email</label>
          <input id="formEmail" type="email" value={formEmail} onChange={(event) => setFormEmail(event.target.value)} autoComplete="email" disabled={!supabaseConfigured} />

          <label htmlFor="formPass">Senha</label>
          <input id="formPass" type="password" value={formPass} onChange={(event) => setFormPass(event.target.value)} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} disabled={!supabaseConfigured} />

          {authError && <div className="login-error">{authError}</div>}
          {authInfo && <div className="login-info">{authInfo}</div>}

          {confirmationEmail && (
            <button
              className="btn ghost"
              type="button"
              onClick={resendConfirmation}
              disabled={resendBusy || !supabaseConfigured}
            >
              {resendBusy ? 'Reenviando...' : 'Reenviar email de confirmação'}
            </button>
          )}

          <button className="btn btn-yellow" type="submit" disabled={authBusy || !supabaseConfigured}>
            {authBusy ? 'Aguarde...' : authMode === 'signup' ? 'Criar conta' : 'Entrar'}
          </button>

          <div className="auth-divider"><span>ou</span></div>

          <button className="btn google-btn" type="button" onClick={handleGoogle} disabled={!supabaseConfigured}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8 20-20 0-1.3-.1-2.3-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 34.9 26.7 36 24 36c-5.3 0-9.7-2.6-11.3-6.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.1-2.2 3.9-4 5.2l6.2 5.3C42.3 35.6 44 30.3 44 24c0-1.3-.1-2.3-.4-3.5z" />
            </svg>
            Entrar com Google
          </button>

          <p className="login-foot">Novos cadastros entram como visualização até um admin liberar retirada.</p>
        </form>
        {installFab}
        {iosModal}
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="assego-marquee" role="marquee" aria-label="Aviso do estúdio">
        <div className="assego-marquee__track">
          <span className="assego-marquee__item">{PODCAST_NOTICE}</span>
          <span className="assego-marquee__item">{PODCAST_NOTICE}</span>
          <span className="assego-marquee__item">{PODCAST_NOTICE}</span>
          <span className="assego-marquee__item">{PODCAST_NOTICE}</span>
        </div>
      </div>

      <header className="topbar brand-hero">
        <div className="brand-top">
          <button
            type="button"
            className="brand-id brand-id--home"
            onClick={() => setActiveTab('agenda')}
            aria-label="Ir para a Agenda (início)"
          >
            <div className="logo-chip"><img src="/logo.png" alt="ASSEGO PM & BM" /></div>
            <div className="brand-copy">
              <p className="eyebrow">ASSEGO PM &amp; BM</p>
              <h1>Assego Studio</h1>
            </div>
          </button>
          <div className="session">
            {isAdmin && (
              <div className="notif-wrap">
                <button
                  type="button"
                  className="notif-bell"
                  aria-expanded={showNotifications}
                  aria-controls="notifications-panel"
                  aria-label="Notificações"
                  onClick={() => setShowNotifications((current) => !current)}
                >
                  <Bell size={18} strokeWidth={2.2} aria-hidden="true" />
                  {totalPendingCount > 0 && <span className="notif-bell__badge">{totalPendingCount}</span>}
                </button>

                {showNotifications && (
                  <>
                    <div className="account-menu-backdrop" onClick={() => setShowNotifications(false)} />
                    <div id="notifications-panel" className="notif-panel" role="menu">
                      <div className="notif-panel__head">
                        <div>
                          <strong>Notificações</strong>
                          <span>Solicitações de agendamento — visível para Lucas, Badu, Sérgio Vinicius e Sgt. Tiago Raiz.</span>
                        </div>
                        <button className="btn ghost" type="button" onClick={loadBookingRequests} disabled={bookingListBusy}>
                          {bookingListBusy ? 'Atualizando…' : 'Atualizar'}
                        </button>
                      </div>

                      {bookingListError && <p className="out-count">{bookingListError}</p>}
                      {!bookingListBusy && !bookingListError && bookingRequests.length === 0 && (
                        <p className="guest-empty">Nenhuma solicitação por enquanto.</p>
                      )}

                      <div className="notif-list">
                        {bookingRequests.map((req) => {
                          const expanded = expandedRequestId === req.id;
                          return (
                            <div className={`booking-item booking-item--${req.status}`} key={req.id}>
                              <div className="booking-item__head">
                                <div className="booking-item__who">
                                  <strong>{req.requester_name}</strong>
                                  <span className="booking-item__when">{formatBookingWhen(req.requested_date, req.requested_time)}</span>
                                </div>
                                <div className="booking-item__badges">
                                  {req.requested_time && req.requested_time > '17:00' && (
                                    <span className="booking-badge booking-badge--after-hours">Após 17h</span>
                                  )}
                                  {req.status === 'requested' && <span className="booking-badge booking-badge--new">Nova</span>}
                                  <span className={`booking-badge booking-badge--${req.status}`}>{BOOKING_STATUS_LABEL[req.status]}</span>
                                </div>
                              </div>

                              <div className="booking-item__contact">
                                {req.requester_whatsapp && <span><MessageCircle size={14} aria-hidden="true" />{req.requester_whatsapp}</span>}
                                {req.requester_email && <span><Mail size={14} aria-hidden="true" />{req.requester_email}</span>}
                              </div>

                              <button
                                type="button"
                                className="btn ghost btn-block booking-item__expand"
                                onClick={() => setExpandedRequestId(expanded ? '' : req.id)}
                              >
                                {expanded ? <>Recolher <ChevronUp size={16} aria-hidden="true" /></> : <>Expandir <ChevronDown size={16} aria-hidden="true" /></>}
                              </button>

                              {expanded && (
                                <>
                                  <div className="booking-item__section">
                                    <h3>Dados completos do solicitante</h3>
                                    <div className="booking-field-grid">
                                      <span><b>Nome</b>{req.requester_name || '-'}</span>
                                      <span><b>WhatsApp</b>{req.requester_whatsapp || '-'}</span>
                                      <span><b>Email</b>{req.requester_email || '-'}</span>
                                      <span><b>RG</b>{req.requester_rg || '-'}</span>
                                      <span><b>CPF</b>{req.requester_cpf || '-'}</span>
                                      <span><b>Rede social</b>{req.requester_social || '-'}</span>
                                      <span><b>Tipo de horário</b>{req.requested_time && req.requested_time > '17:00' ? 'Excepcional — após as 17h' : 'Horário regular'}</span>
                                    </div>
                                  </div>

                                  {req.participants.length > 0 && (
                                    <div className="booking-item__section">
                                      <h3>Dados completos dos convidados ({req.participants.length})</h3>
                                      <div className="booking-guests-list">
                                        {req.participants.map((p) => (
                                          <div className="booking-guest" key={p.id}>
                                            <strong>{p.full_name}</strong>
                                            <div className="booking-field-grid">
                                              <span><b>WhatsApp</b>{p.whatsapp || '-'}</span>
                                              <span><b>Email</b>{p.email || '-'}</span>
                                              <span><b>RG</b>{p.rg || '-'}</span>
                                              <span><b>CPF</b>{p.cpf || '-'}</span>
                                              <span><b>Rede social</b>{p.social || '-'}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="booking-item__actions">
                                    {isLeadApprover ? (
                                      req.status === 'requested' ? (
                                        <>
                                          <button className="btn btn-yellow" type="button" disabled={bookingActionId === req.id} onClick={() => decideBooking(req.id, 'approved')}>Aprovar</button>
                                          <button className="btn btn-outline" type="button" disabled={bookingActionId === req.id} onClick={() => decideBooking(req.id, 'rejected')}>Rejeitar</button>
                                        </>
                                      ) : (
                                        <button className="btn ghost" type="button" disabled={bookingActionId === req.id} onClick={() => decideBooking(req.id, 'requested')}>Reabrir</button>
                                      )
                                    ) : (
                                      <span className="approver-note">Somente Lucas Rickson pode aprovar ou rejeitar.</span>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="notif-panel__head notif-panel__head--secondary">
                        <div>
                          <strong>Pedidos de equipamento</strong>
                          <span>Solicitações feitas por quem não é admin, com justificativa.</span>
                        </div>
                        <button className="btn ghost" type="button" onClick={loadEquipmentRequests} disabled={equipmentListBusy}>
                          {equipmentListBusy ? 'Atualizando…' : 'Atualizar'}
                        </button>
                      </div>

                      {equipmentListError && <p className="out-count">{equipmentListError}</p>}
                      {!equipmentListBusy && !equipmentListError && equipmentRequests.length === 0 && (
                        <p className="guest-empty">Nenhum pedido de equipamento por enquanto.</p>
                      )}

                      <div className="notif-list">
                        {equipmentRequests.map((req) => {
                          const expanded = expandedEquipmentRequestId === req.id;
                          return (
                            <div className={`booking-item booking-item--${req.status}`} key={req.id}>
                              <div className="booking-item__head">
                                <div className="booking-item__who">
                                  <strong>{req.requester_name}</strong>
                                  <span className="booking-item__when">{req.equipment_name}</span>
                                </div>
                                <div className="booking-item__badges">
                                  {req.status === 'requested' && <span className="booking-badge booking-badge--new">Nova</span>}
                                  <span className={`booking-badge booking-badge--${req.status}`}>
                                    {req.status === 'requested' ? 'Pendente' : req.status === 'approved' ? 'Aprovada' : 'Rejeitada'}
                                  </span>
                                </div>
                              </div>

                              <div className="booking-item__contact">
                                {req.requester_email && <span><Mail size={14} aria-hidden="true" />{req.requester_email}</span>}
                              </div>

                              <button
                                type="button"
                                className="btn ghost btn-block booking-item__expand"
                                onClick={() => setExpandedEquipmentRequestId(expanded ? '' : req.id)}
                              >
                                {expanded ? <>Recolher <ChevronUp size={16} aria-hidden="true" /></> : <>Expandir <ChevronDown size={16} aria-hidden="true" /></>}
                              </button>

                              {expanded && (
                                <>
                                  <div className="booking-item__section">
                                    <h3>Justificativa</h3>
                                    <p>{req.justification}</p>
                                  </div>

                                  <div className="booking-item__actions">
                                    {isLeadApprover ? (
                                      req.status === 'requested' ? (
                                        <>
                                          <button className="btn btn-yellow" type="button" disabled={equipmentActionId === req.id} onClick={() => decideEquipmentRequest(req.id, 'approved')}>Aprovar</button>
                                          <button className="btn btn-outline" type="button" disabled={equipmentActionId === req.id} onClick={() => decideEquipmentRequest(req.id, 'rejected')}>Rejeitar</button>
                                        </>
                                      ) : (
                                        <button className="btn ghost" type="button" disabled={equipmentActionId === req.id} onClick={() => decideEquipmentRequest(req.id, 'requested')}>Reabrir</button>
                                      )
                                    ) : (
                                      <span className="approver-note">Somente Lucas Rickson pode aprovar ou rejeitar.</span>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              className="avatar avatar-btn"
              aria-label="Abrir menu da conta"
              aria-expanded={showAccountMenu}
              aria-controls="account-menu"
              title={`${userName} · ${ROLE_LABEL[role]}`}
              onClick={() => setShowAccountMenu((current) => !current)}
            >
              {profilePhotos[userId] || googleAvatarUrl ? (
                <img src={profilePhotos[userId] || googleAvatarUrl} alt="" />
              ) : initials(userName)}
            </button>

            {showAccountMenu && (
              <>
                <div className="account-menu-backdrop" onClick={() => setShowAccountMenu(false)} />
                <div id="account-menu" className="account-menu" role="menu">
                  <div className="account-menu__head">
                    <div className="avatar avatar--lg">
                      {profilePhotos[userId] || googleAvatarUrl ? (
                        <img src={profilePhotos[userId] || googleAvatarUrl} alt="" />
                      ) : initials(userName)}
                    </div>
                    <div className="account-menu__id">
                      <strong>{userName}</strong>
                      <span>{userEmail}</span>
                    </div>
                  </div>
                  <div className="account-menu__divider" />
                  <button
                    type="button"
                    className="account-menu__item"
                    onClick={() => {
                      setShowAccountMenu(false);
                      profilePhotoInputRef.current?.click();
                    }}
                  >
                    <Camera aria-hidden="true" size={16} strokeWidth={2.2} />
                    <span>
                      Perfil
                      <small>Alterar foto de perfil</small>
                    </span>
                  </button>
                  <div className="account-menu__divider" />
                  <button
                    type="button"
                    className="account-menu__item account-menu__item--danger"
                    onClick={() => {
                      setShowAccountMenu(false);
                      logout();
                    }}
                  >
                    <LogOut aria-hidden="true" size={16} strokeWidth={2.2} />
                    <span>Sair</span>
                  </button>
                </div>
              </>
            )}

            <input
              ref={profilePhotoInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleProfilePhoto}
            />
          </div>
        </div>

        {/* Resumo operacional: só para admin/developer e apenas na aba Conferência. */}
        {isAdmin && activeTab === 'conference' && (
          <div className="brand-metrics" aria-label="Resumo do estúdio">
            <span><strong>{ALL_EQUIPMENT.length}</strong> itens</span>
            <span><strong>{checkedCount}</strong> conferidos</span>
            <span className={outsideCount > 0 ? 'brand-metrics__warn' : ''}><strong>{outsideCount}</strong> fora</span>
            <span className="brand-metrics__accent"><strong>{ROLE_LABEL[role]}</strong> acesso</span>
          </div>
        )}
      </header>

      {role === 'viewer' && (
        <div className="viewer-banner">
          <span>
            Seu acesso está como visualização. Um admin precisa liberar seu perfil para retirar equipamentos e salvar conferências.
          </span>
          <label className="viewer-banner__role-choice">
            Pedir acesso de
            <select
              value={requestedRoleChoice}
              onChange={(event) => setRequestedRoleChoice(event.target.value === 'admin' ? 'admin' : 'borrower')}
              disabled={accessRequestBusy}
            >
              <option value="borrower">Retirada de equipamento</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="btn small" type="button" onClick={requestAccess} disabled={accessRequestBusy}>
            {accessRequestBusy ? 'Enviando...' : 'Pedir liberação'}
          </button>
          {accessRequestInfo && <strong>{accessRequestInfo}</strong>}
        </div>
      )}

      <section className="tab-panels">
        
        {/* ============================== */}
        {/* NOVA ABA: AGENDA               */}
        {/* ============================== */}
        <div className={`tab-panel ${activeTab === 'agenda' ? 'active' : ''}`}>
          <div className="dashboard-shell">
            <article className="dashboard-hero">
              <div className="dashboard-hero__copy">
                <p className="eyebrow">Painel operacional</p>
                <h2>O Estúdio da ASSEGO em um única visão</h2>
                <p>Organize reservas, gravações, conferências e equipamentos com segurança.</p>
              </div>
              <div className="dashboard-hero__actions">
                <button className="btn btn-yellow" type="button" onClick={() => setShowBookingModal(true)}>
                  <CalendarDays size={18} aria-hidden="true" />
                  {isAdmin ? 'Reservar estúdio' : 'Solicitar agendamento'}
                </button>
                <span><Activity size={15} aria-hidden="true" /> Sistema operacional</span>
              </div>
            </article>

            <div className="dashboard-grid">
              <article className="dashboard-card dashboard-card--schedule">
                <div className="dashboard-card__head">
                  <span className="dashboard-card__icon"><Clock3 size={19} aria-hidden="true" /></span>
                  <span className="status-chip status-chip--online">Agenda</span>
                </div>
                <div className="dashboard-card__body">
                  <p className="dashboard-card__label">Próxima gravação</p>
                  {nextBooking ? (
                    <>
                      <strong>{formatBookingWhen(nextBooking.requested_date, nextBooking.requested_time)}</strong>
                      <span>{nextBooking.requester_name}</span>
                    </>
                  ) : (
                    <>
                      <strong>Agenda disponível</strong>
                      <span>Nenhuma gravação aprovada no momento.</span>
                    </>
                  )}
                </div>
                <button type="button" className="dashboard-link" onClick={() => setShowBookingModal(true)}>
                  Consultar horários <ArrowRight size={16} aria-hidden="true" />
                </button>
              </article>

              <article className="dashboard-card dashboard-card--status">
                <div className="dashboard-card__head">
                  <span className="dashboard-card__icon"><ShieldCheck size={19} aria-hidden="true" /></span>
                  <span className="status-chip">Operação</span>
                </div>
                <div className="studio-health">
                  <strong>{outsideCount === 0 ? 'Estúdio pronto' : 'Atenção necessária'}</strong>
                  <span>{ALL_EQUIPMENT.length - outsideCount} de {ALL_EQUIPMENT.length} itens no estúdio</span>
                  <div className="studio-health__bar"><span style={{ width: `${((ALL_EQUIPMENT.length - outsideCount) / ALL_EQUIPMENT.length) * 100}%` }} /></div>
                </div>
                <div className="dashboard-mini-stats">
                  <span><b>{checkedCount}</b> conferidos</span>
                  <span><b>{totalPendingCount}</b> pendências</span>
                </div>
              </article>

              <article className="dashboard-card dashboard-card--actions">
                <div className="dashboard-card__head">
                  <div>
                    <p className="dashboard-card__label">Acesso rápido</p>
                    <strong>O que você quer fazer?</strong>
                  </div>
                </div>
                <div className="quick-actions">
                  <button type="button" onClick={() => setShowBookingModal(true)}><CalendarDays size={20} aria-hidden="true" /><span>Reservar<small>Escolher horário</small></span></button>
                  <button type="button" onClick={() => setActiveTab('camera')}><Radio size={20} aria-hidden="true" /><span>Ao Vivo<small>Ver transmissão</small></span></button>
                  {isAdmin && <button type="button" onClick={() => setActiveTab('conference')}><ClipboardCheck size={20} aria-hidden="true" /><span>Conferir<small>Validar estúdio</small></span></button>}
                  <button type="button" onClick={() => setActiveTab('custody')}><Package size={20} aria-hidden="true" /><span>Equipamentos<small>Retirada e cautela</small></span></button>
                </div>
              </article>
            </div>
          </div>
          <article className="card premium-card">
            <div className="agenda-head">
              <h2>Assego Studio</h2>
              {isAdmin ? (
                <button className="btn btn-yellow" type="button" onClick={() => setShowBookingModal(true)}>Reservar Estúdio</button>
              ) : (
                <button className="btn btn-primary" type="button" onClick={() => setShowBookingModal(true)}>Solicitar Agendamento</button>
              )}
            </div>
          </article>

          {/* Painel de solicitações de agendamento movido para o popup de
              notificações no header (ícone de sino ao lado do avatar).
              Ver .notif-panel mais abaixo, dentro de <header className="brand-hero">. */}
        </div>


        {/* ============================== */}
        {/* ABA: AO VIVO                  */}
        {/* ============================== */}
        <div className={`tab-panel ${activeTab === 'camera' ? 'active' : ''}`}>
          <article className="card live-empty-card">
            <div className="live-empty-card__icon" aria-hidden="true"><Video size={28} strokeWidth={1.8} /></div>
            <p className="eyebrow">Ao vivo</p>
            <h2>Nenhuma transmissão configurada</h2>
            <p>Quando uma transmissão oficial estiver disponível, ela aparecerá aqui.</p>
          </article>
        </div>


        {/* ============================== */}
        {/* ABA ANTIGA: CONFERÊNCIA        */}
        {/* ============================== */}
        <div className={`tab-panel ${activeTab === 'conference' ? 'active' : ''}`}>
        <article className="card">
          <div className="card-head">
            <h2>Conferência de equipamentos</h2>
            <div className="head-actions">
              <button className="btn ghost" type="button" onClick={resetChecklist} disabled={!canManage}>Zerar</button>
              <button className="btn" type="button" onClick={saveConference} disabled={!canSaveConference}>Salvar conferência</button>
            </div>
          </div>
          <div className="ready">
            <span>{checkedCount} / {ALL_EQUIPMENT.length} conferidos</span>
            <div className="meter"><div style={{ width: `${(checkedCount / ALL_EQUIPMENT.length) * 100}%` }} /></div>
            {outsideCount > 0 && <strong className="out-count">{outsideCount} equipamento(s) fora do estúdio</strong>}
            {conferenceNeedsObservation && !conferenceObservation && (
              <strong className="out-count">Há pendências. Escreva uma observação para liberar a conferência.</strong>
            )}
            <div className="conference-status">
              {lastConference ? (
                <>
                  <strong>Última conferência: {lastConference.user} em {formatDateTime(lastConference.ts)}</strong>
                  <span>
                    {lastConference.missingIds.length
                      ? `Pendências: ${lastConference.missingIds.map(equipmentName).join(', ')}`
                      : 'Sem equipamentos faltando.'}
                  </span>
                </>
              ) : (
                <>
                  <strong>Conferência diária ainda não salva.</strong>
                  <span>Marque os itens presentes e salve para registrar seu nome nesta página.</span>
                </>
              )}
            </div>
          </div>
          <div className="equipment-list">
            {EQUIPMENT.map((group) => (
              <div key={group.cat}>
                <h3>{group.cat}</h3>
                {group.items.map((item) => {
                  const checkout = studio.checkouts[item.id];
                  return (
                    <div className={`equipment-item ${checkout ? 'taken' : ''}`} key={item.id}>
                      <div className="equipment-main">
                        <label className="check-row">
                          <input
                            type="checkbox"
                            checked={Boolean(studio.checks[item.id])}
                            disabled={!canManage}
                            onChange={(event) => toggleCheck(item.id, event.target.checked)}
                          />
                          <span className="check-box" aria-hidden="true" />
                          <span className="equipment-name">{item.name}</span>
                        </label>
                        <div className="equipment-meta">
                          <span className="qty">{item.qty} unidades</span>
                          {item.alert && <span className="flag">{item.alert}</span>}
                        </div>
                      </div>
                      {checkout ? (
                        <div className="borrow borrow--readonly">
                          <div className="borrow-copy">
                            <strong>Retirado por {checkout.user}</strong>
                            <span>{checkout.qty} unidade(s) - {borrowDueText(checkout)}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="equipment-status-ok">Disponível</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="conference-hint">
            Retirada e devolução de equipamento agora ficam na aba "Pegar Equipamento do Estúdio".
          </p>
          <div className="notes">
            <label htmlFor="observationText">Observações</label>
            <div className="note-compose">
              <textarea
                id="observationText"
                value={observationDraft}
                disabled={!canManage}
                onChange={(event) => setObservationDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    saveObservation();
                  }
                }}
                placeholder="Digite a observação e aperte Enter para salvar"
              />
              <button className="btn" type="button" onClick={saveObservation} disabled={!canManage || !observationDraft.trim()}>Salvar</button>
            </div>
            <div className="observation-history">
              <h3>Histórico de observações</h3>
              {(studio.observations ?? []).length === 0 ? (
                <p className="empty">Nenhuma observação registrada ainda.</p>
              ) : (studio.observations ?? []).map((observation) => (
                <article className="observation-item" key={observation.id}>
                  <div>
                    <strong>{observation.user}</strong>
                    <time>{formatDateTime(observation.ts)}</time>
                  </div>
                  <p>{observation.text}</p>
                </article>
              ))}
            </div>
          </div>
        </article>

        <article className="card media-card">
          <div className="card-head">
            <h2>Documentação em fotos</h2>
          </div>
          <div className="drive-panel">
            <div className="drive-fixed">
              <span>Destino das fotos</span>
              <strong>Google Drive do Lucas + aviso por email</strong>
            </div>
            <label>
              Equipamento
              <select value={mediaEquipment} disabled={!canManage} onChange={(event) => setMediaEquipment(event.target.value)}>
                <option value="geral">Geral do estúdio</option>
                {ALL_EQUIPMENT.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Nome (opcional)
              <input value={mediaTitle} disabled={!canManage} onChange={(event) => setMediaTitle(event.target.value)} placeholder="Ex: câmera com risco na lente" />
            </label>
            <label className="upload-btn">
              {mediaBusy ? 'Enviando...' : 'Enviar foto'}
              <input type="file" accept="image/*" capture="environment" disabled={!canManage || mediaBusy} onChange={uploadMediaPhoto} />
            </label>
            {!canManage && <span className="upload-locked-note">Envio de fotos disponível só para admin/borrower.</span>}
          </div>
          <div className="media-list">
            {studio.media.length === 0 ? (
              <p className="empty">Nenhuma foto enviada ainda.</p>
            ) : studio.media.map((item) => (
              <article className="media-item" key={item.id}>
                <div>
                  <small>{equipmentName(item.equipmentId)}</small>
                  <h3>{item.title}</h3>
                </div>
                {item.photo ? (
                  <img className="media-photo" src={item.photo} alt={item.title} loading="lazy" />
                ) : item.url ? (
                  <a className="btn small" href={item.url} target="_blank" rel="noreferrer">Abrir link</a>
                ) : null}
                <div className="media-meta">
                  <span>{item.addedBy} - {formatDateTime(item.ts)}</span>
                  {item.syncStatus === 'sent' && <span className="sync ok">Enviado ao Drive/email</span>}
                  {item.syncStatus === 'error' && <span className="sync err">Falha no envio ao Drive/email</span>}
                  {(!item.syncStatus || item.syncStatus === 'local') && <span className="sync pending">Aguardando backend</span>}
                </div>
                <div className="media-actions">
                  <button className="btn small ghost" type="button" onClick={() => removeMedia(item.id)} disabled={!canManage}>Remover</button>
                </div>
              </article>
            ))}
          </div>
        </article>
        </div>
      </section>

      {/* ============================== */}
      {/* ABA: PEGAR EQUIPAMENTO DO ESTÚDIO */}
      {/* ============================== */}
      <section className={`tab-panel ${activeTab === 'custody' ? 'active' : ''}`}>
      <article className="card">
        <div className="card-head">
          <h2>Pegar Equipamento do Estúdio</h2>
        </div>

        {!isAdmin ? (
          <div className="equipment-locked">
            <p><strong>Acesso aos equipamentos é apenas para admins.</strong></p>
            <p>Se você realmente precisa de um equipamento, explique o motivo e os admins vão avaliar.</p>
            <button className="btn btn-yellow" type="button" onClick={() => setShowEquipmentAccessGate(true)}>
              Solicitar mesmo assim
            </button>
          </div>
        ) : (
          <div className="equipment-list equipment-list--custody">
            {EQUIPMENT.map((group) => {
              const expanded = Boolean(expandedCats[group.cat]);
              const takenInCat = group.items.filter((item) => studio.checkouts[item.id]).length;
              return (
                <div className={`equipment-cat ${expanded ? 'expanded' : ''}`} key={group.cat}>
                  <button
                    type="button"
                    className="equipment-cat__toggle"
                    aria-expanded={expanded}
                    onClick={() => setExpandedCats((prev) => ({ ...prev, [group.cat]: !prev[group.cat] }))}
                  >
                    <span className="equipment-cat__title">
                      {group.cat}
                      <small>{group.items.length} {group.items.length === 1 ? 'item' : 'itens'}{takenInCat > 0 ? ` · ${takenInCat} fora` : ''}</small>
                    </span>
                    <span className="equipment-cat__action">
                      {expanded ? 'Recolher' : 'Expandir'}
                      <ChevronRight size={16} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                  </button>

                  {expanded && (
                    <div className="equipment-cat__items">
                      {group.items.map((item) => {
                        const checkout = studio.checkouts[item.id];
                        const isOwner = checkout && (checkout.userId ? checkout.userId === userId : checkout.user === userName);
                        const canReturn = Boolean(checkout) && (isAdmin || isOwner);
                        return (
                          <div className={`equipment-item ${checkout ? 'taken' : ''}`} key={item.id}>
                            <div className="equipment-main">
                              <span className="equipment-name">{item.name}</span>
                              <div className="equipment-meta">
                                <span className="qty">{item.qty} unidades</span>
                                {item.alert && <span className="flag">{item.alert}</span>}
                              </div>
                            </div>
                            {checkout ? (
                              <div className="borrow">
                                <div className="borrow-copy">
                                  <strong>Retirado por {checkout.user}</strong>
                                  <span>{checkout.qty} unidade(s) - {borrowDueText(checkout)}</span>
                                  {checkout.justification && <em className="borrow-justification">"{checkout.justification}"</em>}
                                </div>
                                <button className="btn small" type="button" disabled={!canReturn} onClick={() => returnItem(item.id)}>Devolver</button>
                              </div>
                            ) : (
                              <button
                                className="btn small ghost take-action"
                                type="button"
                                onClick={() => openTakeModal(item.id)}
                              >
                                Pegar
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </article>
      </section>

      {showEquipmentTermPopup && (
        <TermsScrollPopup
          document={EQUIPMENT_TERMS}
          onAccept={() => { setEquipmentTermAccepted(true); setShowEquipmentTermPopup(false); }}
          onClose={() => setShowEquipmentTermPopup(false)}
        />
      )}

      {pendingTake && (() => {
        const item = ALL_EQUIPMENT.find((eq) => eq.id === pendingTake);
        if (!item) return null;
        return (
          <div className="modal-overlay" role="dialog" aria-modal="true" onClick={closeTakeModal}>
            <div className="modal-content" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>Pegar equipamento</h3>
                <button className="modal-close" type="button" onClick={closeTakeModal} aria-label="Fechar"><X size={20} aria-hidden="true" /></button>
              </div>

              <div className="take-modal">
                <div className="take-modal__item">
                  <span className="take-modal__label">Equipamento solicitado</span>
                  <strong>{item.name}</strong>
                  <div className="take-modal__tags">
                    <span className="qty">{item.qty} unidades disponíveis</span>
                    {item.alert && <span className="flag">{item.alert}</span>}
                  </div>
                </div>

                <label>
                  Quantidade
                  <select value={pendingQty} onChange={(event) => setPendingQty(Number(event.target.value))}>
                    {Array.from({ length: item.qty }, (_, index) => index + 1).map((qty) => <option key={qty} value={qty}>{qty}</option>)}
                  </select>
                </label>

                <label>
                  Justificativa (por que está pedindo o uso do equipamento)
                  <textarea
                    value={pendingJustification}
                    onChange={(event) => setPendingJustification(event.target.value)}
                    placeholder="Ex: gravação do podcast de quarta-feira"
                  />
                </label>

                <div className={`term-step ${equipmentTermAccepted ? 'done' : ''}`}>
                  <button type="button" className="btn btn-outline" onClick={() => setShowEquipmentTermPopup(true)}>
                    {equipmentTermAccepted ? 'Termo de uso aceito' : 'Ler termo de uso'}
                  </button>
                </div>

                <label>
                  Assinatura digital (nome completo)
                  <input
                    value={equipmentSignatureName}
                    disabled={!equipmentTermAccepted}
                    onChange={(event) => setEquipmentSignatureName(event.target.value)}
                    placeholder="Digite seu nome completo para confirmar"
                  />
                </label>

                <div className="face-step">
                  <span className="take-modal__label"><ScanFace size={16} aria-hidden="true" /> Validação facial (selfie)</span>
                  {takeFacePhoto ? (
                    <div className="face-step__done">
                      <img src={takeFacePhoto} alt="Selfie de validação facial" />
                      <label className="btn small ghost">
                        {takeFaceBusy ? 'Processando…' : 'Refazer selfie'}
                        <input type="file" accept="image/*" capture="user" disabled={takeFaceBusy} onChange={handleFaceCapture} hidden />
                      </label>
                    </div>
                  ) : (
                    <label className="btn btn-outline face-step__capture">
                      <Camera size={16} aria-hidden="true" />
                      {takeFaceBusy ? 'Processando…' : 'Tirar selfie de validação'}
                      <input type="file" accept="image/*" capture="user" disabled={takeFaceBusy} onChange={handleFaceCapture} hidden />
                    </label>
                  )}
                  <small className="face-step__hint">A selfie fica registrada junto à retirada para confirmar quem pegou o equipamento.</small>
                </div>

                <div className="modal-actions">
                  <button className="btn ghost" type="button" onClick={closeTakeModal}>Cancelar</button>
                  <button
                    className="btn btn-yellow"
                    type="button"
                    onClick={() => takeItem(item.id, pendingQty, pendingJustification)}
                    disabled={!takeReady}
                  >
                    Confirmar retirada
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {showEquipmentAccessGate && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowEquipmentAccessGate(false)}>
          <div className="modal-content modal-content--small" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Acesso restrito</h3>
              <button className="modal-close" type="button" onClick={() => setShowEquipmentAccessGate(false)} aria-label="Fechar"><X size={20} aria-hidden="true" /></button>
            </div>
            <p>Retirar equipamento do estúdio é uma ação restrita a admins.</p>
            <p>Você pode pedir liberação para este uso específico explicando o motivo; os admins avaliam e o Lucas aprova ou rejeita.</p>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={() => setShowEquipmentAccessGate(false)}>Fechar</button>
              <button
                className="btn btn-yellow"
                type="button"
                onClick={() => openEquipmentRequestForm(ALL_EQUIPMENT[0]?.id ?? '')}
              >
                Solicitar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {showEquipmentRequestForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowEquipmentRequestForm(false)}>
          <div className="modal-content modal-content--small" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Pedir equipamento</h3>
              <button className="modal-close" type="button" onClick={() => setShowEquipmentRequestForm(false)} aria-label="Fechar"><X size={20} aria-hidden="true" /></button>
            </div>
            <form onSubmit={submitEquipmentRequest}>
              <label>
                Equipamento
                <select value={equipmentRequestTarget} onChange={(event) => setEquipmentRequestTarget(event.target.value)}>
                  {ALL_EQUIPMENT.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                Justificativa (por que você precisa deste equipamento)
                <textarea
                  value={equipmentRequestJustification}
                  onChange={(event) => setEquipmentRequestJustification(event.target.value)}
                  placeholder="Explique o motivo do pedido"
                />
              </label>

              <div className={`term-step ${equipmentTermAccepted ? 'done' : ''}`}>
                <button type="button" className="btn btn-outline" onClick={() => setShowEquipmentTermPopup(true)}>
                  {equipmentTermAccepted ? 'Termo de uso aceito' : 'Ler termo de uso'}
                </button>
              </div>
              <label>
                Assinatura digital (nome completo)
                <input
                  value={equipmentSignatureName}
                  disabled={!equipmentTermAccepted}
                  onChange={(event) => setEquipmentSignatureName(event.target.value)}
                  placeholder="Digite seu nome completo para confirmar"
                />
              </label>

              {equipmentRequestInfo && <p className="out-count">{equipmentRequestInfo}</p>}

              <div className="modal-actions">
                <button className="btn ghost" type="button" onClick={() => setShowEquipmentRequestForm(false)}>Cancelar</button>
                <button
                  className="btn btn-yellow"
                  type="submit"
                  disabled={equipmentRequestBusy || !equipmentRequestJustification.trim() || !equipmentSignatureReady}
                >
                  {equipmentRequestBusy ? 'Enviando…' : 'Enviar pedido'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {savedNote && (
        <div
          className="toast"
          role="status"
          aria-live="polite"
          onClick={() => {
            if (flashTimer.current) window.clearTimeout(flashTimer.current);
            setSavedNote('');
          }}
        >
          <span>{savedNote}</span>
        </div>
      )}

      {/* ============================== */}
      {/* RENDERIZAÇÃO DO MODAL          */}
      {/* ============================== */}
      {showBookingModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowBookingModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Formulário de Acesso e Gravação</h3>
              <button className="modal-close" type="button" onClick={() => setShowBookingModal(false)} aria-label="Fechar">
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="legal-notice-box">
              <div className="legal-notice-box__header">
                <span className="legal-notice-box__icon" aria-hidden="true">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <span className="legal-notice-box__eyebrow">Solicitação institucional</span>
                  <h4>Coleta de dados solicitada pela Presidência da ASSEGO</h4>
                </div>
              </div>
              <p className="legal-notice-box__summary">
                Estas informações são necessárias para identificar os responsáveis, organizar o acesso e manter a segurança dos agendamentos e gravações realizados no estúdio.
              </p>
              <div className="legal-notice-box__privacy">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Dados de uso restrito à gestão autorizada da ASSEGO.</span>
              </div>
              <button
                type="button"
                className="legal-notice-box__toggle"
                aria-expanded={showLegalPopup}
                aria-controls="booking-legal-basis"
                onClick={() => setShowLegalPopup(!showLegalPopup)}
              >
                <span>{showLegalPopup ? 'Ocultar base legal e política de uso' : 'Consultar base legal e política de uso'}</span>
                {showLegalPopup
                  ? <ChevronUp size={16} aria-hidden="true" />
                  : <ChevronDown size={16} aria-hidden="true" />}
              </button>
              {showLegalPopup && (
                <div id="booking-legal-basis" className="legal-notice-box__body">
                  <strong>Base legal:</strong> para garantir a segurança orgânica das instalações da ASSEGO, o tratamento destes dados observa a <strong>Lei nº 13.709/2018 (LGPD)</strong>, especialmente o Art. 7º, incisos VII e IX. O acesso às informações é limitado às pessoas autorizadas.
                </div>
              )}
            </div>

            <form onSubmit={handleBookingSubmit}>
              <p className="modal-section-title">1. Dados do Solicitante</p>
              <div className="form-grid">
                <div className="form-group full">
                  <label htmlFor="req-name">Nome Completo</label>
                  <input id="req-name" required type="text" placeholder="Seu nome completo" value={requesterData.name} onChange={(e) => setRequesterData({ ...requesterData, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="req-email">E-mail</label>
                  <input id="req-email" required readOnly type="email" placeholder="voce@email.com" value={userEmail} />
                </div>
                <div className="form-group">
                  <label htmlFor="req-whats">WhatsApp</label>
                  <input id="req-whats" required type="text" placeholder="(62) 90000-0000" value={requesterData.whatsapp} onChange={(e) => setRequesterData({ ...requesterData, whatsapp: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="req-rg">RG</label>
                  <input id="req-rg" required type="text" placeholder="0000000" value={requesterData.rg} onChange={(e) => setRequesterData({ ...requesterData, rg: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="req-cpf">CPF</label>
                  <input id="req-cpf" required type="text" placeholder="000.000.000-00" value={requesterData.cpf} onChange={(e) => setRequesterData({ ...requesterData, cpf: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label htmlFor="req-social">Redes Sociais (@)</label>
                  <input id="req-social" required type="text" placeholder="@seu_perfil" value={requesterData.social} onChange={(e) => setRequesterData({ ...requesterData, social: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label>Data e horário</label>
                  <button type="button" className="availability-trigger" onClick={openAvailabilityPopup}>
                    {!afterHoursMode && requesterData.date && requesterData.time
                      ? formatBookingWhen(requesterData.date, requesterData.time)
                      : 'Escolher data e horário disponível'}
                  </button>
                  <div className={`after-hours-request ${afterHoursMode ? 'after-hours-request--open' : ''}`}>
                    <button
                      type="button"
                      className="after-hours-request__toggle"
                      aria-expanded={afterHoursMode}
                      aria-controls="after-hours-fields"
                      onClick={toggleAfterHoursMode}
                    >
                      <span>
                        <Clock3 size={18} aria-hidden="true" />
                        <span>
                          <strong>Precisa de um horário após as 17h?</strong>
                          <small>Envie uma solicitação excepcional para análise.</small>
                        </span>
                      </span>
                      {afterHoursMode
                        ? <ChevronUp size={17} aria-hidden="true" />
                        : <ChevronDown size={17} aria-hidden="true" />}
                    </button>
                    {afterHoursMode && (
                      <div id="after-hours-fields" className="after-hours-request__fields">
                        <p>Escolha uma data e um horário entre 17h30 e 23h30. Esta solicitação depende de aprovação e não representa confirmação automática da reserva.</p>
                        <div className="after-hours-request__grid">
                          <div className="form-group">
                            <label htmlFor="after-hours-date">Data pretendida</label>
                            <input
                              id="after-hours-date"
                              aria-required="true"
                              type="date"
                              min={afterHoursMinDate}
                              max={afterHoursMaxDate}
                              value={requesterData.date}
                              onChange={(event) => setRequesterData({ ...requesterData, date: event.target.value })}
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="after-hours-time">Horário pretendido</label>
                            <input
                              id="after-hours-time"
                              aria-required="true"
                              type="time"
                              min="17:30"
                              max="23:30"
                              step="1800"
                              value={requesterData.time}
                              onChange={(event) => setRequesterData({ ...requesterData, time: event.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="form-group full">
                  <section className="program-brief" aria-labelledby="program-brief-title">
                    <div className="program-brief__head">
                      <span aria-hidden="true"><FileText size={20} /></span>
                      <div>
                        <h4 id="program-brief-title">Informações e materiais do programa</h4>
                        <p>Envie à equipe tudo que deverá ser preparado ou exibido durante a gravação.</p>
                      </div>
                    </div>

                    <div className="program-brief__field">
                      <label htmlFor="program-name">Nome do programa ou podcast</label>
                      <input
                        id="program-name"
                        required
                        type="text"
                        maxLength={160}
                        placeholder="Ex.: Podcast Segurança em Pauta"
                        value={programName}
                        onChange={(event) => setProgramName(event.target.value)}
                      />
                    </div>

                    <fieldset className="program-format">
                      <legend>Formato do programa</legend>
                      <div className="program-format__options">
                        <button
                          type="button"
                          className={programFormat === 'recorded' ? 'is-selected' : ''}
                          aria-pressed={programFormat === 'recorded'}
                          onClick={() => {
                            setProgramFormat('recorded');
                            setYoutubeChannelUrl('');
                            setYoutubePermissionAcknowledged(false);
                          }}
                        >
                          <Video size={18} aria-hidden="true" />
                          <span><strong>Gravado</strong><small>Produção para edição e publicação posterior</small></span>
                        </button>
                        <button
                          type="button"
                          className={programFormat === 'live' ? 'is-selected' : ''}
                          aria-pressed={programFormat === 'live'}
                          onClick={() => setProgramFormat('live')}
                        >
                          <Radio size={18} aria-hidden="true" />
                          <span><strong>Ao vivo</strong><small>Transmissão pelo canal do solicitante</small></span>
                        </button>
                      </div>
                    </fieldset>

                    {programFormat === 'live' && (
                      <div className="youtube-access-panel">
                        <div className="program-brief__field">
                          <label htmlFor="youtube-channel-url">Link do canal do YouTube</label>
                          <input
                            id="youtube-channel-url"
                            required
                            type="url"
                            placeholder="https://www.youtube.com/@seu-canal"
                            value={youtubeChannelUrl}
                            onChange={(event) => setYoutubeChannelUrl(event.target.value)}
                          />
                        </div>
                        <div className="credential-safety-notice">
                          <ShieldCheck size={18} aria-hidden="true" />
                          <div>
                            <strong>Nunca informe login, senha ou código de verificação.</strong>
                            <span>O acesso do operador será feito por convite e permissão no YouTube Studio. A equipe entrará em contato para orientar a liberação.</span>
                          </div>
                        </div>
                        <label className="youtube-permission-check">
                          <input
                            type="checkbox"
                            checked={youtubePermissionAcknowledged}
                            onChange={(event) => setYoutubePermissionAcknowledged(event.target.checked)}
                          />
                          <span>Estou ciente de que o acesso será concedido por permissão, sem compartilhamento de senha.</span>
                        </label>
                      </div>
                    )}

                    <div className="program-brief__field">
                      <label htmlFor="production-notes">Orientações para a produção</label>
                      <textarea
                        id="production-notes"
                        maxLength={2000}
                        rows={4}
                        placeholder="Informe nomes, ordem do programa, textos, identidade visual, momentos de exibição e outras orientações."
                        value={productionNotes}
                        onChange={(event) => setProductionNotes(event.target.value)}
                      />
                      <small className="program-brief__counter">{productionNotes.length}/2000</small>
                    </div>

                    <div className="booking-materials">
                      <div className="booking-materials__head">
                        <div>
                          <strong>Artes, imagens, vídeos e PDF</strong>
                          <span>Até 10 arquivos, 50 MB por arquivo e 100 MB no total.</span>
                        </div>
                        <label className="booking-materials__upload">
                          <Upload size={17} aria-hidden="true" />
                          <span>Selecionar arquivos</span>
                          <input
                            type="file"
                            multiple
                            accept="image/*,video/*,application/pdf"
                            onChange={selectBookingMaterials}
                          />
                        </label>
                      </div>
                      {bookingMaterialFiles.length > 0 && (
                        <ul className="booking-materials__list">
                          {bookingMaterialFiles.map((file, index) => (
                            <li key={`${file.name}-${file.size}-${index}`}>
                              <span><FileText size={15} aria-hidden="true" /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span></span>
                              <button
                                type="button"
                                aria-label={`Remover ${file.name}`}
                                onClick={() => setBookingMaterialFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                              >
                                <X size={15} aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="program-brief__field">
                      <label htmlFor="booking-material-links"><Link2 size={14} aria-hidden="true" /> Links para arquivos maiores</label>
                      <textarea
                        id="booking-material-links"
                        rows={3}
                        placeholder={"Cole um link HTTPS por linha, como Google Drive, OneDrive ou WeTransfer."}
                        value={bookingMaterialLinks}
                        onChange={(event) => setBookingMaterialLinks(event.target.value)}
                      />
                    </div>
                    <p className="booking-materials__privacy">
                      Os arquivos enviados pelo botão ficam em armazenamento privado. O email de solicitação recebe links temporários para acesso.
                    </p>
                  </section>
                </div>
              </div>

              <p className="modal-section-title">2. Convidados (Participantes)</p>
              {guestsData.length === 0 && (
                <p className="guest-empty">Nenhum convidado adicionado. Se a gravação terá participantes, cadastre cada um abaixo.</p>
              )}
              {guestsData.map((guest, index) => (
                <div className="guest-card" key={index}>
                  <div className="guest-card__head">
                    <p className="guest-card__title">Convidado {index + 1}</p>
                    <button type="button" className="guest-card__remove" onClick={() => removeGuest(index)}>Remover</button>
                  </div>
                  <div className="form-grid">
                    <div className="form-group full">
                      <label>Nome Completo</label>
                      <input required type="text" placeholder="Nome do convidado" value={guest.name} onChange={(e) => updateGuest(index, 'name', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>RG</label>
                      <input required type="text" placeholder="0000000" value={guest.rg} onChange={(e) => updateGuest(index, 'rg', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>CPF</label>
                      <input required type="text" placeholder="000.000.000-00" value={guest.cpf} onChange={(e) => updateGuest(index, 'cpf', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>WhatsApp</label>
                      <input required type="text" placeholder="(62) 90000-0000" value={guest.whatsapp} onChange={(e) => updateGuest(index, 'whatsapp', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>E-mail</label>
                      <input required type="email" placeholder="convidado@email.com" value={guest.email} onChange={(e) => updateGuest(index, 'email', e.target.value)} />
                    </div>
                    <div className="form-group full">
                      <label>Redes Sociais (@)</label>
                      <input required type="text" placeholder="@perfil" value={guest.social} onChange={(e) => updateGuest(index, 'social', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}

              <button type="button" className="btn btn-outline btn-block" onClick={addGuest}>
                + Adicionar Convidado
              </button>

              {/* ============================================================
                  3. GATE JURÍDICO — Termo de Uso + Assinatura Digital
                  A solicitação só é enviada aos aprovadores após ler o Termo
                  até o fim (popup com scroll obrigatório) e assinar. O backend
                  (Edge Function) carimba IP (x-forwarded-for), timestamp e
                  hash SHA-256 na tabela legal_signatures para não-repúdio.
                  ============================================================ */}
              <p className="modal-section-title">3. Termo de Uso e Assinatura Digital</p>
              <div className="signature-gate">
                <div className={`signature-step ${termAccepted ? 'done' : ''}`}>
                  <span className="signature-step__label">
                    <span className="signature-step__num">1</span>
                    Leia o Termo de Uso até o final e clique em Concordo
                  </span>
                  <button type="button" className="term-download" onClick={() => setShowTermPopup(true)}>
                    {termAccepted ? 'Termo de Uso aceito — ler novamente' : 'Ler Termo de Uso'}
                  </button>
                </div>

                <div className={`signature-step ${signatureName.trim().length >= 3 ? 'done' : ''}`}>
                  <span className="signature-step__label">
                    <span className="signature-step__num">2</span>
                    Assinatura digital
                  </span>
                  <div className="signature-input">
                    <input
                      type="text"
                      placeholder="Digite seu nome completo para assinar"
                      value={signatureName}
                      disabled={!termAccepted}
                      onChange={(e) => setSignatureName(e.target.value)}
                    />
                  </div>
                  <span className="signature-hint">
                    Ao assinar, data, hora e dispositivo são registrados para validade jurídica (LGPD).
                  </span>
                </div>

                {showTermPopup && (
                  <TermsScrollPopup
                    document={BOOKING_TERMS}
                    onAccept={() => {
                      setTermAccepted(true);
                      setShowTermPopup(false);
                    }}
                    onClose={() => setShowTermPopup(false)}
                  />
                )}

                {/* Gancho de UI para futura Autenticação Facial (Face ID).
                    Fluxo: navigator.mediaDevices.getUserMedia -> frame Base64 ->
                    Edge Function -> AWS Rekognition/Azure Face. */}
                <div className="faceid-placeholder" aria-hidden="true">
                  Validação facial (Face ID) — em breve, antes do envio.{' '}
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowBookingModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-yellow" disabled={!signatureReady || bookingBusy}>
                  {bookingBusy ? 'Enviando...' : 'Assinar e enviar solicitação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================== */}
      {/* MENUS E MODAIS NATIVOS         */}
      {/* ============================== */}
      {/* Navegação principal fica na área "Acesso rápido" do painel Agenda.
          O cabeçalho (logo/título) leva de volta à Agenda a partir de
          qualquer aba. */}
      {installFab}
      {iosModal}

      {showAvailability && (
        <div className="modal-overlay availability-overlay" role="dialog" aria-modal="true" onClick={() => setShowAvailability(false)}>
          <div className="availability-card" onClick={(event) => event.stopPropagation()}>
            <div className="availability-head">
              <h3>Escolher data e horário</h3>
              <button type="button" className="modal-close" onClick={() => setShowAvailability(false)} aria-label="Fechar"><X size={20} aria-hidden="true" /></button>
            </div>

            {availabilityLoading && <p className="availability-status">Carregando agenda do estúdio...</p>}
            {availabilityError && <p className="availability-status availability-status--error">{availabilityError}</p>}

            {!availabilityLoading && !availabilityError && (
              <>
                <div className="availability-month-nav">
                  <button type="button" onClick={() => setAvailabilityMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>‹</button>
                  <strong>{availabilityMonthCursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>
                  <button type="button" onClick={() => setAvailabilityMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>›</button>
                </div>

                <div className="availability-grid availability-grid--head">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
                </div>
                <div className="availability-grid">
                  {buildAvailabilityMonthGrid(availabilityMonthCursor).map((dateStr, i) => {
                    if (!dateStr) return <span key={i} className="availability-cell availability-cell--empty" />;
                    const day = availabilityByDate[dateStr];
                    const isPast = dateStr < new Date().toISOString().slice(0, 10);
                    const selectable = Boolean(day?.hasAvailability) && !isPast;
                    const known = Boolean(day) || isPast || (() => {
                      const weekday = new Date(`${dateStr}T00:00:00`).getDay();
                      return weekday === 0;
                    })();
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={!selectable}
                        className={`availability-cell ${selectable ? 'availability-cell--free' : known ? 'availability-cell--busy' : 'availability-cell--unknown'} ${availabilitySelectedDate === dateStr ? 'availability-cell--selected' : ''}`}
                        onClick={() => setAvailabilitySelectedDate(dateStr)}
                      >
                        {Number(dateStr.slice(8, 10))}
                      </button>
                    );
                  })}
                </div>

                {availabilitySelectedDate && (
                  <div className="availability-slots">
                    <p className="availability-slots-title">
                      Horários de {formatBookingWhen(availabilitySelectedDate, '')}
                    </p>
                    <div className="availability-slots-list">
                      {(availabilityByDate[availabilitySelectedDate]?.slots ?? []).map((slot) => (
                        <button 
                          key={slot.time}
                          type="button"
                          disabled={!slot.available}
                          className={`availability-slot ${slot.available ? 'availability-slot--free' : 'availability-slot--busy'}`}
                          onClick={() => pickAvailabilitySlot(availabilitySelectedDate, slot.time)}
                        >
                          {slot.time}
                        </button>
                      ))}
                      {!availabilityByDate[availabilitySelectedDate] && (
                        <span className="availability-slots-empty">Estúdio fechado neste dia.</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

    </main>
  );
}
