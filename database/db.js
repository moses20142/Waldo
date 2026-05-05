/**
 * GoldenPalm — Database client (local-first)
 *
 * Stores everything in IndexedDB by default. When SUPABASE_URL +
 * SUPABASE_ANON_KEY are set on window.GP_CONFIG, mirrors writes
 * to Supabase too.
 */

const DB_NAME = 'goldenpalm';
const DB_VERSION = 2;
const STORES = {
  orders:          { keyPath: 'id', autoIncrement: true },
  contacts:        { keyPath: 'id', autoIncrement: true },
  security_events: { keyPath: 'id', autoIncrement: true },
  accounts:        { keyPath: 'key' },
  visits:          { keyPath: 'id', autoIncrement: true },
  rewards:         { keyPath: 'userId' },
};

/* ----- Rewards configuration ----- */
const POINTS_PER_CHECKIN = 10;
const STREAK_BONUS_PER_DAY = 5;
const STREAK_BONUS_CAP = 25;
const POINTS_PER_DOLLAR = 20;          // 100 pts = $5
const SIGNUP_BONUS = 50;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      Object.entries(STORES).forEach(([name, opts]) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; }).catch(rej);
    t.oncomplete = () => res(result);
    t.onerror = () => rej(t.error);
  });
}

function reqPromise(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* ----- Remote (optional) ----- */
async function remoteInsert(table, payload) {
  const cfg = window.GP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': cfg.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${cfg.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`DB ${table}: ${res.status}`);
  return res.json();
}

/* ----- Date helpers ----- */
function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  const ms = 86_400_000;
  return Math.floor((new Date(dayKey(b)).getTime() - new Date(dayKey(a)).getTime()) / ms);
}

/* ----- Visitor fingerprint (anonymous, client-side only) ----- */
function getFingerprint() {
  let fp = localStorage.getItem('gp.fp');
  if (!fp) {
    fp = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) +
         '-' + Date.now().toString(36);
    localStorage.setItem('gp.fp', fp);
  }
  return fp;
}

/* ----- Session helpers ----- */
function getSession() {
  try { return JSON.parse(localStorage.getItem('gp.session') || 'null'); }
  catch { return null; }
}
function clearSession() { localStorage.removeItem('gp.session'); }

/* ====================================================================
   Public API
   ==================================================================== */
const GP_DB = {
  config: { POINTS_PER_CHECKIN, STREAK_BONUS_PER_DAY, STREAK_BONUS_CAP, POINTS_PER_DOLLAR, SIGNUP_BONUS },

  getSession,
  clearSession,
  getFingerprint,
  dayKey,

  async saveContact(data) {
    try { const r = await remoteInsert('contact_messages', data); if (r) return r; } catch {}
    return tx('contacts', 'readwrite', s => reqPromise(s.add({ ...data, created_at: Date.now() })));
  },

  async saveOrder(data) {
    try { const r = await remoteInsert('orders', data); if (r) return r; } catch {}
    return tx('orders', 'readwrite', s => reqPromise(s.add({ ...data, created_at: Date.now() })));
  },

  async logSecurityEvent(eventType, metadata = {}) {
    const data = { event_type: eventType, metadata, ts: Date.now() };
    try { await remoteInsert('security_events', data); } catch {}
    return tx('security_events', 'readwrite', s => reqPromise(s.add(data)));
  },

  /* ----- Visit tracking ----- */
  async recordVisit(path = location.pathname) {
    const session = getSession();
    const data = {
      userId: session?.id || null,
      fingerprint: getFingerprint(),
      path,
      day: dayKey(),
      ts: Date.now(),
    };
    try { await remoteInsert('visits', data); } catch {}
    return tx('visits', 'readwrite', s => reqPromise(s.add(data)));
  },

  async dailyVisitorCount(day = dayKey()) {
    return tx('visits', 'readonly', async s => {
      const all = await reqPromise(s.getAll());
      const seen = new Set();
      all.forEach(v => { if (v.day === day) seen.add(v.fingerprint); });
      return seen.size;
    });
  },

  /* ----- Rewards / daily check-in ----- */
  async getRewards(userId) {
    if (!userId) return null;
    const r = await tx('rewards', 'readonly', s => reqPromise(s.get(userId)));
    return r || { userId, points: 0, lifetime_points: 0, streak: 0, last_checkin: null };
  },

  async signupBonus(userId) {
    return tx('rewards', 'readwrite', async s => {
      const existing = await reqPromise(s.get(userId));
      if (existing) return existing;
      const fresh = {
        userId,
        points: SIGNUP_BONUS,
        lifetime_points: SIGNUP_BONUS,
        streak: 0,
        last_checkin: null,
        created_at: Date.now(),
      };
      await reqPromise(s.put(fresh));
      return fresh;
    });
  },

  async checkIn(userId) {
    if (!userId) return null;
    return tx('rewards', 'readwrite', async s => {
      const existing = (await reqPromise(s.get(userId))) || {
        userId, points: 0, lifetime_points: 0, streak: 0, last_checkin: null, created_at: Date.now(),
      };

      const today = dayKey();
      if (existing.last_checkin === today) {
        return { ...existing, alreadyCheckedIn: true, awarded: 0 };
      }

      const gap = existing.last_checkin
        ? daysBetween(new Date(existing.last_checkin).getTime(), Date.now())
        : null;

      const newStreak = (gap === 1) ? existing.streak + 1 : 1;
      const streakBonus = Math.min(STREAK_BONUS_PER_DAY * (newStreak - 1), STREAK_BONUS_CAP);
      const awarded = POINTS_PER_CHECKIN + streakBonus;

      const updated = {
        ...existing,
        points: existing.points + awarded,
        lifetime_points: existing.lifetime_points + awarded,
        streak: newStreak,
        last_checkin: today,
        last_checkin_ts: Date.now(),
      };
      await reqPromise(s.put(updated));
      return { ...updated, alreadyCheckedIn: false, awarded, streakBonus };
    });
  },

  async redeemPoints(userId, pointsToSpend) {
    if (!userId) return null;
    return tx('rewards', 'readwrite', async s => {
      const r = await reqPromise(s.get(userId));
      if (!r || r.points < pointsToSpend) return { ok: false, reason: 'insufficient' };
      r.points -= pointsToSpend;
      r.last_redeem_ts = Date.now();
      await reqPromise(s.put(r));
      return { ok: true, points: r.points, dollarsOff: pointsToSpend / POINTS_PER_DOLLAR };
    });
  },

  pointsToDollars(points) { return points / POINTS_PER_DOLLAR; },
  dollarsToPoints(dollars) { return Math.ceil(dollars * POINTS_PER_DOLLAR); },

  async listOrders() { return tx('orders', 'readonly', s => reqPromise(s.getAll())); },
  async listContacts() { return tx('contacts', 'readonly', s => reqPromise(s.getAll())); },
  async listVisits() { return tx('visits', 'readonly', s => reqPromise(s.getAll())); },
};

window.GP_DB = GP_DB;
