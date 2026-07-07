import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
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
  type Checkout,
  type MediaItem,
  type NotificationEvent,
  type ObservationRecord,
  type ConferenceRecord,
  type StudioState,
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

const EQUIPMENT: EquipmentGroup[] = [
  { cat: 'Video & Switching', items: [
    { id: 'cam', name: 'Cameras Blackmagic', qty: 3 },
    { id: 'atem', name: 'ATEM Mini Pro', qty: 2 },
    { id: 'bat', name: 'Baterias Blackmagic', qty: 3 },
  ] },
  { cat: 'Audio', items: [
    { id: 'mesa', name: 'Mesa de audio', qty: 1 },
    { id: 'mic', name: 'Microfones condensadores podcast', qty: 4 },
    { id: 'akg', name: 'Fone AKG', qty: 1 },
  ] },
  { cat: 'Iluminacao', items: [
    { id: 'soft', name: 'Softbox', qty: 1 },
    { id: 'led', name: 'LEDs coloridos', qty: 2 },
  ] },
  { cat: 'Suporte', items: [
    { id: 'tripe', name: 'Tripes', qty: 3, alert: 'Falta 1' },
    { id: 'tripe_led', name: 'Tripes dos LEDs RGB', qty: 2 },
  ] },
  { cat: 'Energia', items: [
    { id: 'filtro', name: 'Filtro de linha', qty: 1 },
  ] },
];

const ALL_EQUIPMENT = EQUIPMENT.flatMap((group) => group.items);
const PROFILE_KEY = 'assego-profile-photos-v3';
const STREAM_ID = 'kSgcFevrC0o';
const EMAIL_RECIPIENTS = ['ricksonlucasgomes@gmail.com', 'comunicacaoassego@gmail.com', 'P3dacao@gmail.com'];
const UPLOAD_ENDPOINT = import.meta.env.VITE_UPLOAD_ENDPOINT as string | undefined;
const ACCESS_REQUEST_ENDPOINT = import.meta.env.VITE_ACCESS_REQUEST_ENDPOINT as string | undefined;
const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'admin',
  borrower: 'retirada',
  viewer: 'visualizacao',
};

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
  if (id === 'geral') return 'Geral do estudio';
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
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem invalida.'));
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
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem invalida.'));
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
  return left === 0 ? `Devolver hoje (${dueDate})` : `Devolver ate ${dueDate}, faltam ${left}d`;
}

function friendlyAuthError(message: string) {
  const msg = message.toLowerCase();
  if (msg.includes('invalid login')) return 'Email ou senha incorretos.';
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'Esse email ja tem cadastro. Faca login.';
  if (msg.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return 'Email invalido.';
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

  // Estudio
  const [pendingTake, setPendingTake] = useState('');
  const [pendingQty, setPendingQty] = useState(1);
  const [pendingEquipmentPhoto, setPendingEquipmentPhoto] = useState('');
  const [observationDraft, setObservationDraft] = useState(() => studio.notes);
  const [mediaEquipment, setMediaEquipment] = useState('geral');
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [savedNote, setSavedNote] = useState('Conferencia salva automaticamente');
  const [cameraClock, setCameraClock] = useState(Date.now());
  const [accessRequestBusy, setAccessRequestBusy] = useState(false);
  const [accessRequestInfo, setAccessRequestInfo] = useState('');

  const role: UserRole = profile?.role ?? 'viewer';
  const canManage = role === 'admin' || role === 'borrower';
  const userName = profile?.full_name || (userEmail ? userEmail.split('@')[0] : '');
  const isAuthed = Boolean(userId);
  const driveFolder = studio.driveFolder || DEFAULT_DRIVE_FOLDER;
  const checkedCount = useMemo(() => ALL_EQUIPMENT.filter((item) => studio.checks[item.id]).length, [studio.checks]);
  const outsideCount = Object.keys(studio.checkouts).length;
  const lastConference = studio.conferences[0];

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
    window.setTimeout(() => setSavedNote('Conferencia salva automaticamente'), 1400);
  }

  function persist(action: () => Promise<void>) {
    action().catch((error) => {
      console.warn('Falha ao sincronizar com Supabase.', error);
      flash('Salvo neste aparelho; sincronizacao pendente');
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
          setAuthInfo('Cadastro criado. Confirme pelo link enviado ao seu email e depois faca login.');
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
      setAuthError('Login com Google ainda nao foi ativado no Supabase. Use email e senha por enquanto.');
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
      setAccessRequestInfo('Nao foi possivel enviar o email. Verifique deploy/secrets da funcao.');
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
    flash('Devolucao registrada');
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
    const missingIds = ALL_EQUIPMENT
      .filter((item) => !studio.checks[item.id] || item.alert)
      .map((item) => item.id);

    const ts = Date.now();
    const record: ConferenceRecord = {
      id: newRecordId(),
      user: userName,
      ts,
      checkedIds,
      missingIds,
      notes: studio.notes.trim(),
    };

    setStudio((current) => ({
      ...current,
      conferences: [record, ...(current.conferences ?? [])].slice(0, 30),
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
        ...(current.notificationEvents ?? []),
      ].slice(0, 80),
    }));
    persist(() => addConference(record, userId));
    flash(missingIds.length ? 'Conferencia salva com pendencias' : 'Conferencia salva sem faltas');
  }

  function saveObservation() {
    if (!canManage || !isAuthed) return;
    const text = observationDraft.trim();
    if (!text) {
      flash('Escreva uma observacao antes de salvar');
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
    flash('Observacao salva e aviso registrado');
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

  // Upload de foto na secao de midia: guarda a foto e (se houver backend) envia para o Drive + email.
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
      flash('Nao foi possivel processar a foto');
    } finally {
      setMediaBusy(false);
    }
  }

  function removeMedia(id: string) {
    if (!canManage) return;
    setStudio((current) => ({ ...current, media: current.media.filter((item) => item.id !== id) }));
    persist(() => deleteMedia(id));
    flash('Midia removida');
  }

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
          <li>Toque no botao Compartilhar do Safari.</li>
          <li>Escolha "Adicionar a Tela de Inicio".</li>
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

  if (!isAuthed) {
    return (
      <main className="login-screen">
        <form className="login-card" onSubmit={handleEmailAuth}>
          <div className="logo-chip"><img src="/logo.png" alt="ASSEGO PM & BM" /></div>
          <p className="eyebrow">ASSEGO PM & BM</p>
          <h1>Controle do Estudio</h1>

          <div className="auth-tabs">
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => switchAuthMode('login')}>Entrar</button>
            <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => switchAuthMode('signup')}>Cadastrar-se</button>
          </div>

          {!supabaseConfigured && (
            <div className="login-error">Configuracao do Supabase pendente. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.</div>
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
            {GOOGLE_AUTH_ENABLED ? 'Entrar com Google' : 'Google em configuracao'}
          </button>

          <p className="login-foot">Novos cadastros entram como visualizacao ate um admin liberar retirada.</p>
        </form>
        {installFab}
        {iosModal}
      </main>
    );
  }

  return (
    <main className="wrap">
      <header className="topbar">
        <div className="logo-chip"><img src="/logo.png" alt="ASSEGO PM & BM" /></div>
        <div>
          <p className="eyebrow">ASSEGO PM & BM Estudio</p>
          <h1>Controle do Estudio</h1>
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
            Seu acesso esta como visualizacao. Um admin precisa liberar seu perfil para retirar equipamentos e salvar conferencias.
          </span>
          <button className="btn small" type="button" onClick={requestAccess} disabled={accessRequestBusy}>
            {accessRequestBusy ? 'Enviando...' : 'Pedir liberacao'}
          </button>
          {accessRequestInfo && <strong>{accessRequestInfo}</strong>}
        </div>
      )}

      <section className="grid">
        <article className="card">
          <div className="card-head">
            <h2>Camera ao vivo</h2>
            <span className="live-badge camera-rec">REC</span>
          </div>
          <div className="video-box camera-frame">
            <iframe
              title="Camera ao vivo"
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
                <span>ASSEGO ESTUDIO</span>
                <span>1080P · AUTO</span>
              </div>
              <span className="frame-corner tl" />
              <span className="frame-corner tr" />
              <span className="frame-corner bl" />
              <span className="frame-corner br" />
              <span className="focus-mark" />
            </div>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>Conferencia de equipamentos</h2>
            <div className="head-actions">
              <button className="btn ghost" type="button" onClick={resetChecklist} disabled={!canManage}>Zerar</button>
              <button className="btn" type="button" onClick={saveConference} disabled={!canManage}>Salvar conferencia</button>
            </div>
          </div>
          <div className="ready">
            <span>{checkedCount} / {ALL_EQUIPMENT.length} conferidos</span>
            <div className="meter"><div style={{ width: `${(checkedCount / ALL_EQUIPMENT.length) * 100}%` }} /></div>
            {outsideCount > 0 && <strong className="out-count">{outsideCount} equipamento(s) fora do estudio</strong>}
            <div className="conference-status">
              {lastConference ? (
                <>
                  <strong>Ultima conferencia: {lastConference.user} em {formatDateTime(lastConference.ts)}</strong>
                  <span>
                    {lastConference.missingIds.length
                      ? `Pendencias: ${lastConference.missingIds.map(equipmentName).join(', ')}`
                      : 'Sem equipamentos faltando.'}
                  </span>
                </>
              ) : (
                <>
                  <strong>Conferencia diaria ainda nao salva.</strong>
                  <span>Marque os itens presentes e salve para registrar seu nome nesta pagina.</span>
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
                            Foto obrigatoria do equipamento
                            <input type="file" accept="image/*" capture="environment" onChange={handleEquipmentPhoto} />
                            <span>Tire pelo celular ou envie uma imagem.</span>
                          </label>
                          {pendingEquipmentPhoto && <img className="equipment-photo preview" src={pendingEquipmentPhoto} alt="Previa da foto anexada" />}
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
            <label htmlFor="observationText">Observacoes</label>
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
                placeholder="Digite a observacao e aperte Enter para salvar"
              />
              <button className="btn" type="button" onClick={saveObservation} disabled={!canManage || !observationDraft.trim()}>Salvar</button>
            </div>
            <div className="observation-history">
              <h3>Historico de observacoes</h3>
              {(studio.observations ?? []).length === 0 ? (
                <p className="empty">Nenhuma observacao registrada ainda.</p>
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
      </section>

      <section className="card media-card">
        <div className="card-head">
          <h2>Fotos dos equipamentos</h2>
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
              <option value="geral">Geral do estudio</option>
              {ALL_EQUIPMENT.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Nome (opcional)
            <input value={mediaTitle} disabled={!canManage} onChange={(event) => setMediaTitle(event.target.value)} placeholder="Ex: camera com risco na lente" />
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
      </section>

      <footer>
        <span>{savedNote}</span>
      </footer>
      {installFab}
      {iosModal}
    </main>
  );
}
