/* ====================================================================
   GoldenPalm PWA helper
   - Registers service worker
   - Generates PNG icons via <canvas> (for iOS / Android)
   - Shows "Install App" banner when browser fires beforeinstallprompt
   - Shows iOS-specific install instructions on Safari
   ==================================================================== */

(function () {

  /* ----- 1. Generate PNG icon and set apple-touch-icon ----- */
  function generateIcon(size) {
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');

      // Background — dark green rounded rect
      const r = size * 0.22;
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.lineTo(size - r, 0);
      ctx.quadraticCurveTo(size, 0, size, r);
      ctx.lineTo(size, size - r);
      ctx.quadraticCurveTo(size, size, size - r, size);
      ctx.lineTo(r, size);
      ctx.quadraticCurveTo(0, size, 0, size - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      const grad = ctx.createRadialGradient(size * 0.3, size * 0.25, 0, size * 0.5, size * 0.5, size * 0.75);
      grad.addColorStop(0, '#1a7a4a');
      grad.addColorStop(1, '#053a1f');
      ctx.fillStyle = grad;
      ctx.fill();

      // Subtle ring
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.43, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(240,192,66,0.25)';
      ctx.lineWidth = size * 0.012;
      ctx.stroke();

      // "GP" text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f0c042';
      ctx.font = `700 ${size * 0.36}px Georgia, serif`;
      ctx.fillText('GP', size / 2, size * 0.52);

      return cv.toDataURL('image/png');
    } catch { return null; }
  }

  // Set apple-touch-icon dynamically (iOS Safari needs PNG)
  const dataUrl = generateIcon(180);
  if (dataUrl) {
    let link = document.querySelector('link[rel~="apple-touch-icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'apple-touch-icon';
      document.head.appendChild(link);
    }
    link.href = dataUrl;

    // Also save as icon-192 / icon-512 references for manifest fallback
    if (typeof caches !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        const big = generateIcon(512);
        const small = generateIcon(192);
        if (big && small) {
          caches.open('goldenpalm-v1').then(cache => {
            cache.put('/icon-512.png', new Response(dataURItoBlob(big), { headers: { 'Content-Type': 'image/png' } }));
            cache.put('/icon-192.png', new Response(dataURItoBlob(small), { headers: { 'Content-Type': 'image/png' } }));
          });
        }
      }).catch(() => {});
    }
  }

  function dataURItoBlob(dataURI) {
    const arr = dataURI.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  /* ----- 2. Register service worker ----- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner(reg);
              }
            });
          });
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });
  }

  /* ----- 3. Android / Chrome install prompt ----- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    // Show after 4 seconds if not dismissed before
    setTimeout(showInstallBanner, 4000);
  });

  window.addEventListener('appinstalled', () => {
    hideInstallBanner();
    deferredPrompt = null;
  });

  function showInstallBanner() {
    if (document.getElementById('pwaBanner')) return;
    if (localStorage.getItem('gp.pwa.dismissed')) return;

    const banner = document.createElement('div');
    banner.id = 'pwaBanner';
    banner.setAttribute('role', 'complementary');
    banner.setAttribute('aria-label', 'Install GoldenPalm app');
    banner.innerHTML = `
      <img src="${dataUrl || 'icon.svg'}" width="52" height="52" alt="" />
      <div class="pwa-text">
        <strong>Install GoldenPalm</strong>
        <span>Free • Works offline • Fast on your phone</span>
      </div>
      <button id="pwaInstall" class="pwa-btn-install" type="button">Install</button>
      <button id="pwaDismiss" class="pwa-btn-dismiss" type="button" aria-label="Dismiss">✕</button>`;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('pwa-show'));

    document.getElementById('pwaInstall').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') hideInstallBanner();
    });

    document.getElementById('pwaDismiss').addEventListener('click', () => {
      hideInstallBanner();
      localStorage.setItem('gp.pwa.dismissed', '1');
    });
  }

  function hideInstallBanner() {
    const b = document.getElementById('pwaBanner');
    if (b) { b.classList.remove('pwa-show'); setTimeout(() => b.remove(), 350); }
  }

  /* ----- 4. iOS Safari install instructions ----- */
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const iosDismissed = localStorage.getItem('gp.pwa.ios.dismissed');

  if (isIos && !isInStandalone && !iosDismissed) {
    setTimeout(() => {
      if (document.getElementById('iosBanner')) return;
      const b = document.createElement('div');
      b.id = 'iosBanner';
      b.setAttribute('role', 'complementary');
      b.setAttribute('aria-label', 'Add to Home Screen instructions');
      b.innerHTML = `
        <button id="iosDismiss" class="pwa-btn-dismiss ios-dismiss" type="button" aria-label="Dismiss">✕</button>
        <strong>Add to Home Screen</strong>
        <p>Tap&nbsp;<span class="ios-share" aria-label="Share icon">⎙</span>&nbsp;then <em>"Add to Home Screen"</em> to install GoldenPalm like a native app.</p>
        <div class="ios-arrow" aria-hidden="true">▼</div>`;
      document.body.appendChild(b);
      requestAnimationFrame(() => b.classList.add('pwa-show'));
      document.getElementById('iosDismiss').addEventListener('click', () => {
        b.classList.remove('pwa-show');
        setTimeout(() => b.remove(), 350);
        localStorage.setItem('gp.pwa.ios.dismissed', '1');
      });
    }, 5000);
  }

  /* ----- 5. Update available banner ----- */
  function showUpdateBanner(reg) {
    const b = document.createElement('div');
    b.id = 'pwaBanner';
    b.innerHTML = `
      <div class="pwa-text"><strong>Update available</strong><span>A new version of GoldenPalm is ready.</span></div>
      <button class="pwa-btn-install" type="button" id="pwaUpdate">Reload</button>
      <button class="pwa-btn-dismiss" type="button" id="pwaSkip" aria-label="Skip update">✕</button>`;
    document.body.appendChild(b);
    requestAnimationFrame(() => b.classList.add('pwa-show'));
    document.getElementById('pwaUpdate').addEventListener('click', () => {
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      location.reload();
    });
    document.getElementById('pwaSkip').addEventListener('click', () => {
      b.classList.remove('pwa-show'); setTimeout(() => b.remove(), 350);
    });
  }

})();
