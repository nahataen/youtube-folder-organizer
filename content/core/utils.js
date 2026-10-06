/* Carpetas YouTube — utilidades compartidas (core/utils.js).
 * Primer script del content-script: crea el espacio `window.YTCF` y helpers
 * de DOM, texto, URLs y avisos. Sin estado propio.
 * Todo el DOM se crea con createElement + textContent (sin HTML inyectado). */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  // ---------- Avisos ----------
  function toast(msg) {
    document.querySelector('.ytcf-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'ytcf-toast';
    node.textContent = msg; // textContent: sin HTML inyectado
    document.body.appendChild(node);
    setTimeout(() => node.classList.add('ytcf-toast-show'));
    setTimeout(() => {
      node.classList.remove('ytcf-toast-show');
      setTimeout(() => node.remove(), 300);
    }, 2600);
  }

  // ---------- DOM ----------
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function folderIcon() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ytcf-ico');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute(
      'd',
      'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z'
    );
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  // Círculo con la inicial del canal (respaldo si no hay foto).
  function avatarFallback(name) {
    const node = document.createElement('span');
    node.className = 'ytcf-avatar ytcf-avatar-fallback';
    node.setAttribute('aria-hidden', 'true');
    node.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return node;
  }

  // ---------- URLs y texto ----------
  /** Solo acepta rutas de canal de YouTube para evitar URLs arbitrarias. */
  function safeChannelPath(href) {
    try {
      const u = new URL(href, location.origin);
      if (u.origin !== 'https://www.youtube.com' && u.origin !== location.origin) return null;
      if (!/^\/(@[\w.\-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+)\/?$/.test(u.pathname)) return null;
      return u.pathname.replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  function cleanTitle(t) {
    return (t || '').replace(/\s*-\s*YouTube\s*$/, '').trim().slice(0, 80);
  }

  // Extrae la mejor URL de un <img> de YouTube. Salta placeholders
  // transparentes (data:) y favicons genéricos; usa srcset como respaldo.
  function imgUrl(img) {
    if (!img) return '';
    const candidates = [img.currentSrc, img.getAttribute('src')];
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const first = srcset.split(',')[0].trim().split(/\s+/)[0];
      if (first) candidates.push(first);
    }
    for (let c of candidates) {
      if (!c) continue;
      try {
        c = new URL(c, location.origin).href;
      } catch {
        continue;
      }
      if (c.startsWith('data:')) continue;
      if (/\/s\/desktop\//.test(c)) continue;
      if (/pixel|blank|transparent|placeholder/i.test(c)) continue;
      return c;
    }
    return '';
  }

  // Prueba varios <img> candidatos y devuelve el primer avatar útil.
  function findAvatar(selectors) {
    const imgs = document.querySelectorAll(selectors);
    for (const img of imgs) {
      const url = imgUrl(img);
      if (url) return url;
    }
    return '';
  }

  // ---------- Texto de ytInitialData / RSS ----------
  function runsToText(runs) {
    if (!Array.isArray(runs)) return '';
    return runs.map((r) => r?.text || '').join('');
  }

  function simpleText(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return runsToText(obj.runs) || obj.simpleText || '';
  }

  function pickThumb(thumbs) {
    if (!Array.isArray(thumbs) || thumbs.length === 0) return '';
    return thumbs[thumbs.length - 1]?.url || '';
  }

  function compactViews(n) {
    const x = Number(String(n ?? '').replace(/\D/g, ''));
    if (!x) return '';
    if (x >= 1000000) {
      return `${(x / 1000000).toFixed(1).replace('.', ',').replace(',0', '')} M de vistas`;
    }
    if (x >= 1000) {
      return `${(x / 1000).toFixed(1).replace('.', ',').replace(',0', '')} mil vistas`;
    }
    return `${x} vistas`;
  }

  ns.toast = toast;
  ns.el = el;
  ns.folderIcon = folderIcon;
  ns.avatarFallback = avatarFallback;
  ns.safeChannelPath = safeChannelPath;
  ns.cleanTitle = cleanTitle;
  ns.findAvatar = findAvatar;
  ns.runsToText = runsToText;
  ns.simpleText = simpleText;
  ns.pickThumb = pickThumb;
  ns.compactViews = compactViews;
})(window.YTCF);
