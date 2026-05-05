/* ====================================================================
   GoldenPalm Admin Dashboard
   - PIN-protected lock screen (change ADMIN_PIN below)
   - Overview: stat cards + 7-day visitor bar chart
   - Visitors: daily unique visitor table
   - Users: all registered accounts
   - Orders: cart checkouts
   - Points: loyalty rewards outstanding
   - Messages: contact form submissions
   ==================================================================== */

/* ---- Change this PIN to something only you know ---- */
const ADMIN_PIN = '123456';

/* ---- DOM refs ---- */
const lockScreen  = document.getElementById('lockScreen');
const adminShell  = document.getElementById('adminShell');
const pinForm     = document.getElementById('pinForm');
const pinInput    = document.getElementById('pinInput');
const pinError    = document.getElementById('pinError');

/* ---- PIN auth ---- */
function isUnlocked() { return sessionStorage.getItem('gp.admin') === '1'; }

pinForm.addEventListener('submit', e => {
  e.preventDefault();
  if (pinInput.value === ADMIN_PIN) {
    sessionStorage.setItem('gp.admin', '1');
    showDashboard();
  } else {
    pinError.textContent = 'Incorrect PIN. Try again.';
    pinInput.value = '';
    pinInput.focus();
  }
});

document.getElementById('adminLogout').addEventListener('click', () => {
  sessionStorage.removeItem('gp.admin');
  location.reload();
});

if (isUnlocked()) showDashboard();
else { lockScreen.style.display = 'grid'; pinInput.focus(); }

function showDashboard() {
  lockScreen.hidden = true;
  adminShell.hidden = false;
  loadPanel('overview');
}

/* ---- Panel navigation ---- */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadPanel(btn.dataset.panel);
  });
});

async function loadPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.remove('hidden');

  if (name === 'overview') await renderOverview();
  else if (name === 'visitors') await renderVisitors();
  else if (name === 'users') await renderUsers();
  else if (name === 'orders') await renderOrders();
  else if (name === 'points') await renderPoints();
  else if (name === 'messages') await renderMessages();
}

/* ---- DB helpers ---- */
async function getAll(store) {
  if (!window.GP_DB) return [];
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('goldenpalm');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  if (!db.objectStoreNames.contains(store)) return [];
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

/* ---- Helpers ---- */
const fmt = n => '$' + Number(n || 0).toFixed(2);
const fmtDate = ts => {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const escH = s => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function buildTable(headers, rows, emptyMsg = 'No records yet.') {
  if (!rows.length) return `<div class="empty-state"><p>${emptyMsg}</p><span>Data will appear here once users interact with the site.</span></div>`;
  const ths = headers.map(h => `<th>${escH(h)}</th>`).join('');
  const trs = rows.map(cells => '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
  return `<div class="admin-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/* ---- OVERVIEW ---- */
async function renderOverview() {
  const [visits, accounts, orders, rewards] = await Promise.all([
    getAll('visits'), getAll('accounts'), getAll('orders'), getAll('rewards'),
  ]);

  const todayKey = dayKey();
  const todayVisitors = new Set(visits.filter(v => v.day === todayKey).map(v => v.fingerprint)).size;
  const totalPoints = rewards.reduce((s, r) => s + (r.points || 0), 0);

  document.getElementById('overviewStats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Today's visitors</span><span class="stat-value">${todayVisitors}</span><span class="stat-sub">unique sessions</span></div>
    <div class="stat-card"><span class="stat-label">Total users</span><span class="stat-value">${accounts.length}</span><span class="stat-sub">registered accounts</span></div>
    <div class="stat-card"><span class="stat-label">Orders</span><span class="stat-value">${orders.length}</span><span class="stat-sub">cart checkouts</span></div>
    <div class="stat-card"><span class="stat-label">Points outstanding</span><span class="stat-value">${totalPoints.toLocaleString()}</span><span class="stat-sub">≈ ${fmt(totalPoints / 20)} in discounts</span></div>
  `;

  // 7-day bar chart
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return dayKey(d.getTime());
  });
  const visitsByDay = {};
  visits.forEach(v => { if (!visitsByDay[v.day]) visitsByDay[v.day] = new Set(); visitsByDay[v.day].add(v.fingerprint); });
  const counts = last7.map(d => (visitsByDay[d] ? visitsByDay[d].size : 0));
  const maxCount = Math.max(...counts, 1);
  const barHeight = 100; // px available

  document.getElementById('visitorChart').innerHTML = counts.map((c, i) => {
    const dayLabel = last7[i].slice(5); // MM-DD
    const barPx = Math.round((c / maxCount) * (barHeight - 30));
    return `<div class="chart-bar-group" title="${c} visitor${c !== 1 ? 's' : ''} on ${last7[i]}">
      <span class="chart-bar-val">${c || ''}</span>
      <div class="chart-bar" style="height:${Math.max(barPx, 4)}px"></div>
      <span class="chart-bar-label">${dayLabel}</span>
    </div>`;
  }).join('');
}

/* ---- VISITORS ---- */
async function renderVisitors() {
  const visits = await getAll('visits');
  const byDay = {};
  visits.forEach(v => {
    if (!byDay[v.day]) byDay[v.day] = { hits: 0, fps: new Set(), users: new Set() };
    byDay[v.day].hits++;
    byDay[v.day].fps.add(v.fingerprint);
    if (v.userId) byDay[v.day].users.add(v.userId);
  });

  const rows = Object.entries(byDay)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 60)
    .map(([day, d]) => [
      `<strong>${day}</strong>`,
      `<span class="badge badge-gold">${d.fps.size}</span>`,
      d.hits,
      d.users.size > 0 ? `<span class="badge badge-green">${d.users.size}</span>` : '<span class="badge badge-muted">0</span>',
    ]);

  document.getElementById('visitorsTable').innerHTML = buildTable(
    ['Date', 'Unique Visitors', 'Total Page Hits', 'Signed-in Users'], rows, 'No visits recorded yet.'
  );
}

/* ---- USERS ---- */
async function renderUsers() {
  const accounts = await getAll('accounts');
  const rewards  = await getAll('rewards');
  const rewardMap = Object.fromEntries(rewards.map(r => [r.userId, r]));

  const rows = accounts
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .map(a => {
      const r = rewardMap[a.key] || {};
      const methodBadge = {
        email:  '<span class="badge badge-muted">Email</span>',
        phone:  '<span class="badge badge-green">Phone</span>',
        google: '<span class="badge badge-gold">Google</span>',
        apple:  '<span class="badge badge-orange">Apple</span>',
      }[a.method] || `<span class="badge badge-muted">${escH(a.method)}</span>`;
      return [
        escH(a.name || '—'),
        escH(a.email || a.phone || '—'),
        methodBadge,
        `<strong>${r.points || 0}</strong> pts`,
        `🔥 ${r.streak || 0}`,
        fmtDate(a.created_at),
      ];
    });

  document.getElementById('usersTable').innerHTML = buildTable(
    ['Name', 'Email / Phone', 'Method', 'Points', 'Streak', 'Joined'], rows, 'No users yet.'
  );
}

/* ---- ORDERS ---- */
async function renderOrders() {
  const orders = await getAll('orders');

  const rows = orders
    .sort((a, b) => (b.ts || b.created_at || 0) - (a.ts || a.created_at || 0))
    .map(o => {
      const itemList = (o.items || []).map(i => `${escH(i.name)} ×${i.qty}`).join(', ') || '—';
      const discount = o.discount ? `<span class="badge badge-orange">−${fmt(o.discount)}</span>` : '';
      return [
        `<code>${String(o.ts || o.created_at || 0).toString(36).toUpperCase().slice(-6)}</code>`,
        escH(o.customer_name || 'Guest'),
        `<span class="msg-body">${itemList}</span>`,
        fmt(o.subtotal),
        discount,
        `<strong>${fmt(o.total)}</strong>`,
        fmtDate(o.ts || o.created_at),
      ];
    });

  document.getElementById('ordersTable').innerHTML = buildTable(
    ['Order ID', 'Customer', 'Items', 'Subtotal', 'Discount', 'Total', 'Date'], rows, 'No orders yet.'
  );
}

/* ---- POINTS ---- */
async function renderPoints() {
  const rewards  = await getAll('rewards');
  const accounts = await getAll('accounts');
  const acctMap  = Object.fromEntries(accounts.map(a => [a.key, a]));

  const totalPts = rewards.reduce((s, r) => s + (r.points || 0), 0);
  const lifetimePts = rewards.reduce((s, r) => s + (r.lifetime_points || 0), 0);
  const maxStreak = Math.max(0, ...rewards.map(r => r.streak || 0));

  document.getElementById('pointsStats').innerHTML = `
    <div class="stat-card"><span class="stat-label">Points outstanding</span><span class="stat-value">${totalPts.toLocaleString()}</span><span class="stat-sub">≈ ${fmt(totalPts/20)} in discount liability</span></div>
    <div class="stat-card"><span class="stat-label">Lifetime issued</span><span class="stat-value">${lifetimePts.toLocaleString()}</span></div>
    <div class="stat-card"><span class="stat-label">Top streak</span><span class="stat-value">${maxStreak}🔥</span><span class="stat-sub">consecutive days</span></div>
  `;

  const rows = rewards
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .map(r => {
      const a = acctMap[r.userId] || {};
      return [
        escH(a.name || '—'),
        escH(a.email || a.phone || r.userId || '—'),
        `<strong style="color:var(--gold-400)">${r.points || 0}</strong>`,
        r.lifetime_points || 0,
        `🔥 ${r.streak || 0}`,
        r.last_checkin || '—',
      ];
    });

  document.getElementById('pointsTable').innerHTML = buildTable(
    ['Name', 'Account', 'Points', 'Lifetime', 'Streak', 'Last check-in'], rows, 'No rewards data yet.'
  );
}

/* ---- MESSAGES ---- */
async function renderMessages() {
  const messages = await getAll('contacts');

  const rows = messages
    .sort((a, b) => (b.created_at || b.ts || 0) - (a.created_at || a.ts || 0))
    .map(m => [
      escH(m.name || '—'),
      `<a href="mailto:${escH(m.email)}">${escH(m.email)}</a>`,
      `<span class="msg-body">${escH(m.message)}</span>`,
      fmtDate(m.created_at || m.ts),
    ]);

  document.getElementById('messagesTable').innerHTML = buildTable(
    ['Name', 'Email', 'Message', 'Date'], rows, 'No contact messages yet.'
  );
}

/* Add refresh button to each panel */
document.querySelectorAll('.panel').forEach(p => {
  const id = p.id.replace('panel-', '');
  const div = document.createElement('div');
  div.className = 'panel-actions';
  div.innerHTML = `<button class="btn-refresh" data-refresh="${id}">↻ Refresh</button>`;
  p.insertBefore(div, p.querySelector('h2').nextSibling);
});
document.querySelectorAll('[data-refresh]').forEach(btn => {
  btn.addEventListener('click', () => loadPanel(btn.dataset.refresh));
});
