import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Bell, ClipboardCheck, PackageCheck, Video, CalendarDays, type LucideIcon } from 'lucide-react';
import { edgeFunctionUrl, supabase, supabaseConfigured, type Profile, type UserRole } from './supabase';
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
  type Checkout,
  type MediaItem,
  type NotificationEvent,
  type ObservationRecord,
  type ConferenceRecord,
  type StudioState,
  type BookingRequest,
  type BookingStatus,
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
const STREAM_ID = 'kSgcFevrC0o';
const EMAIL_RECIPIENTS = ['ricksonlucasgomes@gmail.com', 'comunicacaoassego@gmail.com', 'P3dacao@gmail.com'];
// Documento oficial (fica em /public) e destinatários da aprovação do agendamento.
const TERM_OF_USE_URL = '/Termo_de_Uso_Assego.pdf';
const BOOKING_APPROVERS = ['Lucas Rickson', 'Badu', 'Sergio Vinicius'];
const PODCAST_NOTICE = 'Toda Quarta-Feira às 19 horas tem podcast ao vivo da ASSEGO com o presidente Subtenente Sérgio';
const UPLOAD_ENDPOINT = import.meta.env.VITE_UPLOAD_ENDPOINT as string | undefined;
const ACCESS_REQUEST_ENDPOINT = import.meta.env.VITE_ACCESS_REQUEST_ENDPOINT as string | undefined;
const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'admin',
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

// 2. Adicionada a aba de Agenda no Menu
const MAIN_TABS: TabItem[] = [
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'camera', label: 'Câmera', icon: Video },
  { id: 'conference', label: 'Conferência', icon: ClipboardCheck },
  { id: 'custody', label: 'Cautela', icon: PackageCheck },
];

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
  return message;
}

export function App() {
  const [studio, setStudio] = useState<StudioState>(() => readJson(STUDIO_KEY, emptyStudioState));
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string>>(() => readJson(PROFILE_KEY, {}));

  // Autenticacao (Supabase)
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [formEmail, setFormEmail] = useState('');
  const [formPass, setFormPass] = useState('');
  const [formName, setFormName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authInfo, setAuthInfo] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  // Instalacao (PWA)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);

  // Estudio / Estados Gerais
  const [pendingTake, setPendingTake] = useState('');
  const [pendingQty, setPendingQty] = useState(1);
  const [pendingEquipmentPhoto, setPendingEquipmentPhoto] = useState('');
  const [observationDraft, setObservationDraft] = useState(() => studio.notes);
  const [mediaEquipment, setMediaEquipment] = useState('geral');
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [savedNote, setSavedNote] = useState('Conferência salva automaticamente');
  const [cameraClock, setCameraClock] = useState(Date.now());
  const [cameraOn, setCameraOn] = useState(false);
  const [accessRequestBusy, setAccessRequestBusy] = useState(false);
  const [accessRequestInfo, setAccessRequestInfo] = useState('');
  
  // 3. Estado inicial da aba agora é 'agenda'
  const [activeTab, setActiveTab] = useState<MainTab>('agenda');

  // 4. Estados da Nova Feature de Agendamento
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showLegalPopup, setShowLegalPopup] = useState(false);
  const [requesterData, setRequesterData] = useState({
    name: '', rg: '', cpf: '', email: '', whatsapp: '', social: '', date: '', time: ''
  });
  const [guestsData, setGuestsData] = useState<{name: string, rg: string, cpf: string, email: string, whatsapp: string, social: string}[]>([]);

  // 5. Gate jurídico: Termo de Uso baixado + aceite + assinatura digital
  const [termDownloaded, setTermDownloaded] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [bookingBusy, setBookingBusy] = useState(false);

  // Painel de admin: solicitações de agendamento para aprovar/rejeitar.
  const [bookingRequests, setBookingRequests] = useState<BookingRequest[]>([]);
  const [bookingListBusy, setBookingListBusy] = useState(false);
  const [bookingListError, setBookingListError] = useState('');
  const [bookingActionId, setBookingActionId] = useState('');

  const role: UserRole = profile?.role ?? 'viewer';
  const canManage = role === 'admin' || role === 'borrower';
  // A aba Conferência só aparece para quem gerencia (admin) ou pode
  // solicitar retirada de equipamento (borrower). Viewer não a vê.
  const visibleTabs = useMemo(
    () => MAIN_TABS.filter((tab) => tab.id !== 'conference' || canManage),
    [canManage],
  );
  // Se o papel do usuário for rebaixado enquanto ele está na Conferência,
  // tira ele da aba que deixou de existir para o perfil dele.
  useEffect(() => {
    if (activeTab === 'conference' && !canManage) setActiveTab('agenda');
  }, [activeTab, canManage]);
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

  useEffect(() => {
    const timer = window.setInterval(() => setCameraClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
        await loadProfile(session.user.id, session.user.email ?? '', (session.user.user_metadata?.full_name as string) ?? '');
      } else {
        setUserId('');
        setUserEmail('');
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
    window.setTimeout(() => setSavedNote('Conferência salva automaticamente'), 1400);
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
          setAuthInfo('Cadastro criado. Confirme pelo link enviado ao seu email e depois faça login.');
          setAuthMode('login');
          setFormPass('');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setAuthError(friendlyAuthError(error.message));
          return;
        }
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogle() {
    if (!supabase) return;
    setAuthError('');
    setAuthInfo('');
    if (!GOOGLE_AUTH_ENABLED) {
      setAuthError('Login com Google ainda não foi ativado no Supabase. Use email e senha por enquanto.');
      return;
    }
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
          requestedRole: userEmail.toLowerCase() === 'ricksonlucasgomes@gmail.com' ? 'admin' : 'borrower',
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

  function takeItem(id: string, qty: number) {
    if (!canManage || !isAuthed) return;
    if (!pendingEquipmentPhoto) {
      flash('Anexe a foto do equipamento antes de salvar');
      return;
    }
    const ts = Date.now();
    const checkout: Checkout = { user: userName, userId, ts, qty, photo: pendingEquipmentPhoto };
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
          photo: pendingEquipmentPhoto,
          checkedOutAt: ts,
        }),
        ...(current.notificationEvents ?? []),
      ].slice(0, 80),
    }));
    persist(() => upsertCheckout(id, checkout));
    setPendingTake('');
    setPendingQty(1);
    setPendingEquipmentPhoto('');
    flash('Retirada registrada');
  }

  function returnItem(id: string) {
    const checkout = studio.checkouts[id];
    const isOwner = checkout && (checkout.userId ? checkout.userId === userId : checkout.user === userName);
    if (!canManage || !checkout || (role !== 'admin' && !isOwner)) return;
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

  async function handleEquipmentPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const photo = await resizePhoto(file);
    setPendingEquipmentPhoto(photo);
    flash('Foto da retirada anexada');
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

      if (UPLOAD_ENDPOINT && supabase) {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          const response = await fetch(UPLOAD_ENDPOINT, {
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

  // Gate liberado só quando o Termo foi baixado, aceito e assinado.
  const signatureReady = termDownloaded && acceptedTerms && signatureName.trim().length >= 3;

  function resetBookingForm() {
    setRequesterData({ name: '', rg: '', cpf: '', email: '', whatsapp: '', social: '', date: '', time: '' });
    setGuestsData([]);
    setTermDownloaded(false);
    setAcceptedTerms(false);
    setSignatureName('');
  }

  const handleBookingSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (bookingBusy) return;

    if (!signatureReady) {
      alert('Antes de enviar: baixe o Termo de Uso, marque o aceite e assine com seu nome completo.');
      return;
    }

    setBookingBusy(true);
    try {
      if (!supabase) throw new Error('Banco de dados não configurado.');

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        alert('Sua sessão expirou. Você precisa fazer login novamente.');
        return;
      }

      // Metadados da assinatura digital (não-repúdio). O hash SHA-256 + IP
      // (x-forwarded-for) são carimbados no backend pela Edge Function.
      const signature = {
        fullName: signatureName.trim(),
        acceptedTerms: true,
        termDocument: 'Termo_de_Uso_Assego.pdf',
        termDownloaded: true,
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
          },
          body: JSON.stringify({
            requester: requesterData,
            guests: guestsData,
            booking_details: { date: requesterData.date, time: requesterData.time },
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

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Erro no servidor. Tente novamente mais tarde.');
      }

      alert('Sucesso! Sua solicitação assinada foi enviada e está sob análise da diretoria.');
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
    if (role !== 'admin' || !supabaseConfigured) {
      setBookingRequests([]);
      return;
    }

    loadBookingRequests();
    const timer = window.setInterval(loadBookingRequests, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, supabaseConfigured]);


  const installFab = canShowInstall ? (
    <button className="install-fab" type="button" onClick={handleInstallClick}>
      <span className="install-fab-icon" aria-hidden="true">⭳</span>
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

  const liveModal = cameraOn ? (
    <div className="live-modal" role="dialog" aria-modal="true" onClick={() => setCameraOn(false)}>
      <div className="live-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="live-modal-head">
          <span className="live-badge camera-rec">REC</span>
          <span className="live-modal-title">Câmera ao vivo</span>
          <button className="live-modal-close" type="button" onClick={() => setCameraOn(false)} aria-label="Fechar transmissão">✕</button>
        </div>
        <div className="video-box camera-frame">
          <iframe
            title="Câmera ao vivo"
            src={`https://www.youtube.com/embed/${STREAM_ID}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&playsinline=1`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          <div className="camera-overlay" aria-hidden="true">
            <div className="camera-hud top">
              <span><strong>REC</strong> CAM 01</span>
              <span>{formatDateTime(cameraClock)}</span>
            </div>
            <div className="camera-hud bottom">
              <span>ASSEGO ESTÚDIO</span>
              <span>1080P · AUTO</span>
            </div>
            <span className="frame-corner tl" />
            <span className="frame-corner tr" />
            <span className="frame-corner bl" />
            <span className="frame-corner br" />
            <span className="focus-mark" />
          </div>
        </div>
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

  if (!isAuthed) {
    return (
      <main className="login-screen">
        <form className="login-card" onSubmit={handleEmailAuth}>
          <div className="logo-chip"><img src="/logo.png" alt="ASSEGO PM & BM" /></div>
          <p className="eyebrow">ASSEGO PM &amp; BM</p>
          <h1>Agenda e estúdio</h1>

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

          <button className="btn" type="submit" disabled={authBusy || !supabaseConfigured}>
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
            {GOOGLE_AUTH_ENABLED ? 'Entrar com Google' : 'Google em configuração'}
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
        <div className="logo-chip"><img src="/logo.png" alt="ASSEGO PM & BM" /></div>
        <div className="brand-copy">
          <p className="eyebrow">ASSEGO PM &amp; BM</p>
          <h1><strong>Agenda e estúdio</strong></h1>
          <p className="brand-subtitle">Agenda, cautela e conferência diária em um painel interno.</p>
          <div className="brand-metrics" aria-label="Resumo do estúdio">
            <span><strong>{ALL_EQUIPMENT.length}</strong> itens</span>
            <span><strong>{checkedCount}</strong> conferidos</span>
            <span><strong>{outsideCount}</strong> fora</span>
            <span><strong>{ROLE_LABEL[role]}</strong> acesso</span>
          </div>
        </div>
        <div className="session">
          <div className="avatar">
            {profilePhotos[userId] ? <img src={profilePhotos[userId]} alt="" /> : initials(userName)}
          </div>
          <span>{userName} - {ROLE_LABEL[role]}</span>
          <label className="photo-btn">
            Foto
            <input type="file" accept="image/*" onChange={handleProfilePhoto} />
          </label>
          <button className="btn ghost" type="button" onClick={logout}>Sair</button>
        </div>
      </header>

      {role === 'viewer' && (
        <div className="viewer-banner">
          <span>
            Seu acesso está como visualização. Um admin precisa liberar seu perfil para retirar equipamentos e salvar conferências.
          </span>
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
          <article className="card premium-card">
            <div className="agenda-head">
              <h2>Agenda do Estúdio ASSEGO</h2>
              {role === 'admin' ? (
                <button className="btn btn-yellow" type="button" onClick={() => setShowBookingModal(true)}>+ Gerenciar / Nova Reserva</button>
              ) : (
                <button className="btn btn-primary" type="button" onClick={() => setShowBookingModal(true)}>Solicitar Agendamento</button>
              )}
            </div>

            <div className="calendar-frame">
              <iframe
                title="Google Calendar"
                src="https://calendar.google.com/calendar/embed?height=600&wkst=1&bgcolor=%23050B14&ctz=America%2FSao_Paulo&showTitle=0&showPrint=0&showTabs=0&showCalendars=0&showTz=0&mode=WEEK"
                scrolling="no">
              </iframe>
            </div>
          </article>

          {/* Painel de avaliação — só admin. Lista as solicitações assinadas
              e permite aprovar/rejeitar (muda o status via RLS de admin). */}
          {role === 'admin' && (
            <article className="card booking-admin">
              <div className="card-head">
                <h2>Solicitações de agendamento</h2>
                <p className="booking-admin__scope">Visivel apenas para Lucas, Badu e Sergio Vinicius.</p>
                <button className="btn ghost" type="button" onClick={loadBookingRequests} disabled={bookingListBusy}>
                  {bookingListBusy ? 'Atualizando…' : 'Atualizar'}
                </button>
              </div>

              <div className={`booking-alert ${pendingBookingCount > 0 ? 'booking-alert--active' : ''}`}>
                <span className="booking-alert__icon" aria-hidden="true"><Bell size={18} /></span>
                <div>
                  <strong>{pendingBookingCount > 0 ? `${pendingBookingCount} solicitacao(oes) aguardando analise` : 'Nenhuma solicitacao pendente'}</strong>
                  <span>As novas solicitacoes chegam aqui no proprio app com os dados preenchidos pelo usuario.</span>
                </div>
              </div>

              {bookingListError && <p className="out-count">{bookingListError}</p>}
              {!bookingListBusy && !bookingListError && bookingRequests.length === 0 && (
                <p className="guest-empty">Nenhuma solicitação por enquanto.</p>
              )}

              <div className="booking-list">
                {bookingRequests.map((req) => (
                  <div className={`booking-item booking-item--${req.status}`} key={req.id}>
                    <div className="booking-item__head">
                      <div className="booking-item__who">
                        <strong>{req.requester_name}</strong>
                        <span className="booking-item__when">{formatBookingWhen(req.requested_date, req.requested_time)}</span>
                      </div>
                      <div className="booking-item__badges">
                        {req.status === 'requested' && <span className="booking-badge booking-badge--new">Nova</span>}
                        <span className={`booking-badge booking-badge--${req.status}`}>{BOOKING_STATUS_LABEL[req.status]}</span>
                      </div>
                    </div>

                    <div className="booking-item__contact">
                      {req.requester_whatsapp && <span>📱 {req.requester_whatsapp}</span>}
                      {req.requester_email && <span>✉ {req.requester_email}</span>}
                      {req.requester_cpf && <span>CPF {req.requester_cpf}</span>}
                    </div>

                    <div className="booking-item__section">
                      <h3>Dados completos do solicitante</h3>
                      <div className="booking-field-grid">
                        <span><b>Nome</b>{req.requester_name || '-'}</span>
                        <span><b>WhatsApp</b>{req.requester_whatsapp || '-'}</span>
                        <span><b>Email</b>{req.requester_email || '-'}</span>
                        <span><b>RG</b>{req.requester_rg || '-'}</span>
                        <span><b>CPF</b>{req.requester_cpf || '-'}</span>
                        <span><b>Rede social</b>{req.requester_social || '-'}</span>
                      </div>
                    </div>

                    {req.participants.length > 0 && (
                      <details className="booking-item__guests">
                        <summary>{req.participants.length} convidado(s)</summary>
                        <ul>
                          {req.participants.map((p) => (
                            <li key={p.id}>{p.full_name}{p.whatsapp ? ` — ${p.whatsapp}` : ''}</li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {req.participants.length > 0 && (
                      <div className="booking-item__section">
                        <h3>Dados completos dos convidados</h3>
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
                      {req.status === 'requested' ? (
                        <>
                          <button className="btn btn-yellow" type="button" disabled={bookingActionId === req.id} onClick={() => decideBooking(req.id, 'approved')}>Aprovar</button>
                          <button className="btn btn-outline" type="button" disabled={bookingActionId === req.id} onClick={() => decideBooking(req.id, 'rejected')}>Rejeitar</button>
                        </>
                      ) : (
                        <button className="btn ghost" type="button" disabled={bookingActionId === req.id} onClick={() => decideBooking(req.id, 'requested')}>Reabrir</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          )}
        </div>


        {/* ============================== */}
        {/* ABA ANTIGA: CÂMERA AO VIVO     */}
        {/* ============================== */}
        <div className={`tab-panel ${activeTab === 'camera' ? 'active' : ''}`}>
        <article className="card">
          <div className="card-head">
            <h2>Câmera ao vivo</h2>
          </div>
          <div className="video-box camera-frame">
            <button type="button" className="camera-start" onClick={() => setCameraOn(true)}>
              <span className="camera-start-icon"><Video aria-hidden="true" size={30} strokeWidth={2.4} /></span>
              <span className="camera-start-text">Estúdio em tempo real</span>
              <span className="camera-start-sub">Toque para abrir a transmissão ao vivo</span>
            </button>
          </div>
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
                        <div className="borrow">
                          <div className="borrow-copy">
                            <strong>Retirado por {checkout.user}</strong>
                            <span>{checkout.qty} unidade(s) - {borrowDueText(checkout)}</span>
                          </div>
                          {checkout.photo && <img className="equipment-photo" src={checkout.photo} alt={`Foto da retirada de ${item.name}`} />}
                          <button className="btn small" type="button" onClick={() => returnItem(item.id)}>Devolver</button>
                        </div>
                      ) : pendingTake === item.id ? (
                        <div className="take-form">
                          <label>
                            Quantidade
                            <select value={pendingQty} onChange={(event) => setPendingQty(Number(event.target.value))}>
                              {Array.from({ length: item.qty }, (_, index) => index + 1).map((qty) => <option key={qty} value={qty}>{qty}</option>)}
                            </select>
                          </label>
                          <label className="equipment-photo-upload">
                            Foto obrigatória do equipamento
                            <input type="file" accept="image/*" capture="environment" onChange={handleEquipmentPhoto} />
                            <span>Tire pelo celular ou envie uma imagem.</span>
                          </label>
                          {pendingEquipmentPhoto && <img className="equipment-photo preview" src={pendingEquipmentPhoto} alt="Prévia da foto anexada" />}
                          <button className="btn small" type="button" onClick={() => takeItem(item.id, pendingQty)} disabled={!pendingEquipmentPhoto}>Salvar retirada</button>
                          <button className="btn small ghost" type="button" onClick={() => { setPendingTake(''); setPendingEquipmentPhoto(''); }}>Cancelar</button>
                        </div>
                      ) : (
                        <button className="btn small ghost take-action" type="button" onClick={() => { setPendingTake(item.id); setPendingQty(1); setPendingEquipmentPhoto(''); }} disabled={!canManage}>Pegar</button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
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
        </div>
      </section>


      {/* ============================== */}
      {/* ABA ANTIGA: CAUTELA            */}
      {/* ============================== */}
      <section className={`tab-panel ${activeTab === 'custody' ? 'active' : ''}`}>
      <article className="card media-card">
        <div className="card-head">
          <h2>Cautela</h2>
          <a className="btn ghost" href={driveFolder} target="_blank" rel="noreferrer">Abrir Drive</a>
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
      </section>

      <footer className="status-footer">
        <span>{savedNote}</span>
      </footer>

      {/* ============================== */}
      {/* RENDERIZAÇÃO DO MODAL          */}
      {/* ============================== */}
      {showBookingModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowBookingModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Formulário de Acesso e Gravação</h3>
              <button className="modal-close" type="button" onClick={() => setShowBookingModal(false)} aria-label="Fechar">✕</button>
            </div>

            <div className="legal-notice-box">
              <strong>⚠️ Controle de Acesso Obrigatório (LGPD)</strong>
              <button type="button" className="legal-notice-box__toggle" onClick={() => setShowLegalPopup(!showLegalPopup)}>
                {showLegalPopup ? 'Ocultar embasamento jurídico' : 'Ler embasamento jurídico'}
              </button>
              {showLegalPopup && (
                <div className="legal-notice-box__body">
                  Para garantir a segurança orgânica das instalações da ASSEGO, a coleta destes dados é amparada pela <strong>Lei nº 13.709/2018</strong>, Art. 7º, incisos VII e IX. Uso restrito à diretoria.
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
                  <input id="req-email" required type="email" placeholder="voce@email.com" value={requesterData.email} onChange={(e) => setRequesterData({ ...requesterData, email: e.target.value })} />
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
                  <input id="req-social" type="text" placeholder="@seu_perfil (opcional)" value={requesterData.social} onChange={(e) => setRequesterData({ ...requesterData, social: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="req-date">Data Desejada</label>
                  <input id="req-date" required type="date" value={requesterData.date} onChange={(e) => setRequesterData({ ...requesterData, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="req-time">Horário</label>
                  <input id="req-time" required type="time" value={requesterData.time} onChange={(e) => setRequesterData({ ...requesterData, time: e.target.value })} />
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
                      <input type="email" placeholder="convidado@email.com (opcional)" value={guest.email} onChange={(e) => updateGuest(index, 'email', e.target.value)} />
                    </div>
                    <div className="form-group full">
                      <label>Redes Sociais (@)</label>
                      <input type="text" placeholder="@perfil (opcional)" value={guest.social} onChange={(e) => updateGuest(index, 'social', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}

              <button type="button" className="btn btn-outline btn-block" onClick={addGuest}>
                + Adicionar Convidado
              </button>

              {/* ============================================================
                  3. GATE JURÍDICO — Termo de Uso + Assinatura Digital
                  A solicitação só é enviada aos aprovadores após baixar o
                  Termo, aceitar e assinar. O backend (Edge Function) carimba
                  IP (x-forwarded-for), timestamp e hash SHA-256 na tabela
                  legal_signatures para não-repúdio.
                  ============================================================ */}
              <p className="modal-section-title">3. Termo de Uso e Assinatura Digital</p>
              <div className="signature-gate">
                <div className={`signature-step ${termDownloaded ? 'done' : ''}`}>
                  <span className="signature-step__label">
                    <span className="signature-step__num">{termDownloaded ? '✓' : '1'}</span>
                    Baixe e leia o Termo de Uso / Regimento Interno
                  </span>
                  <a
                    className="term-download"
                    href={TERM_OF_USE_URL}
                    download
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setTermDownloaded(true)}
                  >
                    ⬇ Baixar Termo de Uso (PDF)
                  </a>
                </div>

                <div className={`signature-step ${acceptedTerms ? 'done' : ''}`}>
                  <span className="signature-step__label">
                    <span className="signature-step__num">{acceptedTerms ? '✓' : '2'}</span>
                    Aceite das regras
                  </span>
                  <label className="consent-row">
                    <input
                      type="checkbox"
                      checked={acceptedTerms}
                      disabled={!termDownloaded}
                      onChange={(e) => setAcceptedTerms(e.target.checked)}
                    />
                    <span>Li e concordo com o Termo de Uso, o Regimento Interno e as regras do estúdio da ASSEGO, e assumo responsabilidade pelas informações prestadas.</span>
                  </label>
                </div>

                <div className={`signature-step ${signatureName.trim().length >= 3 ? 'done' : ''}`}>
                  <span className="signature-step__label">
                    <span className="signature-step__num">{signatureName.trim().length >= 3 ? '✓' : '3'}</span>
                    Assinatura digital
                  </span>
                  <div className="signature-input">
                    <input
                      type="text"
                      placeholder="Digite seu nome completo para assinar"
                      value={signatureName}
                      disabled={!acceptedTerms}
                      onChange={(e) => setSignatureName(e.target.value)}
                    />
                  </div>
                  <span className="signature-hint">
                    Ao assinar, data, hora e dispositivo são registrados para validade jurídica (LGPD).
                  </span>
                </div>

                {/* Gancho de UI para futura Autenticação Facial (Face ID).
                    Fluxo: navigator.mediaDevices.getUserMedia -> frame Base64 ->
                    Edge Function -> AWS Rekognition/Azure Face. */}
                <div className="faceid-placeholder" aria-hidden="true">
                  <span aria-hidden="true">📷</span>
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
      <nav className="bottom-tabs" aria-label="Navegação principal do app">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={selected ? 'active' : ''}
              aria-current={selected ? 'page' : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon aria-hidden="true" size={22} strokeWidth={2.2} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
      {installFab}
      {iosModal}
      {liveModal}
    </main>
  );
}
