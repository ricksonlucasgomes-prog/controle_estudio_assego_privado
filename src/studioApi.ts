import { supabase } from './supabase';

export type Checkout = {
  user: string;
  userId?: string;
  ts: number;
  qty: number;
  photo?: string;
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

export async function loadStudio(): Promise<StudioState> {
  const local = readLocalStudio();
  if (!supabase) return local;

  try {
    const [checklist, checkouts, observations, conferences, media] = await Promise.all([
      selectOrThrow<Array<{ item_id: string; checked: boolean }>>(supabase.from('studio_checklist').select('item_id, checked')),
      selectOrThrow<Array<{ item_id: string; user_name: string; user_id: string | null; qty: number; photo: string | null; taken_at: string }>>(
        supabase.from('studio_checkouts').select('item_id, user_name, user_id, qty, photo, taken_at'),
      ),
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
        qty: item.qty,
        photo: item.photo ?? undefined,
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
  const { error } = await supabase.from('studio_checkouts').upsert({
    item_id: itemId,
    user_name: checkout.user,
    user_id: checkout.userId ?? null,
    qty: checkout.qty,
    photo: checkout.photo ?? null,
    taken_at: new Date(checkout.ts).toISOString(),
  });
  if (error) throw new Error(error.message);
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

export type BookingParticipant = {
  id: string;
  full_name: string;
  rg: string | null;
  cpf: string | null;
  email: string | null;
  whatsapp: string | null;
  social: string | null;
};

export type BookingRequest = {
  id: string;
  requester_name: string;
  requester_rg: string | null;
  requester_cpf: string | null;
  requester_email: string | null;
  requester_whatsapp: string | null;
  requester_social: string | null;
  requested_date: string | null;
  requested_time: string | null;
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
        'id, requester_name, requester_rg, requester_cpf, requester_email, requester_whatsapp, requester_social, requested_date, requested_time, status, created_at, studio_booking_participants(id, full_name, rg, cpf, email, whatsapp, social)',
      )
      .order('created_at', { ascending: false })
      .limit(100),
  );
  return (rows ?? []).map((row) => ({
    ...(row as Omit<BookingRequest, 'participants'>),
    participants: ((row.studio_booking_participants as BookingParticipant[]) ?? []),
  }));
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  if (!supabase) throw new Error('Banco de dados não configurado.');
  const { error } = await supabase.from('studio_booking_requests').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
}
