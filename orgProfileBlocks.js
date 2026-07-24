/**
 * Organisatie-profielblokken: gedeelde types, validatie en openingstijden-status.
 */

const ORG_PROFILE_BLOCK_TYPES = [
  'opening_hours',
  'service_schedule',
  'match_schedule',
  'membership',
  'facilities',
  'team',
  'links',
  'notice',
];

const BLOCK_TYPE_LABELS = {
  opening_hours: 'Openingstijden',
  service_schedule: 'Diensten / vieringen',
  match_schedule: 'Speelschema',
  membership: 'Lidmaatschap',
  facilities: 'Voorzieningen',
  team: 'Team / bestuur',
  links: 'Handige links',
  notice: 'Mededeling',
};

const WEEKDAY_LABELS = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
/** Weergavevolgorde: maandag t/m zondag (day-index 0 = zondag blijft in data). */
const WEEKDAY_ORDER_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

const CATEGORY_BLOCK_SUGGESTIONS = {
  horeca: ['opening_hours', 'notice', 'links', 'facilities'],
  ondernemer: ['opening_hours', 'notice', 'links', 'facilities'],
  sport: ['match_schedule', 'membership', 'facilities', 'team', 'links'],
  kerk: ['service_schedule', 'notice', 'links'],
  muziek: ['service_schedule', 'membership', 'links', 'notice'],
  vereniging: ['service_schedule', 'membership', 'team', 'links', 'notice'],
  stichting: ['facilities', 'team', 'links', 'notice'],
  default: ['notice', 'links', 'facilities'],
};

function isAllowedBlockType(type) {
  return ORG_PROFILE_BLOCK_TYPES.includes(String(type || '').trim());
}

function defaultTitleForType(type) {
  return BLOCK_TYPE_LABELS[type] || 'Profielblok';
}

function defaultDataForType(type) {
  switch (type) {
    case 'opening_hours':
      return {
        note: '',
        always_open: false,
        days: WEEKDAY_ORDER_MONDAY_FIRST.map((day) => ({
          day,
          closed: day === 0,
          open: '09:00',
          close: '17:00',
        })),
        exceptions: [],
      };
    case 'service_schedule':
      return { items: [{ weekday: 0, time: '10:00', title: '', location: '', note: '' }] };
    case 'match_schedule':
      return { items: [{ date: '', time: '', opponent: '', location: '', is_home: true, competition: '' }] };
    case 'membership':
      return { intro: '', fee: '', contact: '', signup_url: '', items: [] };
    case 'facilities':
      return { items: [{ label: '', text: '' }] };
    case 'team':
      return { items: [{ name: '', role: '', note: '' }] };
    case 'links':
      return { items: [{ label: '', url: '', icon: 'link' }] };
    case 'notice':
      return { text: '', until: '' };
    default:
      return {};
  }
}

function parseJsonData(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function timeToMinutes(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function getAmsterdamNowParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  return {
    weekday: weekdayMap[parts.weekday] ?? 0,
    minutes: hour * 60 + minute,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function computeOpeningHoursStatus(data) {
  const parsed = parseJsonData(data);
  if (parsed.always_open) {
    return {
      is_open: true,
      label: 'Altijd open',
      detail: '24 uur per dag',
      closes_at: null,
      opens_at: null,
    };
  }
  const now = getAmsterdamNowParts();
  const exceptions = Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
  const todayException = exceptions.find((ex) => ex && ex.date === now.dateKey);
  if (todayException) {
    if (todayException.closed) {
      return {
        is_open: false,
        label: 'Vandaag gesloten',
        detail: todayException.label || null,
        closes_at: null,
        opens_at: null,
      };
    }
    const openM = timeToMinutes(todayException.open);
    const closeM = timeToMinutes(todayException.close);
    if (openM != null && closeM != null) {
      const isOpen = now.minutes >= openM && now.minutes < closeM;
      return {
        is_open: isOpen,
        label: isOpen ? 'Nu open' : 'Gesloten',
        detail: todayException.label || null,
        closes_at: isOpen ? todayException.close : null,
        opens_at: !isOpen && now.minutes < openM ? todayException.open : null,
      };
    }
  }

  const days = Array.isArray(parsed.days) ? parsed.days : [];
  const today = days.find((d) => d && Number(d.day) === now.weekday);
  if (!today || today.closed) {
    return { is_open: false, label: 'Gesloten', detail: null, closes_at: null, opens_at: null };
  }
  const openM = timeToMinutes(today.open);
  const closeM = timeToMinutes(today.close);
  if (openM == null || closeM == null) {
    return { is_open: false, label: 'Gesloten', detail: null, closes_at: null, opens_at: null };
  }
  const breakStart = timeToMinutes(today.break_start);
  const breakEnd = timeToMinutes(today.break_end);
  let isOpen = now.minutes >= openM && now.minutes < closeM;
  if (isOpen && breakStart != null && breakEnd != null && now.minutes >= breakStart && now.minutes < breakEnd) {
    isOpen = false;
  }
  return {
    is_open: isOpen,
    label: isOpen ? 'Nu open' : 'Gesloten',
    detail: null,
    closes_at: isOpen ? today.close : null,
    opens_at: !isOpen && now.minutes < openM ? today.open : null,
  };
}

function normalizeBlockData(type, data) {
  const base = defaultDataForType(type);
  const raw = parseJsonData(data);
  switch (type) {
    case 'opening_hours': {
      const daysIn = Array.isArray(raw.days) ? raw.days : [];
      const days = [];
      for (const day of WEEKDAY_ORDER_MONDAY_FIRST) {
        const found = daysIn.find((d) => Number(d?.day) === day);
        if (found) {
          days.push({
            day,
            closed: !!found.closed,
            open: found.open ? String(found.open).slice(0, 5) : '09:00',
            close: found.close ? String(found.close).slice(0, 5) : '17:00',
            break_start: found.break_start ? String(found.break_start).slice(0, 5) : null,
            break_end: found.break_end ? String(found.break_end).slice(0, 5) : null,
          });
        } else {
          days.push({ day, closed: true });
        }
      }
      return {
        note: raw.note ? String(raw.note).trim().slice(0, 500) : '',
        always_open: !!raw.always_open,
        days,
        exceptions: (Array.isArray(raw.exceptions) ? raw.exceptions : []).slice(0, 30).map((ex) => ({
          date: ex?.date ? String(ex.date).slice(0, 10) : '',
          closed: !!ex?.closed,
          open: ex?.open ? String(ex.open).slice(0, 5) : null,
          close: ex?.close ? String(ex.close).slice(0, 5) : null,
          label: ex?.label ? String(ex.label).trim().slice(0, 120) : '',
        })).filter((ex) => ex.date),
      };
    }
    case 'service_schedule':
      return {
        items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).map((it) => ({
          weekday: Math.min(6, Math.max(0, parseInt(it?.weekday, 10) || 0)),
          time: it?.time ? String(it.time).slice(0, 5) : '',
          title: it?.title ? String(it.title).trim().slice(0, 120) : '',
          location: it?.location ? String(it.location).trim().slice(0, 200) : '',
          note: it?.note ? String(it.note).trim().slice(0, 300) : '',
        })).filter((it) => it.title || it.time),
      };
    case 'match_schedule':
      return {
        items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 60).map((it) => ({
          date: it?.date ? String(it.date).slice(0, 10) : '',
          time: it?.time ? String(it.time).slice(0, 5) : '',
          opponent: it?.opponent ? String(it.opponent).trim().slice(0, 120) : '',
          location: it?.location ? String(it.location).trim().slice(0, 200) : '',
          is_home: it?.is_home !== false,
          competition: it?.competition ? String(it.competition).trim().slice(0, 80) : '',
        })).filter((it) => it.date && (it.opponent || it.time)),
      };
    case 'membership':
      return {
        intro: raw.intro ? String(raw.intro).trim().slice(0, 1000) : '',
        fee: raw.fee ? String(raw.fee).trim().slice(0, 200) : '',
        contact: raw.contact ? String(raw.contact).trim().slice(0, 200) : '',
        signup_url: raw.signup_url ? String(raw.signup_url).trim().slice(0, 500) : '',
        items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 20).map((it) => ({
          label: it?.label ? String(it.label).trim().slice(0, 80) : '',
          value: it?.value ? String(it.value).trim().slice(0, 200) : '',
        })).filter((it) => it.label),
      };
    case 'facilities':
      return {
        items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 25).map((it) => ({
          label: it?.label ? String(it.label).trim().slice(0, 80) : '',
          text: it?.text ? String(it.text).trim().slice(0, 300) : '',
        })).filter((it) => it.label),
      };
    case 'team':
      return {
        items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).map((it) => ({
          name: it?.name ? String(it.name).trim().slice(0, 80) : '',
          role: it?.role ? String(it.role).trim().slice(0, 80) : '',
          note: it?.note ? String(it.note).trim().slice(0, 200) : '',
        })).filter((it) => it.name),
      };
    case 'links':
      return {
        items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 15).map((it) => ({
          label: it?.label ? String(it.label).trim().slice(0, 80) : '',
          url: it?.url ? String(it.url).trim().slice(0, 500) : '',
          icon: it?.icon ? String(it.icon).trim().slice(0, 40) : 'link',
        })).filter((it) => it.label && it.url),
      };
    case 'notice':
      return {
        text: raw.text ? String(raw.text).trim().slice(0, 500) : '',
        until: raw.until ? String(raw.until).slice(0, 10) : '',
      };
    default:
      return base;
  }
}

function mapBlockRow(row, { includeStatus = false } = {}) {
  const blockType = row.block_type;
  const data = parseJsonData(row.data_json);
  const out = {
    id: row.id,
    block_type: blockType,
    title: row.title,
    data,
    sort_order: row.sort_order ?? 0,
    is_visible: row.is_visible !== false && row.is_visible !== 0,
  };
  if (includeStatus && blockType === 'opening_hours') {
    out.opening_status = computeOpeningHoursStatus(data);
  }
  return out;
}

function isNoticeExpired(data) {
  const until = parseJsonData(data)?.until;
  if (!until || typeof until !== 'string') return false;
  const today = getAmsterdamNowParts().dateKey;
  return until.slice(0, 10) < today;
}

function enrichBlocksForPublic(rows) {
  return (rows || [])
    .filter((row) => {
      if (row?.block_type !== 'notice') return true;
      const data = parseJsonData(row.data_json);
      return !isNoticeExpired(data);
    })
    .map((row) => mapBlockRow(row, { includeStatus: true }));
}

function suggestedTypesForCategory(category) {
  const key = String(category || '').trim().toLowerCase();
  return CATEGORY_BLOCK_SUGGESTIONS[key] || CATEGORY_BLOCK_SUGGESTIONS.default;
}

module.exports = {
  ORG_PROFILE_BLOCK_TYPES,
  BLOCK_TYPE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER_MONDAY_FIRST,
  CATEGORY_BLOCK_SUGGESTIONS,
  isAllowedBlockType,
  defaultTitleForType,
  defaultDataForType,
  normalizeBlockData,
  parseJsonData,
  computeOpeningHoursStatus,
  enrichBlocksForPublic,
  mapBlockRow,
  suggestedTypesForCategory,
};
