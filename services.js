/* ====================================================================
   GoldenPalm — Service helpers
   - EmailJS  : sends real transactional emails (welcome, OTP, order, contact)
   - Firebase : real Phone SMS OTP via reCAPTCHA
   - Google / Apple SDKs are loaded by account.js as needed
   ==================================================================== */

(function () {
  const cfg = window.GP_CONFIG || {};

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  /* ----- EmailJS ----- */
  let emailjsReady = false;
  async function ensureEmailJS() {
    if (emailjsReady) return true;
    if (!cfg.isConfigured?.emailjs?.()) return false;
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js');
      window.emailjs.init({ publicKey: cfg.EMAILJS_PUBLIC_KEY });
      emailjsReady = true;
      return true;
    } catch (e) { console.warn('EmailJS load failed:', e); return false; }
  }

  async function sendEmail(templateId, params) {
    if (!templateId) return { ok: false, reason: 'no-template' };
    const ok = await ensureEmailJS();
    if (!ok) return { ok: false, reason: 'not-configured' };
    try {
      const res = await window.emailjs.send(cfg.EMAILJS_SERVICE_ID, templateId, params);
      return { ok: true, status: res.status };
    } catch (e) {
      console.warn('EmailJS send failed:', e);
      return { ok: false, reason: 'send-failed', error: e };
    }
  }

  const Email = {
    async welcome({ to_email, to_name }) {
      return sendEmail(cfg.EMAILJS_TEMPLATE_WELCOME, {
        to_email, to_name: to_name || to_email,
        from_email: cfg.EMAILJS_FROM_EMAIL,
        site: 'GoldenPalm — GM Akibor Limited',
      });
    },
    async recovery({ to_email, to_name, otp }) {
      return sendEmail(cfg.EMAILJS_TEMPLATE_RECOVERY, {
        to_email, to_name: to_name || to_email, otp,
        from_email: cfg.EMAILJS_FROM_EMAIL,
      });
    },
    async order({ to_email, to_name, order_id, total, items }) {
      return sendEmail(cfg.EMAILJS_TEMPLATE_ORDER, {
        to_email, to_name: to_name || to_email,
        order_id, total, items,
        from_email: cfg.EMAILJS_FROM_EMAIL,
      });
    },
    async contact({ from_name, from_email, message }) {
      return sendEmail(cfg.EMAILJS_TEMPLATE_CONTACT, {
        from_name, from_email, message,
        to_email: cfg.EMAILJS_FROM_EMAIL,
      });
    },
  };

  /* ----- Firebase Phone Auth ----- */
  let firebaseReady = false;
  async function ensureFirebase() {
    if (firebaseReady) return true;
    if (!cfg.isConfigured?.firebase?.()) return false;
    try {
      await loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js');
      if (!window.firebase.apps?.length) {
        window.firebase.initializeApp(cfg.FIREBASE_CONFIG);
      }
      firebaseReady = true;
      return true;
    } catch (e) { console.warn('Firebase load failed:', e); return false; }
  }

  let recaptchaVerifier = null;
  let confirmationResult = null;

  async function sendPhoneOtp(phoneE164, recaptchaContainerId = 'recaptcha-container') {
    const ok = await ensureFirebase();
    if (!ok) return { ok: false, reason: 'not-configured' };

    // Ensure container exists
    let container = document.getElementById(recaptchaContainerId);
    if (!container) {
      container = document.createElement('div');
      container.id = recaptchaContainerId;
      document.body.appendChild(container);
    }

    if (!recaptchaVerifier) {
      recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
        recaptchaContainerId, { size: 'invisible' }
      );
    }
    try {
      confirmationResult = await firebase.auth().signInWithPhoneNumber(phoneE164, recaptchaVerifier);
      return { ok: true };
    } catch (e) {
      console.warn('Phone OTP send failed:', e);
      return { ok: false, reason: e.code || 'send-failed', error: e };
    }
  }

  async function verifyPhoneOtp(code) {
    if (!confirmationResult) return { ok: false, reason: 'no-pending' };
    try {
      const result = await confirmationResult.confirm(code);
      return { ok: true, uid: result.user.uid, phone: result.user.phoneNumber };
    } catch (e) {
      return { ok: false, reason: e.code || 'verify-failed' };
    }
  }

  /* ----- Public surface ----- */
  window.GP_SERVICES = {
    Email,
    sendPhoneOtp,
    verifyPhoneOtp,
    isConfigured: cfg.isConfigured || { google: () => false, apple: () => false, emailjs: () => false, firebase: () => false },
  };
})();
