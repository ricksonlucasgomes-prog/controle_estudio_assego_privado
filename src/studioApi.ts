import { edgeFunctionUrl, supabase } from './supabase';

export type Checkout = {
  user: string;
  userId?: string;
  userEmail?: string;
  ts: number;
  qty: number;
  photo?: string;
  justification?: string;
};

export type MediaItem = {
  id: string;
  equipmentId: string;
  title: string;
  photo?: string;
  url?: string;
  addedBy: string;
  ts: number;
  syncStatus?: 'local' | 'sent' | 'error';
};

export type ConferenceRecord = {
  id: string;
  user: string;
  ts: number;
  checkedIds: string[];
  missingIds: string[];
  notes: string;
};

export type ObservationRecord = {
  id: string;
  user: string;
  ts: number;
  text: string;
};

export type NotificationEvent = {
  id: string;
  type: 'login' | 'equipment_checkout' | 'observation' | 'conference' | 'media_photo';
  recipients: string[];
  payload: Record<string, unknown>;
  createdAt: number;
  sentAt?: number;
};

export type StudioState = {
  checks: Record<string, boolean>;
  checkouts: Record<string, Checkout>;
  notes: string;
  driveFolder: string;
  media: MediaItem[];
  conferences: ConferenceRecord[];
  observations: ObservationRecord[];
  notificationEvents: NotificationEvent[];
};

export const STUDIO_KEY = 'assego-studio-state-v2';
export const DEFAULT_DRIVE_FOLDER = 'https://drive.google.com/drive/u/0/folders/18cH79GjFKmY4RcAW8ngFlnd_0EEBxU7U';

export const emptyStudioState: StudioState = {
  checks: {},
  checkouts: {},
  notes: '',
  driveFolder: DEFAULT_DRIVE_FOLDER,
  media: [],
  conferences: [],
  observations: [],
  notificationEvents: [],
};

function readLocalStudio(): StudioState {
  try {
    const raw = window.localStorage.getItem(STUDIO_KEY);
    return raw ? { ...emptyStudioState, ...JSON.parse(raw) } : emptyStudioState;
  } catch {
    return emptyStudioState;
  }
}

export function writeLocalStudio(value: StudioState) {
  window.localStorage.setItem(STUDIO_KEY, JSON.stringify(value));
}

function toTs(value: string | null | undefined) {
  return value ? new Date(value).getTime() : Date.now();
}

async function selectOrThrow<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

type CheckoutRow = {
  item_id: string;
  user_name: string;
  user_id: string | null;
  user_email?: string | null;
  qty: number;
  photo: string | null;
  justification?: string | null;
  taken_at: string;
};

function isLegacyCheckoutSchema(message: string) {
  const mentionsOptionalColumn = /(user_email|justification)/i.test(message);
  const reportsMissingSchema = /(studio_checkouts|column|schema cache|could not find)/i.test(message);
  return mentionsOptionalColumn && reportsMissingSchema;
}

async function loadCheckoutRows(): Promise<CheckoutRow[]> {
  if (!supabase) return [];
  const modern = await supabase
    .from('studio_checkouts')
    .select('item_id, user_name, user_id, user_email, qty, photo, justification, taken_at');

  if (!modern.error) return (modern.data ?? []) as CheckoutRow[];
  if (!isLegacyCheckoutSchema(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase
    .from('studio_checkouts')
    .select('item_id, user_name, user_id, qty, photo, taken_at');
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []) as CheckoutRow[];
}

export async function loadStudio(): Promise<StudioState> {
  const local = readLocalStudio();
  if (!supabase) return local;

  try {
    const [checklist, checkouts, observations, conferences, media] = await Promise.all([
      selectOrThrow<Array<{ item_id: string; checked: boolean }>>(supabase.from('studio_checklist').select('item_id, checked')),
      loadCheckoutRows(),
      selectOrThrow<Array<{ id: string; author: string; body: string; created_at: string }>>(
        supabase.from('studio_observations').select('id, author, body, created_at').order('created_at', { ascending: false }).limit(80),
      ),
      selectOrThrow<Array<{ id: string; author: string; checked_ids: string[] | null; missing_ids: string[] | null; notes: string | null; created_at: string }>>(
        supabase.from('studio_conferences').select('id, author, checked_ids, missing_ids, notes, created_at').order('created_at', { ascending: false }).limit(30),
      ),
      selectOrThrow<Array<{ id: string; equipment_id: string; title: string; photo: string | null; added_by: string | null; created_at: string }>>(
        supabase.from('studio_media').select('id, equipment_id, title, photo, added_by, created_at').order('created_at', { ascending: false }),
      ),
    ]);

    return {
      ...emptyStudioState,
      ...local,
      checks: Object.fromEntries((checklist ?? []).map((item) => [item.item_id, item.checked])),
      checkouts: Object.fromEntries((checkouts ?? []).map((item) => [item.item_id, {
        user: item.user_name,
        userId: item.user_id ?? undefined,
        userEmail: item.user_email ?? undefined,
        qty: item.qty,
        photo: item.photo ?? undefined,
        justification: item.justification ?? undefined,
        ts: toTs(item.taken_at),
      }])),
      observations: (observations ?? []).map((item) => ({
        id: item.id,
        user: item.author,
        text: item.body,
        ts: toTs(item.created_at),
      })),
      conferences: (conferences ?? []).map((item) => ({
        id: item.id,
        user: item.author,
        checkedIds: item.checked_ids ?? [],
        missingIds: item.missing_ids ?? [],
        notes: item.notes ?? '',
        ts: toTs(item.created_at),
      })),
      media: (media ?? []).map((item) => ({
        id: item.id,
        equipmentId: item.equipment_id,
        title: item.title,
        photo: item.photo ?? undefined,
        addedBy: item.added_by ?? 'Equipe',
        ts: toTs(item.created_at),
      })),
    };
  } catch (error) {
    console.warn('Falha ao carregar dados compartilhados do estudio.', error);
    return local;
  }
}

export async function setCheck(itemId: string, checked: boolean, userId: string) {
  if (!supabase) return;
  const { error } = await supabase.from('studio_checklist').upsert({
    item_id: itemId,
    checked,
    updated_by: userId || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function resetChecks(itemIds: string[], userId: string) {
  if (!supabase) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from('studio_checklist').upsert(
    itemIds.map((itemId) => ({ item_id: itemId, checked: false, updated_by: userId || null, updated_at: now })),
  );
  if (error) throw new Error(error.message);
}

export async function upsertCheckout(itemId: string, checkout: Checkout) {
  if (!supabase) return;
  const modernPayload = {
    item_id: itemId,
    user_name: checkout.user,
    user_id: checkout.userId ?? null,
    user_email: checkout.userEmail ?? null,
    qty: checkout.qty,
    photo: checkout.photo ?? null,
    justification: checkout.justification ?? null,
    taken_at: new Date(checkout.ts).toISOString(),
  };
  const { error } = await supabase.from('studio_checkouts').upsert(modernPayload);
  if (!error) return;
  if (!isLegacyCheckoutSchema(error.message)) throw new Error(error.message);

  const { user_email: _userEmail, justification: _justification, ...legacyPayload } = modernPayload;
  const legacy = await supabase.from('studio_checkouts').upsert(legacyPayload);
  if (legacy.error) throw new Error(legacy.error.message);
}

export async function deleteCheckout(itemId: string) {
  if (!supabase) return;
  const { error } = await supabase.from('studio_checkouts').delete().eq('item_id', itemId);
  if (error) throw new Error(error.message);
}

export async function addObservation(record: ObservationRecord, userId: string) {
  if (!supabase) return;
  const { error } = await supabase.from('studio_observations').insert({
    id: record.id,
    author: record.user,
    author_id: userId || null,
    body: record.text,
    created_at: new Date(record.ts).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function addConference(record: ConferenceRecord, userId: string) {
  if (!supabase) return;
  const { error } = await supabase.from('studio_conferences').insert({
    id: record.id,
    author: record.user,
    author_id: userId || null,
    checked_ids: record.checkedIds,
    missing_ids: record.missingIds,
    notes: record.notes,
    created_at: new Date(record.ts).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function addMedia(record: MediaItem, userId: string) {
  if (!supabase) return;
  const { error } = await supabase.from('studio_media').insert({
    id: record.id,
    equipment_id: record.equipmentId,
    title: record.title,
    photo: record.photo ?? null,
    added_by: record.addedBy,
    added_by_id: userId || null,
    created_at: new Date(record.ts).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteMedia(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from('studio_media').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
// Agendamento do estúdio (avaliação pela diretoria/admin)
// ---------------------------------------------------------------------

export type BookingStatus = 'requested' | 'approved' | 'rejected' | 'cancelled';

export type AppNotification = {
  id: string;
  type: 'booking_created' | 'booking_approved' | 'booking_rejected';
  title: string;
  message: string;
  booking_request_id: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type BookingParticipant = {
  id: string;
  full_name: string;
  email: string | null;
  whatsapp: string | null;
  social: string | null;
};

export type BookingRequest = {
  id: string;
  requester_name: string;
  requester_email: string | null;
  requester_whatsapp: string | null;
  requester_social: string | null;
  requested_date: string | null;
  requested_time: string | null;
  requested_end_time: string | null;
  status: BookingStatus;
  created_at: string;
  participants: BookingParticipant[];
};

// Lista as solicitações com os participantes aninhados. Só admin recebe
// tudo (RLS): booking_req_select_own_or_admin + booking_part_select_own_or_admin.
export async function listBookingRequests(): Promise<BookingRequest[]> {
  if (!supabase) return [];
  const rows = await selectOrThrow<Array<Record<string, unknown>>>(
    supabase
      .from('studio_booking_requests')
      .select(
        'id, requester_name, requester_email, requester_whatsapp, requester_social, requested_date, requested_time, requested_end_time, status, created_at, studio_booking_participants(id, full_name, email, whatsapp, social)',
      )
      .order('created_at', { ascending: false })
      .limit(100),
  );
  return (rows ?? []).map((row) => ({
    ...(row as Omit<BookingRequest, 'participants'>),
    participants: ((row.studio_booking_participants as BookingParticipant[]) ?? []),
  }));
}

export async function updateBookingStatus(
  id: string,
  status: Extract<BookingStatus, 'approved' | 'rejected'>,
): Promise<{ notificationStatus: string; calendarStatus: string }> {
  if (!supabase) throw new Error('Banco de dados não configurado.');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Faça login novamente.');

  const response = await fetch(edgeFunctionUrl('decide-booking'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ bookingId: id, status }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a decisão.');
  return {
    notificationStatus: result.notification_status ?? 'unknown',
    calendarStatus: result.calendar_status ?? 'skipped',
  };
}

export async function listAppNotifications(): Promise<AppNotification[]> {
  if (!supabase) return [];
  return await selectOrThrow<AppNotification[]>(
    supabase
      .from('app_notifications')
      .select('id, type, title, message, booking_request_id, metadata, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ) ?? [];
}

export async function markAppNotificationRead(id: string): Promise<void> {
  if (!supabase) throw new Error('Banco de dados não configurado.');
  const { error } = await supabase
    .from('app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

export async function markAllAppNotificationsRead(): Promise<void> {
  if (!supabase) throw new Error('Banco de dados não configurado.');
  const { error } = await supabase
    .from('app_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
// Pedido de equipamento por quem não é admin/borrower (RLS restringe
// aprovar/rejeitar ao aprovador único; ver supabase/equipment_access.sql).
// ---------------------------------------------------------------------

export type EquipmentRequestStatus = 'requested' | 'approved' | 'rejected';

export type EquipmentRequest = {
  id: string;
  requester_name: string;
  requester_email: string | null;
  equipment_id: string;
  equipment_name: string;
  justification: string;
  status: EquipmentRequestStatus;
  created_at: string;
};

export async function listEquipmentRequests(): Promise<EquipmentRequest[]> {
  if (!supabase) return [];
  const rows = await selectOrThrow<EquipmentRequest[]>(
    supabase
      .from('studio_equipment_requests')
      .select('id, requester_name, requester_email, equipment_id, equipment_name, justification, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
  );
  return rows ?? [];
}

export async function updateEquipmentRequestStatus(
  id: string,
  status: Extract<EquipmentRequestStatus, 'approved' | 'rejected'>,
) {
  if (!supabase) throw new Error('Banco de dados não configurado.');
  const { error } = await supabase.rpc('set_equipment_request_status_v1', {
    p_id: id,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}
