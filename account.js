/* ====================================================================
   GoldenPalm — Account page
   - Email signup/signin with PBKDF2-hashed passwords (Web Crypto)
   - Phone OTP (frontend stub — wire to Twilio/MSG91 server-side later)
   - Apple Sign In (loads Apple's official SDK; needs Developer creds)
   - Accounts persist in IndexedDB (via database/db.js)
   ==================================================================== */

// All third-party credentials come from config.js
const APPLE_CLIENT_ID    = window.GP_CONFIG?.APPLE_CLIENT_ID || '';
const APPLE_REDIRECT_URI = window.GP_CONFIG?.APPLE_REDIRECT_URI || (window.location.origin + '/account.html');
const GOOGLE_CLIENT_ID   = window.GP_CONFIG?.GOOGLE_CLIENT_ID || '';

// ----- Track this page visit (daily counter) -----
if (window.GP_DB) window.GP_DB.recordVisit().catch(() => {});

// ----- DOM refs -----
const authTitle  = document.getElementById('auth-title');
const authSub    = document.getElementById('authSub');
const toast      = document.getElementById('toast');
const yearEl     = document.getElementById('year');
yearEl.textContent = new Date().getFullYear();

const emailForm  = document.getElementById('emailForm');
const phoneForm  = document.getElementById('phoneForm');
const appleForm  = document.getElementById('appleForm');
const googleForm = document.getElementById('googleForm');
const forms = { email: emailForm, phone: phoneForm, google: googleForm, apple: appleForm };

let mode = 'signup';      // 'signup' | 'signin'
let method = 'email';     // 'email' | 'phone' | 'apple'

// ===== Helpers =====
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.hidden = false;
  toast.style.background = isError ? '#b3401b' : '';
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 2400);
}

function setStatus(el, msg, type = '') {
  el.textContent = msg;
  el.classList.remove('success', 'error');
  if (type) el.classList.add(type);
}

// ===== Password hashing (PBKDF2 + SHA-256, 200k iters) =====
async function hashPassword(password, saltBytes) {
  const enc = new TextEncoder();
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return {
    salt: btoa(String.fromCharCode(...salt)),
    hash: btoa(String.fromCharCode(...new Uint8Array(bits))),
  };
}

async function verifyPassword(password, saltB64, hashB64) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const computed = await hashPassword(password, salt);
  return computed.hash === hashB64;
}

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw))   score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 5);
}

// ===== Local accounts store =====
async function db() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('goldenpalm', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      ['orders', 'contacts', 'security_events', 'accounts'].forEach(n => {
        if (!d.objectStoreNames.contains(n)) {
          d.createObjectStore(n, n === 'accounts' ? { keyPath: 'key' } : { keyPath: 'id', autoIncrement: true });
        }
      });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function saveAccount(account) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('accounts', 'readwrite');
    const r = tx.objectStore('accounts').put(account);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function findAccount(key) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('accounts', 'readonly');
    const r = tx.objectStore('accounts').get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function setSession(account, isNew = false) {
  const safe = { id: account.key, name: account.name || '', method: account.method, ts: Date.now() };
  sessionStorage.setItem('gp.session', JSON.stringify(safe));
  if (!window.GP_DB) return;

  window.GP_DB.logSecurityEvent('login_success', { method: account.method, key: account.key });

  // Award signup bonus to new accounts; daily check-in to returning ones
  if (isNew) {
    await window.GP_DB.signupBonus(account.key);
    showToast(`+${window.GP_DB.config.SIGNUP_BONUS} welcome points!`);

    // Welcome email via EmailJS (fires only when configured; silent otherwise)
    if (account.email && window.GP_SERVICES?.isConfigured.emailjs()) {
      window.GP_SERVICES.Email.welcome({
        to_email: account.email,
        to_name:  account.name || account.email,
      }).catch(() => {});
    }
  } else {
    const result = await window.GP_DB.checkIn(account.key);
    if (result && !result.alreadyCheckedIn && result.awarded > 0) {
      showToast(`+${result.awarded} daily points · streak ${result.streak}🔥`);
    }
  }
}

// ===== UI mode/method switching =====
function applyMode() {
  document.querySelectorAll('[data-mode]').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  authTitle.textContent = mode === 'signup' ? 'Create your account' : 'Welcome back';
  authSub.textContent = mode === 'signup' ? 'It takes less than a minute.' : 'Sign in to continue.';

  document.querySelectorAll('[data-signup-only]').forEach(el => el.hidden = mode !== 'signup');
  document.querySelectorAll('[data-signin-only]').forEach(el => el.hidden = mode !== 'signin');
  document.querySelectorAll('[data-signup-text]').forEach(el => el.hidden = mode !== 'signup');
  document.querySelectorAll('[data-signin-text]').forEach(el => el.hidden = mode !== 'signin');

  // password autocomplete attribute
  const pw = emailForm.querySelector('input[name="password"]');
  pw.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
}

function applyMethod() {
  document.querySelectorAll('[data-method]').forEach(b => {
    const active = b.dataset.method === method;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  Object.entries(forms).forEach(([k, f]) => { f.hidden = k !== method; });
}

document.querySelectorAll('[data-mode]').forEach(b => {
  b.addEventListener('click', () => { mode = b.dataset.mode; applyMode(); });
});
document.querySelectorAll('[data-method]').forEach(b => {
  b.addEventListener('click', () => {
    method = b.dataset.method;
    applyMethod();
    if (method === 'apple')  ensureAppleSdk();
    if (method === 'google') ensureGoogleSdk();
  });
});
document.querySelectorAll('[data-mode-link]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    mode = a.dataset.modeLink;
    applyMode();
  });
});

// ===== Show/hide password =====
document.querySelectorAll('[data-toggle-pw]').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    btn.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
  });
});

// ===== Password strength meter =====
const pwInput = emailForm.querySelector('input[name="password"]');
const pwBar   = document.getElementById('pwBar');
const pwLabel = document.getElementById('pwLabel');
const strengthLabels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
const strengthColors = ['#b3401b', '#e07a00', '#d4a017', '#1a7a4a', '#0a4d2e', '#0a4d2e'];

pwInput.addEventListener('input', () => {
  const s = passwordStrength(pwInput.value);
  pwBar.style.width = (s * 20) + '%';
  pwBar.style.background = strengthColors[s];
  pwLabel.textContent = pwInput.value ? strengthLabels[s] : 'Strength';
});

// ===== EMAIL submit =====
emailForm.addEventListener('submit', async e => {
  e.preventDefault();
  const status = document.getElementById('emailStatus');
  const data = new FormData(emailForm);
  const honey = (data.get('website') || '').trim();
  if (honey) return; // bot

  const email = (data.get('email') || '').trim().toLowerCase();
  const password = (data.get('password') || '');
  const name = (data.get('name') || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return setStatus(status, 'Please enter a valid email.', 'error');
  }
  if (password.length < 8) {
    return setStatus(status, 'Password must be at least 8 characters.', 'error');
  }

  const key = `email:${email}`;

  if (mode === 'signup') {
    const existing = await findAccount(key);
    if (existing) return setStatus(status, 'An account with that email already exists.', 'error');
    if (!data.get('agree')) return setStatus(status, 'Please accept the Terms to continue.', 'error');

    const { salt, hash } = await hashPassword(password);
    await saveAccount({ key, method: 'email', email, name, salt, hash, created_at: Date.now() });
    await setSession({ key, name, method: 'email' }, true);
    setStatus(status, 'Account created. Welcome!', 'success');
    showToast(`Welcome, ${name || email}!`);
    setTimeout(() => location.href = 'index.html', 1100);
  } else {
    const acct = await findAccount(key);
    if (!acct) return setStatus(status, 'No account found for that email.', 'error');
    const ok = await verifyPassword(password, acct.salt, acct.hash);
    if (!ok) {
      if (window.GP_DB) window.GP_DB.logSecurityEvent('login_fail', { email });
      return setStatus(status, 'Incorrect password. Please try again.', 'error');
    }
    await setSession(acct, false);
    setStatus(status, 'Signed in successfully.', 'success');
    showToast(`Welcome back, ${acct.name || email}!`);
    setTimeout(() => location.href = 'index.html', 1100);
  }
});

// Forgot password (placeholder — needs email-send backend)
document.querySelector('[data-recover]')?.addEventListener('click', e => {
  e.preventDefault();
  showToast('Password recovery requires email service setup.', true);
});

// ===== PHONE submit + OTP =====
const sendOtpBtn = document.getElementById('sendOtpBtn');
const otpBox     = document.getElementById('otpBox');
const otpHint    = document.getElementById('otpHint');
let pendingOtp   = null;

sendOtpBtn.addEventListener('click', async () => {
  const status = document.getElementById('phoneStatus');
  const phone = (phoneForm.querySelector('[name="phone"]').value || '').trim();
  if (!/^\+?[\d\s\-()]{7,20}$/.test(phone)) {
    return setStatus(status, 'Please enter a valid phone number with country code.', 'error');
  }

  sendOtpBtn.disabled = true;
  sendOtpBtn.textContent = 'Sending…';

  // Real SMS via Firebase when configured
  if (window.GP_SERVICES?.isConfigured.firebase()) {
    const result = await window.GP_SERVICES.sendPhoneOtp(phone);
    if (!result.ok) {
      sendOtpBtn.disabled = false;
      sendOtpBtn.textContent = 'Send 6-digit code';
      return setStatus(status, 'Could not send SMS: ' + (result.reason || 'unknown'), 'error');
    }
    sessionStorage.setItem('gp.otp', JSON.stringify({ phone, real: true, ts: Date.now() }));
    otpBox.hidden = false;
    setStatus(status, 'Code sent via SMS to ' + phone + '.', 'success');
    otpHint.textContent = 'Check your phone for the 6-digit code.';
  } else {
    // Demo fallback — no Firebase configured
    pendingOtp = String(Math.floor(100_000 + Math.random() * 900_000));
    sessionStorage.setItem('gp.otp', JSON.stringify({ phone, otp: pendingOtp, real: false, ts: Date.now() }));
    otpBox.hidden = false;
    setStatus(status, 'A 6-digit code has been generated.', 'success');
    otpHint.innerHTML = `<strong>Demo mode:</strong> your code is <code>${pendingOtp}</code>. Add Firebase config to <code>config.js</code> for real SMS.`;
    console.info('[GoldenPalm] Demo OTP for', phone, '=', pendingOtp);
  }
  sendOtpBtn.disabled = false;
  sendOtpBtn.textContent = 'Resend code';
});

phoneForm.addEventListener('submit', async e => {
  e.preventDefault();
  const status = document.getElementById('phoneStatus');
  const data = new FormData(phoneForm);
  const phone = (data.get('phone') || '').trim();
  const otp = (data.get('otp') || '').trim();
  const name = (data.get('name') || '').trim();

  const stored = JSON.parse(sessionStorage.getItem('gp.otp') || 'null');
  if (!stored || stored.phone !== phone) {
    return setStatus(status, 'Please request a new code first.', 'error');
  }
  if (Date.now() - stored.ts > 10 * 60_000) {
    return setStatus(status, 'Code expired. Request a new one.', 'error');
  }

  // Real verification via Firebase
  if (stored.real) {
    const r = await window.GP_SERVICES.verifyPhoneOtp(otp);
    if (!r.ok) return setStatus(status, 'Incorrect code. Please try again.', 'error');
  } else if (otp !== stored.otp) {
    return setStatus(status, 'Incorrect code. Please try again.', 'error');
  }

  const key = `phone:${phone}`;
  let acct = await findAccount(key);
  let isNew = false;
  if (mode === 'signup') {
    if (acct) return setStatus(status, 'An account with that phone already exists.', 'error');
    acct = { key, method: 'phone', phone, name, created_at: Date.now() };
    await saveAccount(acct);
    isNew = true;
    setStatus(status, 'Account created. Welcome!', 'success');
  } else {
    if (!acct) return setStatus(status, 'No account found for that phone.', 'error');
    setStatus(status, 'Signed in successfully.', 'success');
  }
  await setSession(acct, isNew);
  sessionStorage.removeItem('gp.otp');
  showToast(`Welcome${acct.name ? ', ' + acct.name : ''}!`);
  setTimeout(() => location.href = 'index.html', 1100);
});

// ===== APPLE Sign In =====
function ensureAppleSdk() {
  if (window.AppleID) return initApple();
  const s = document.createElement('script');
  s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
  s.onload = initApple;
  s.onerror = () => {
    setStatus(document.getElementById('appleStatus'),
      'Could not load Apple Sign In. Check your network or CSP.', 'error');
  };
  document.head.appendChild(s);
}

function initApple() {
  if (!window.AppleID) return;
  AppleID.auth.init({
    clientId: APPLE_CLIENT_ID,
    scope: 'name email',
    redirectURI: APPLE_REDIRECT_URI,
    state: crypto.randomUUID(),
    usePopup: true,
  });
}

/**
 * Inline mini-form to collect email + name when no OAuth credentials are set.
 * Returns a Promise<{email, name} | null>.
 */
function oauthDemoPrompt(method) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'demo-modal';
    modal.innerHTML = `
      <div class="demo-card" role="dialog" aria-modal="true" aria-labelledby="demoTitle">
        <h3 id="demoTitle">Continue with ${method === 'google' ? 'Google' : 'Apple'}</h3>
        <p class="hint">
          <strong>Demo mode active.</strong> Add real OAuth credentials in
          <code>account.js</code> to use the official ${method === 'google' ? 'Google' : 'Apple'} sign-in flow.
          For now, enter your details to create an account.
        </p>
        <label><span>${method === 'google' ? 'Google' : 'Apple ID'} email</span>
          <input type="email" id="demoEmail" autocomplete="email" required />
        </label>
        <label><span>Name</span>
          <input type="text" id="demoName" autocomplete="name" />
        </label>
        <div class="demo-actions">
          <button type="button" class="btn btn-ghost" id="demoCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="demoOk">Continue</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = result => { modal.remove(); resolve(result); };
    const emailEl = modal.querySelector('#demoEmail');
    emailEl.focus();
    modal.querySelector('#demoCancel').onclick = () => close(null);
    modal.querySelector('#demoOk').onclick = () => {
      const email = emailEl.value.trim().toLowerCase();
      const name = modal.querySelector('#demoName').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailEl.focus(); return; }
      close({ email, name });
    };
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
  });
}

async function completeOAuthSignIn({ method, key, email, name, picture, statusEl }) {
  let acct = await findAccount(key);
  const isNew = !acct;
  if (!acct) {
    acct = { key, method, email, name, picture, created_at: Date.now() };
    await saveAccount(acct);
  }
  await setSession(acct, isNew);
  setStatus(statusEl, isNew ? 'Account created. Welcome!' : 'Signed in successfully.', 'success');
  showToast(`Welcome${name ? ', ' + name : ''}!`);
  setTimeout(() => location.href = 'index.html', 1100);
}

document.getElementById('appleBtn').addEventListener('click', async () => {
  const status = document.getElementById('appleStatus');

  // Demo fallback when no Apple credentials are configured
  if (!APPLE_CLIENT_ID) {
    const data = await oauthDemoPrompt('apple');
    if (!data) return;
    return completeOAuthSignIn({
      method: 'apple', key: `apple:${data.email}`, email: data.email, name: data.name, statusEl: status,
    });
  }

  if (!window.AppleID) return setStatus(status, 'Apple Sign In is still loading…', 'error');
  try {
    const res = await AppleID.auth.signIn();
    const token = res.authorization?.id_token || '';
    const payload = decodeJwt(token);
    const email = payload?.email || res.user?.email || `apple:${payload?.sub || 'unknown'}`;
    const name = res.user?.name ? `${res.user.name.firstName} ${res.user.name.lastName}`.trim() : '';
    await completeOAuthSignIn({
      method: 'apple', key: `apple:${payload?.sub || email}`, email, name, statusEl: status,
    });
  } catch (err) {
    if (err?.error === 'popup_closed_by_user') return;
    setStatus(status, 'Apple Sign In failed: ' + (err?.error || 'unknown error'), 'error');
  }
});

function decodeJwt(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

// ===== GOOGLE Sign In =====
function ensureGoogleSdk() {
  if (window.google?.accounts?.id) return initGoogle();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.defer = true;
  s.onload = initGoogle;
  s.onerror = () => setStatus(document.getElementById('googleStatus'),
    'Could not load Google Sign-In. Check your network.', 'error');
  document.head.appendChild(s);
}

function initGoogle() {
  if (!window.google?.accounts?.id) return;
  if (!GOOGLE_CLIENT_ID) return;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    ux_mode: 'popup',
    auto_select: false,
    itp_support: true,            // Safari ITP / iOS / iPad support
  });
  // Render official button — works on every platform (Android, iOS, macOS, Win, web)
  const target = document.getElementById('googleOneTap');
  target.innerHTML = '';
  google.accounts.id.renderButton(target, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    logo_alignment: 'left',
    width: 320,
  });
}

function handleGoogleCredential(response) {
  const status = document.getElementById('googleStatus');
  const payload = decodeJwt(response.credential);
  if (!payload?.email) return setStatus(status, 'Google sign-in failed.', 'error');

  completeOAuthSignIn({
    method: 'google',
    key: `google:${payload.sub}`,
    email: payload.email,
    name: payload.name || '',
    picture: payload.picture || '',
    statusEl: status,
  });
}

document.getElementById('googleBtn').addEventListener('click', async () => {
  const status = document.getElementById('googleStatus');

  // Demo fallback when no Google credentials are configured
  if (!GOOGLE_CLIENT_ID) {
    const data = await oauthDemoPrompt('google');
    if (!data) return;
    return completeOAuthSignIn({
      method: 'google', key: `google:${data.email}`, email: data.email, name: data.name, statusEl: status,
    });
  }

  if (!window.google?.accounts?.id) {
    setStatus(status, 'Google Sign-In is loading…', 'error');
    return ensureGoogleSdk();
  }
  google.accounts.id.prompt();
});

// ===== Init =====
applyMode();
applyMethod();
