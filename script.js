// ---------- Visit tracking + session-aware UI (runs first) ----------
(async function initSessionAndVisits() {
  if (!window.GP_DB) return;

  GP_DB.recordVisit().catch(() => {});

  const session = GP_DB.getSession();
  if (!session) return;

  const rewards = await GP_DB.getRewards(session.id);
  renderUserPill(session, rewards);
  renderRewardsStrip(session, rewards);
})();

function renderUserPill(session, rewards) {
  const navList = document.getElementById('navLinks');
  if (!navList) return;
  // Replace the "Sign in" CTA with a logged-in pill
  const cta = navList.querySelector('.nav-cta');
  if (!cta) return;
  const li = cta.parentElement;
  li.innerHTML = `
    <div class="user-pill" role="group" aria-label="Account">
      <a href="account.html" class="user-pill-name" aria-label="View account">
        <span class="user-avatar" aria-hidden="true">${(session.name || 'U').slice(0,1).toUpperCase()}</span>
        <span class="user-name-text">${escapeText(session.name || 'Account')}</span>
      </a>
      <span class="user-pill-pts" title="Reward points">${rewards.points} pts</span>
      <button class="user-logout" type="button" aria-label="Sign out">↪</button>
    </div>`;
  li.querySelector('.user-logout').addEventListener('click', () => {
    GP_DB.clearSession();
    location.reload();
  });
}

function renderRewardsStrip(session, rewards) {
  const main = document.getElementById('main');
  if (!main) return;
  const today = GP_DB.dayKey();
  const checkedIn = rewards.last_checkin === today;
  const dollarsAvailable = GP_DB.pointsToDollars(rewards.points).toFixed(2);

  const strip = document.createElement('aside');
  strip.className = 'rewards-strip';
  strip.setAttribute('aria-label', 'Your rewards');
  strip.innerHTML = `
    <div class="container rewards-inner">
      <div class="rw-block">
        <span class="rw-label">Welcome back, ${escapeText(session.name || 'friend')}</span>
        <span class="rw-sub">Streak <strong>${rewards.streak}🔥</strong> · ${rewards.points} pts available · worth <strong>$${dollarsAvailable}</strong> off</span>
      </div>
      <button class="rw-checkin btn btn-primary" id="rwCheckInBtn" ${checkedIn ? 'disabled' : ''}>
        ${checkedIn ? 'Checked in today ✓' : 'Daily check-in'}
      </button>
    </div>`;
  main.prepend(strip);

  document.getElementById('rwCheckInBtn').addEventListener('click', async () => {
    const r = await GP_DB.checkIn(session.id);
    if (r.alreadyCheckedIn) return;
    showToast(`+${r.awarded} points · streak ${r.streak}🔥`);
    setTimeout(() => location.reload(), 900);
  });
}

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Mobile nav toggle ----------
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', String(open));
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  });
});

// ---------- Navbar shadow on scroll ----------
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 30);
});

// ---------- Active link highlight ----------
const sections = document.querySelectorAll('main section[id]');
const linkMap = {};
navLinks.querySelectorAll('a[href^="#"]').forEach(a => {
  linkMap[a.getAttribute('href').slice(1)] = a;
});
const navObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      const link = linkMap[entry.target.id];
      if (entry.isIntersecting && link) {
        Object.values(linkMap).forEach(a => a.classList.remove('active'));
        link.classList.add('active');
      }
    });
  },
  { rootMargin: '-45% 0px -50% 0px' }
);
sections.forEach(s => navObserver.observe(s));

// ---------- Contact form (with honeypot + timing + sanitization) ----------
const form = document.getElementById('contactForm');
const formStatus = document.getElementById('formStatus');
const formStarted = document.getElementById('formStarted');

// Mark when the user actually starts interacting — bots usually submit instantly
form.addEventListener('focusin', () => {
  if (!formStarted.value) formStarted.value = String(Date.now());
}, { once: true });

const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = new FormData(form);
  const name = (data.get('name') || '').trim().slice(0, 80);
  const email = (data.get('email') || '').trim().slice(0, 120);
  const message = (data.get('message') || '').trim().slice(0, 2000);
  const honey = (data.get('website') || '').trim();
  const started = parseInt(formStarted.value, 10) || 0;
  const elapsed = Date.now() - started;

  formStatus.classList.remove('success', 'error');

  // Bot defenses — fail silently (do not tell the bot why)
  if (honey) { formStatus.textContent = ''; form.reset(); return; }
  if (started === 0 || elapsed < 1500) {
    formStatus.textContent = 'Please take a moment to fill the form.';
    formStatus.classList.add('error');
    return;
  }

  if (!name || !email || !message) {
    formStatus.textContent = 'Please fill in all fields.';
    formStatus.classList.add('error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    formStatus.textContent = 'Please enter a valid email address.';
    formStatus.classList.add('error');
    return;
  }

  // Persist locally (and forward to backend when configured — see database/db.js)
  if (window.GP_DB) {
    window.GP_DB.saveContact({ name, email, message, ts: Date.now() });
  }

  // Real email via EmailJS (when configured)
  if (window.GP_SERVICES?.isConfigured.emailjs()) {
    formStatus.textContent = 'Sending…';
    const r = await window.GP_SERVICES.Email.contact({ from_name: name, from_email: email, message });
    if (!r.ok) {
      formStatus.textContent = `Saved your message — email delivery failed (${r.reason}). We'll still receive it.`;
      formStatus.classList.add('error');
      return;
    }
  }

  formStatus.textContent = `Thanks ${escapeHTML(name)}! We'll be in touch shortly.`;
  formStatus.classList.add('success');
  form.reset();
  formStarted.value = '';
});

// ---------- Copy-to-clipboard for bank / wallet ----------
document.querySelectorAll('[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const target = document.getElementById(btn.dataset.copy);
    if (!target) return;
    const text = target.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const r = document.createRange();
      r.selectNode(target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('copy');
      sel.removeAllRanges();
    }
    const original = btn.textContent;
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    showToast('Copied to clipboard');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 1500);
  });
});

// ---------- Footer year ----------
document.getElementById('year').textContent = new Date().getFullYear();

/* ====================================================================
   CART  —  Jumia-style drawer + SportyBet-style floating slip
   - Persists to localStorage
   - Add / remove / qty +/- / clear
   - Esc + overlay close, focus-trap, restore focus
   - Animated count badge
   ==================================================================== */

const CART_KEY = 'goldenpalm.cart.v1';
const fmt = n => '$' + n.toFixed(2);

const cart = {
  items: [],
  load() {
    try {
      this.items = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch { this.items = []; }
  },
  save() { localStorage.setItem(CART_KEY, JSON.stringify(this.items)); },
  add(p) {
    const existing = this.items.find(i => i.id === p.id);
    if (existing) existing.qty += 1;
    else this.items.push({ ...p, qty: 1 });
    this.save();
  },
  remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    this.save();
  },
  setQty(id, qty) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.max(1, Math.min(99, qty));
    this.save();
  },
  clear() { this.items = []; this.save(); },
  count() { return this.items.reduce((s, i) => s + i.qty, 0); },
  total() { return this.items.reduce((s, i) => s + i.qty * i.price, 0); },
};

cart.load();

// DOM refs
const cartBtn      = document.getElementById('cartBtn');
const cartCount    = document.getElementById('cartCount');
const cartDrawer   = document.getElementById('cartDrawer');
const drawerOverlay= document.getElementById('drawerOverlay');
const drawerClose  = document.getElementById('drawerClose');
const drawerCount  = document.getElementById('drawerCount');
const drawerBody   = document.getElementById('drawerBody');
const drawerFoot   = document.getElementById('drawerFoot');
const drawerTotal  = document.getElementById('drawerTotal');
const cartItemsEl  = document.getElementById('cartItems');
const cartEmpty    = document.getElementById('cartEmpty');
const cartClear    = document.getElementById('cartClear');
const cartSlip     = document.getElementById('cartSlip');
const slipCount    = document.getElementById('slipCount');
const slipTotal    = document.getElementById('slipTotal');
const toast        = document.getElementById('toast');

let lastFocused = null;

function bump(el) {
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;        // restart animation
  el.classList.add('bump');
}

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.hidden = false;
  toast.classList.toggle('toast-error', !!isError);
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 2200);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (v === false || v == null) return;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('aria-') || k === 'role') node.setAttribute(k, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  });
  children.flat().forEach(c => {
    if (c == null || c === false) return;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return node;
}

function buildCartItem(i) {
  const img = el('img', { src: i.img, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });

  const name  = el('div', { class: 'cart-item-name', textContent: i.name });
  const price = el('div', { class: 'cart-item-price', textContent: `${fmt(i.price)} / L` });
  const line  = el('div', { class: 'cart-item-line', textContent: fmt(i.price * i.qty) });
  const info  = el('div', { class: 'cart-item-info' }, name, price, line);

  const dec = el('button', {
    type: 'button', 'aria-label': 'Decrease quantity',
    disabled: i.qty <= 1, textContent: '−',
  });
  dec.dataset.dec = '';
  const qtyText = el('span', { 'aria-live': 'polite', textContent: i.qty });
  const inc = el('button', {
    type: 'button', 'aria-label': 'Increase quantity',
    disabled: i.qty >= 99, textContent: '+',
  });
  inc.dataset.inc = '';
  const qty = el('div', {
    class: 'qty', role: 'group',
    'aria-label': `Quantity for ${i.name}`,
  }, dec, qtyText, inc);

  const remove = el('button', {
    class: 'cart-item-remove', type: 'button',
    'aria-label': `Remove ${i.name} from cart`, textContent: 'Remove',
  });
  remove.dataset.remove = '';

  const actions = el('div', { class: 'cart-item-actions' }, qty, remove);

  const li = el('li', { class: 'cart-item' }, img, info, actions);
  li.dataset.id = i.id;
  return li;
}

let appliedDiscount = 0;   // dollars currently redeemed against this cart

function render() {
  const count = cart.count();
  const total = cart.total();

  // Cap discount to current subtotal
  if (appliedDiscount > total) appliedDiscount = total;
  const grand = Math.max(0, total - appliedDiscount);

  // Header badge
  cartCount.textContent = count;
  cartCount.classList.toggle('empty', count === 0);

  // Floating slip
  if (count > 0) {
    cartSlip.hidden = false;
    slipCount.textContent = count;
    slipTotal.textContent = fmt(grand);
  } else {
    cartSlip.hidden = true;
  }

  // Drawer
  drawerCount.textContent = `(${count})`;
  drawerTotal.textContent = fmt(total);
  drawerFoot.hidden = count === 0;
  cartEmpty.style.display = count === 0 ? 'flex' : 'none';

  // Discount + grand total
  const discountRow = document.getElementById('discountRow');
  const grandRow    = document.getElementById('grandRow');
  if (appliedDiscount > 0) {
    discountRow.hidden = false;
    grandRow.hidden = false;
    document.getElementById('drawerDiscount').textContent = '−' + fmt(appliedDiscount);
    document.getElementById('drawerGrand').textContent = fmt(grand);
  } else {
    discountRow.hidden = true;
    grandRow.hidden = true;
  }

  cartItemsEl.replaceChildren(...cart.items.map(buildCartItem));
  updateRewardRedeem(total);
}

async function updateRewardRedeem(total) {
  const box = document.getElementById('rewardRedeem');
  if (!box || !window.GP_DB) return;
  const session = GP_DB.getSession();
  if (!session) { box.hidden = true; return; }

  const r = await GP_DB.getRewards(session.id);
  if (!r || r.points <= 0 || total <= 0) { box.hidden = true; return; }

  box.hidden = false;
  document.getElementById('rwAvailable').textContent = r.points;
  document.getElementById('rwAvailableDollars').textContent = '$' + GP_DB.pointsToDollars(r.points).toFixed(2);
  const applied = document.getElementById('rwApplied');
  if (appliedDiscount > 0) {
    applied.hidden = false;
    applied.textContent = `Applied: $${appliedDiscount.toFixed(2)} off`;
  } else {
    applied.hidden = true;
  }
}

document.addEventListener('click', async e => {
  if (e.target?.id !== 'rwApplyBtn') return;
  const session = GP_DB.getSession();
  if (!session) return;
  const r = await GP_DB.getRewards(session.id);
  const total = cart.total();
  const maxDollars = Math.min(GP_DB.pointsToDollars(r.points), total);
  if (maxDollars <= 0) return;

  const pointsToSpend = GP_DB.dollarsToPoints(maxDollars);
  const result = await GP_DB.redeemPoints(session.id, pointsToSpend);
  if (!result.ok) return showToast('Not enough points', true);

  appliedDiscount = result.dollarsOff;
  showToast(`Applied $${appliedDiscount.toFixed(2)} discount`);
  render();
});

function openDrawer() {
  lastFocused = document.activeElement;
  drawerOverlay.hidden = false;
  cartDrawer.hidden = false;
  requestAnimationFrame(() => {
    drawerOverlay.classList.add('open');
    cartDrawer.classList.add('open');
  });
  document.body.style.overflow = 'hidden';
  drawerClose.focus();
}

function closeDrawer() {
  drawerOverlay.classList.remove('open');
  cartDrawer.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    drawerOverlay.hidden = true;
    cartDrawer.hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }, 320);
}

// --- Wire up product "Add to cart" buttons ---
document.querySelectorAll('.product-card [data-add]').forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.product-card');
    cart.add({
      id: card.dataset.id,
      name: card.dataset.name,
      price: parseFloat(card.dataset.price),
      img: card.dataset.img,
    });
    render();
    bump(cartBtn);
    bump(cartCount);
    bump(cartSlip);
    showToast(`${card.dataset.name} added`);
    btn.classList.add('added');
    btn.textContent = 'Added ✓';
    setTimeout(() => {
      btn.classList.remove('added');
      btn.textContent = 'Add to cart';
    }, 1200);
  });
});

// --- Drawer interactions ---
cartBtn.addEventListener('click', openDrawer);
cartSlip.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && cartDrawer.classList.contains('open')) closeDrawer();
});

// Item action delegation
cartItemsEl.addEventListener('click', e => {
  const li = e.target.closest('.cart-item');
  if (!li) return;
  const id = li.dataset.id;
  const item = cart.items.find(i => i.id === id);
  if (!item) return;

  if (e.target.matches('[data-inc]')) cart.setQty(id, item.qty + 1);
  else if (e.target.matches('[data-dec]')) cart.setQty(id, item.qty - 1);
  else if (e.target.closest('[data-remove]')) {
    cart.remove(id);
    showToast(`${item.name} removed`);
  } else return;

  render();
  bump(cartCount);
});

cartClear.addEventListener('click', () => {
  if (cart.items.length === 0) return;
  cart.clear();
  render();
  showToast('Cart cleared');
});

// Initial render
render();

// ---------- Checkout — save order, send confirmation email ----------
document.querySelector('.btn-checkout')?.addEventListener('click', async e => {
  if (cart.items.length === 0) return;
  const session = window.GP_DB?.getSession();

  const orderData = {
    items: cart.items.map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price })),
    subtotal: cart.total(),
    discount: appliedDiscount,
    total: Math.max(0, cart.total() - appliedDiscount),
    customer_id: session?.id || null,
    customer_name: session?.name || null,
    ts: Date.now(),
  };

  if (window.GP_DB) await window.GP_DB.saveOrder(orderData);

  // Email confirmation if EmailJS + signed in
  if (session?.id && window.GP_SERVICES?.isConfigured.emailjs()) {
    const acct = await getAccountEmail(session.id);
    if (acct?.email) {
      window.GP_SERVICES.Email.order({
        to_email: acct.email,
        to_name: session.name,
        order_id: orderData.ts.toString(36).toUpperCase(),
        total: fmt(orderData.total),
        items: orderData.items.map(i => `${i.name} × ${i.qty}`).join(', '),
      }).catch(() => {});
    }
  }

  // Clear cart after successful checkout
  cart.clear();
  appliedDiscount = 0;
  render();
});

async function getAccountEmail(key) {
  return new Promise(res => {
    const req = indexedDB.open('goldenpalm');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('accounts')) return res(null);
      const r = db.transaction('accounts').objectStore('accounts').get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    };
    req.onerror = () => res(null);
  });
}
