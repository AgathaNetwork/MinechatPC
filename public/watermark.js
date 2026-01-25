// Minechat watermark helper (front-end only)
// Usage:
//   const wm = window.MinechatWatermark && window.MinechatWatermark.create({
//     targetEl: someEl,
//     enabled: true,
//     getText: () => `${username} ${window.MinechatWatermark.formatNowSeconds()}`,
//   });
//   wm.setEnabled(true/false);
//   wm.destroy();

(function () {
  function pad2(n) {
    const v = Number(n);
    return v < 10 ? `0${v}` : String(v);
  }

  function formatNowSeconds() {
    const d = new Date();
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  }

  function safeText(x) {
    const s = String(x === undefined || x === null ? '' : x);
    return s.replace(/[\r\n\t]+/g, ' ').trim();
  }

  function buildTileDataUrl(text, opts) {
    const options = Object.assign(
      {
        font: '16px sans-serif',
        color: 'rgba(0, 0, 0, 0.18)',
        rotateDeg: -22,
        gapX: 240,
        gapY: 180,
        dpr: Math.min(2, (window.devicePixelRatio || 1) * 1),
      },
      opts || {}
    );

    const t = safeText(text) || 'Minechat';

    const dpr = Number(options.dpr) > 0 ? Number(options.dpr) : 1;
    const w = Math.max(200, Number(options.gapX) || 240);
    const h = Math.max(140, Number(options.gapY) || 180);

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(((Number(options.rotateDeg) || -22) * Math.PI) / 180);

    ctx.font = String(options.font || '16px sans-serif');
    ctx.fillStyle = String(options.color || 'rgba(0,0,0,0.18)');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw twice for a denser look.
    ctx.fillText(t, 0, 0);
    ctx.fillText(t, 0, 34);

    ctx.restore();

    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  }

  function ensureNonStaticPosition(el) {
    try {
      const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      const pos = cs ? String(cs.position || '') : '';
      if (!pos || pos === 'static') {
        el.style.position = 'relative';
      }
    } catch (e) {}
  }

  function applyAsBackground(el, dataUrl, opts) {
    const options = Object.assign(
      {
        // Opacity is controlled in the canvas fillStyle.
      },
      opts || {}
    );

    if (!el) return;
    if (!dataUrl) {
      try {
        el.style.backgroundImage = '';
      } catch (e) {}
      return;
    }

    try {
      // Paint watermark as background image so it does NOT scroll with content.
      el.style.backgroundImage = `url(${dataUrl})`;
      el.style.backgroundRepeat = 'repeat';
      el.style.backgroundPosition = '0 0';
      el.style.backgroundSize = 'auto';

      void options;
    } catch (e) {}
  }

  function create(params) {
    const p = params || {};
    const targetEl = p.targetEl;
    const getText = typeof p.getText === 'function' ? p.getText : () => '';

    let enabled = !!p.enabled;
    let timer = null;
    let lastText = '';

    function tick() {
      try {
        if (!enabled) return;
        if (!targetEl) return;
        const text = safeText(getText());
        if (!text) return;

        // Update every second anyway (time changes), but skip re-encode if identical.
        if (text === lastText && lastText) return;
        lastText = text;
        const url = buildTileDataUrl(text, p.tileOptions || null);
        applyAsBackground(targetEl, url, p.applyOptions || null);
      } catch (e) {}
    }

    function start() {
      if (timer) return;
      timer = setInterval(() => {
        try {
          // Force refresh each second (time watermark)
          lastText = '';
          tick();
        } catch (e) {}
      }, 1000);
      tick();
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function setEnabled(v) {
      enabled = !!v;
      if (enabled) {
        ensureNonStaticPosition(targetEl);
        start();
      } else {
        stop();
        lastText = '';
        applyAsBackground(targetEl, '', null);
      }
    }

    function destroy() {
      try {
        setEnabled(false);
      } catch (e) {}
    }

    // init
    setEnabled(enabled);

    return { setEnabled, destroy };
  }

  window.MinechatWatermark = {
    create,
    formatNowSeconds,
  };
})();
