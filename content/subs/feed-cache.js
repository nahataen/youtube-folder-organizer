/* Carpetas YouTube — caché de la página /feed/channels (subs/feed-cache.js).
 * Cuando el usuario VISITA su lista amplia de suscripciones, la página ya la
 * trae renderizada con su sesión completa: se lee del DOM (cero peticiones
 * extra) y se guarda en la BD SQLite para que el popup abra al instante.
 * Solo guarda si la lectura supera lo guardado (evita pisar 600 con 30 a
 * medio renderizar). Incluye los botones flotantes dedicados de esa página.
 * Expone: getFreshStoredSubs / getAnyStoredSubs / saveStoredSubs /
 * clearStoredSubs. El observador trabaja solo; nadie necesita llamarlo. */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const SCAN_DELAY = 1500; // espera al render de YouTube tras navegar/scroll

  let feedTimer = 0;

  function isFeedPage() {
    return location.pathname.startsWith('/feed/channels');
  }

  function findItemAvatar(link) {
    let node = link;
    for (let i = 0; i < 5 && node; i++) {
      const img = node.querySelector?.('img');
      if (img) {
        // data-src: YouTube a veces deja la real ahí hasta que baja por scroll.
        const ds = img.getAttribute('data-src') || '';
        if (ds && !ds.startsWith('data:')) {
          try {
            return new URL(ds, location.origin).href;
          } catch {
            // URL inválida: se sigue con imgUrl abajo.
          }
        }
        const url = ns.imgUrl(img);
        if (url) return url;
      }
      node = node.parentElement;
    }
    return '';
  }

  // Lee los canales YA renderizados en la página de suscripciones.
  function readFeedPageSubs() {
    if (!isFeedPage()) return [];
    const root =
      document.querySelector('ytd-browse[page-subtype="channels"] #contents') ||
      document.querySelector('ytd-browse #contents') ||
      document.querySelector('ytd-app #page-manager');
    if (!root) return [];
    const out = [];
    for (const a of root.querySelectorAll('a[href]')) {
      if (out.length >= 2000) break;
      const key = ns.safeChannelPath(a.getAttribute('href'));
      if (!key) continue;
      if (out.some((o) => o.key === key)) continue;
      const name = (
        a.querySelector('.title')?.textContent ||
        a.querySelector('yt-formatted-string')?.textContent ||
        a.getAttribute('title') ||
        a.getAttribute('aria-label') ||
        ''
      )
        .trim()
        .slice(0, 80);
      if (!name) continue;
      out.push({
        key,
        name,
        url: `https://www.youtube.com${key}`,
        avatar: findItemAvatar(a),
        detail: ''
      });
    }
    return out;
  }

  // Cliente de la BD SQLite del service worker (background.js). Mantiene la
  // misma API (fresh/any/save/clear) para no tocar al resto del módulo.
  async function dbCall(op, rows) {
    return chrome.runtime.sendMessage({ scope: 'ytcf-subsdb', op, rows });
  }

  async function readAll() {
    try {
      const r = await dbCall('all');
      if (r && r.ok && Array.isArray(r.rows)) {
        return { rows: r.rows, savedAt: Number(r.savedAt || 0) };
      }
    } catch {
      // Service worker no disponible.
    }
    return null;
  }

  // Caché fresco (TTL compartido de 10 min): base instantánea del popup.
  async function getFreshStoredSubs() {
    const data = await readAll();
    if (data && data.rows.length > 0 && Date.now() - data.savedAt < ns.SUBS_TTL) {
      return data.rows;
    }
    return [];
  }

  // Caché de cualquier edad: último recurso antes que vacío.
  async function getAnyStoredSubs() {
    const data = await readAll();
    return data && data.rows.length > 0 ? data.rows : [];
  }

  // Persiste fusionando: conserva avatar/detalle ya guardados cuando el
  // escaneo aún no los cargó (lazy-load), y nunca pisa una lista mayor con
  // una parcial a medio renderizar. Devuelve si guardó y el total vigente.
  async function saveStoredSubs(subs) {
    if (!Array.isArray(subs) || subs.length === 0) return { saved: false, total: 0 };
    try {
      const data = await readAll();
      const prev = data ? data.rows : [];
      if (prev.length > 0 && subs.length < prev.length) {
        return { saved: false, total: prev.length };
      }
      const prevByKey = new Map(prev.map((s) => [s.key, s]));
      const merged = subs.map((s) => {
        const old = prevByKey.get(s.key);
        if (!old) return s;
        return { ...s, avatar: s.avatar || old.avatar, detail: s.detail || old.detail };
      });
      const w = await dbCall('replace', merged);
      if (w && w.ok) return { saved: true, total: merged.length };
      return { saved: false, total: prev.length };
    } catch {
      // Service worker no disponible.
      return { saved: false, total: 0 };
    }
  }

  // Borra la lista guardada para volver a guardarla desde cero.
  async function clearStoredSubs() {
    try {
      await dbCall('clear');
    } catch {
      // Service worker no disponible.
    }
  }

  // ---------- Botones dedicados en /feed/channels ----------
  // Barra flotante abajo-derecha, solo en esa página: baja hasta el final de
  // tu lista con tu propio scroll y pulsa guardar; si quedó mal cacheada
  // (p. ej. sin fotos por guardar antes de que cargaran), Límpiala y vuelve
  // a guardarla. El botón de guardado muestra cuántos canales ve ahora mismo.
  const FEEDBAR_ID = 'ytcf-feed-bar';
  const FEEDBTN_ID = 'ytcf-feed-save';
  const FEEDCLEAR_ID = 'ytcf-feed-clear';

  function updateFeedButton() {
    const btn = document.getElementById(FEEDBTN_ID);
    if (!btn) return;
    const n = readFeedPageSubs().length;
    btn.textContent = n > 0 ? `💾 Guardar lista (${n})` : '💾 Guardar lista';
  }

  async function saveFeedNow() {
    const found = readFeedPageSubs();
    if (found.length === 0) {
      ns.toast('Aún no veo canales: espera a que cargue la página.');
      return;
    }
    const r = await saveStoredSubs(found);
    updateFeedButton();
    ns.toast(
      r.saved
        ? `Lista guardada: ${found.length} ${found.length === 1 ? 'canal' : 'canales'}. Ya puedes abrir el popup.`
        : `Baja más abajo: ya hay ${r.total} guardados y aquí veo ${found.length}.`
    );
  }

  async function clearFeedNow() {
    if (!confirm('¿Borrar la lista de suscripciones guardada? Podrás guardarla de nuevo con «Guardar lista».')) {
      return;
    }
    await ns.clearStoredSubs();
    updateFeedButton();
    ns.toast('Lista borrada. Baja hasta abajo y pulsa «Guardar lista».');
  }

  function ensureFeedButton() {
    if (!isFeedPage()) {
      document.getElementById(FEEDBAR_ID)?.remove();
      return;
    }
    let bar = document.getElementById(FEEDBAR_ID);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = FEEDBAR_ID;
      bar.className = 'ytcf-feed-bar';
      const clear = document.createElement('button');
      clear.id = FEEDCLEAR_ID;
      clear.className = 'ytcf-feed-clear';
      clear.type = 'button';
      clear.textContent = '🗑 Limpiar';
      clear.title = 'Borrar la lista guardada para volver a guardarla';
      clear.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFeedNow();
      });
      const save = document.createElement('button');
      save.id = FEEDBTN_ID;
      save.className = 'ytcf-feed-save';
      save.type = 'button';
      save.title = 'Baja hasta el final de tu lista y pulsa para guardarla en la extensión';
      save.addEventListener('click', (e) => {
        e.stopPropagation();
        saveFeedNow();
      });
      bar.appendChild(clear);
      bar.appendChild(save);
      document.body.appendChild(bar);
    }
    updateFeedButton();
  }

  function scanFeedPage() {
    if (!isFeedPage()) return;
    saveStoredSubs(readFeedPageSubs());
    updateFeedButton();
  }

  function scheduleFeedScan() {
    if (!isFeedPage()) return;
    clearTimeout(feedTimer);
    feedTimer = setTimeout(scanFeedPage, SCAN_DELAY);
  }

  ns.getFreshStoredSubs = getFreshStoredSubs;
  ns.getAnyStoredSubs = getAnyStoredSubs;
  ns.saveStoredSubs = saveStoredSubs;
  ns.clearStoredSubs = clearStoredSubs;

  // YouTube es SPA: re-escanea al navegar a la página y al hacer scroll
  // (el usuario pagina con su propio scroll y el caché crece solo).
  // El botón dedicado se crea/retira con la navegación.
  scheduleFeedScan();
  ensureFeedButton();
  let lastFeedUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastFeedUrl) {
      lastFeedUrl = location.href;
      ensureFeedButton();
      scheduleFeedScan();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', scheduleFeedScan, { passive: true, capture: true });
})(window.YTCF);
