/* ====================================================================
   GoldenPalm — Service Configuration
   --------------------------------------------------------------------
   ALL third-party credentials go here, in one place. Replace the empty
   strings with your real values and the site auto-switches from demo
   mode to real services. No code changes needed.

   SECURITY NOTE
   -------------
   Every value in this file ships to the visitor's browser. Only paste
   keys that are SAFE for the frontend:
     ✓ Google OAuth Client ID (public)
     ✓ Apple Services ID (public)
     ✓ EmailJS Public Key (public)
     ✓ Firebase web config (public)
     ✓ Supabase anon key (public — Row-Level Security protects data)
   NEVER paste:
     ✗ Google OAuth Client SECRET
     ✗ Apple private key (.p8 file contents)
     ✗ EmailJS Private Key
     ✗ Firebase service-account JSON
     ✗ Supabase service_role key

   Anything starting with "service_" or labelled "secret" stays on a
   server, never in this file.
   ==================================================================== */

window.GP_CONFIG = {

  /* ==================================================================
     1) GOOGLE SIGN-IN          [free · ~5 min]
     ==================================================================
     a) Go to https://console.cloud.google.com/
     b) Create / pick a project → APIs & Services → Credentials
     c) "Create Credentials" → OAuth client ID → Application type: Web
     d) Authorized JavaScript origins:
            https://goldenpalm.gmakibor.com
            http://localhost:5500       (optional, for local testing)
     e) Authorized redirect URIs:
            https://goldenpalm.gmakibor.com/account.html
     f) Copy the "Client ID" → paste below.
     ================================================================== */
  GOOGLE_CLIENT_ID: '',  // e.g. '1234567890-abc.apps.googleusercontent.com'


  /* ==================================================================
     2) APPLE SIGN-IN           [Apple Developer Program · $99/yr]
     ==================================================================
     a) https://developer.apple.com/ → Certificates, IDs & Profiles
     b) Identifiers → +  → Services IDs → Continue
        - Identifier: com.gmakibor.goldenpalm    (must be unique)
        - Description: GoldenPalm Web
        - Enable "Sign in with Apple"
     c) Configure → Primary App ID + Domain & Return URL
        Domain: goldenpalm.gmakibor.com
        Return URL: https://goldenpalm.gmakibor.com/account.html
     d) Apple gives a TXT record — add it to your DNS to verify domain
     e) Copy the Services ID identifier below
     ================================================================== */
  APPLE_CLIENT_ID:    '',  // e.g. 'com.gmakibor.goldenpalm'
  APPLE_REDIRECT_URI: window.location.origin + '/account.html',


  /* ==================================================================
     3) EMAILJS — transactional email      [free 200/mo · ~10 min]
     ==================================================================
     Sends real emails (welcome, password reset, order confirmation,
     contact form) directly from your Gmail/Outlook, with no backend.

     a) https://www.emailjs.com/ → Sign up
     b) Email Services → Add → connect Gmail (or Outlook/SMTP)
        Note the Service ID (e.g. "service_abc123")
     c) Email Templates → create FOUR templates with these IDs:
          - Welcome      e.g. "tpl_welcome"
          - Recovery     e.g. "tpl_recovery"     (uses {{otp}} variable)
          - Order        e.g. "tpl_order"        (uses {{order_id}}, {{total}})
          - Contact      e.g. "tpl_contact"      (uses {{from_name}}, {{from_email}}, {{message}})
        Use {{to_name}} and {{to_email}} as the recipient variables.
     d) Account → General → Public Key
     e) Paste IDs below.
     ================================================================== */
  EMAILJS_PUBLIC_KEY:        '',
  EMAILJS_SERVICE_ID:        '',
  EMAILJS_TEMPLATE_WELCOME:  '',
  EMAILJS_TEMPLATE_RECOVERY: '',
  EMAILJS_TEMPLATE_ORDER:    '',
  EMAILJS_TEMPLATE_CONTACT:  '',
  EMAILJS_FROM_EMAIL:        'akibormoses@gmail.com',


  /* ==================================================================
     4) FIREBASE PHONE AUTH — real SMS OTP   [free 10K/mo · ~10 min]
     ==================================================================
     a) https://console.firebase.google.com/ → Add project
     b) Authentication → Get started → Sign-in method tab
        → Phone → Enable → Save
     c) Authentication → Settings → Authorized domains
        → Add  goldenpalm.gmakibor.com   and   localhost
     d) Project Settings (gear) → "Your apps" → </> Web → Register app
        Copy the firebaseConfig object — paste below.
     e) The reCAPTCHA challenge appears automatically; nothing else
        to set up. Real SMS goes out immediately.
     ================================================================== */
  FIREBASE_CONFIG: null,
  /* Example:
  FIREBASE_CONFIG: {
    apiKey:            'AIzaSy...',
    authDomain:        'your-project.firebaseapp.com',
    projectId:         'your-project',
    appId:             '1:1234567890:web:abcdef',
    messagingSenderId: '1234567890',
  },
  */


  /* ==================================================================
     5) SUPABASE (optional)     — remote database mirror
     ==================================================================
     If set, every write to IndexedDB also writes to Supabase. Leave
     blank for local-only mode.
     ================================================================== */
  SUPABASE_URL:      '',
  SUPABASE_ANON_KEY: '',
};

/* Helpers — let other scripts ask "is service X configured?" */
window.GP_CONFIG.isConfigured = {
  google:   () => !!window.GP_CONFIG.GOOGLE_CLIENT_ID,
  apple:    () => !!window.GP_CONFIG.APPLE_CLIENT_ID,
  emailjs:  () => !!(window.GP_CONFIG.EMAILJS_PUBLIC_KEY && window.GP_CONFIG.EMAILJS_SERVICE_ID),
  firebase: () => !!window.GP_CONFIG.FIREBASE_CONFIG,
  supabase: () => !!(window.GP_CONFIG.SUPABASE_URL && window.GP_CONFIG.SUPABASE_ANON_KEY),
};
