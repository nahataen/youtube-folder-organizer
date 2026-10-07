/* Carpetas YouTube — lectura de suscripciones (subs/subs.js).
 * Cargador incremental: el popup abre con la primera tanda y `ensureSubs(n)`
 * pide más tandas solo al avanzar de página (hasta ~1500 canales).
 * Fuentes fusionadas sin duplicados: feed directo youtubei (browse FEchannels
 * + continuations) con las claves de tu sesión (HTML de /feed/channels o DOM
 * de la página abierta), bloques del HTML y guía lateral sin peticiones.
 * Caché de 10 min reanudable. Requiere sesión iniciada.
 * Errores: 'AUTH' (login/consentimiento) o 'EMPTY'. */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const SUBS_TTL = 10 * 60 * 1000; // 10 minutos
  const MAX_SUBS = 2000; // tope de seguridad (cubre listados grandes)

  let cache = null; // { at, subs }

  function norm(id, name, avatar, detail) {
    if (!id || typeof id !== 'string') return null;
    return {
      key: `/channel/${id}`,
      name: String(name || 'Canal').slice(0, 80),
      url: `https://www.youtube.com/channel/${id}`,
      avatar: avatar || '',
      detail: detail || ''
    };
  }

  function parseLockupChannel(lockup) {
    const meta = lockup.metadata?.lockupMetadataViewModel;
    const rawTitle = meta?.title;
    const name =
      (typeof rawTitle?.content === 'string' && rawTitle.content) ||
      ns.simpleText(rawTitle);
    let avatar = '';
    let bestW = -1;
    for (const s of lockup.contentImage?.thumbnailViewModel?.image?.sources || []) {
      if (s?.url && (s.width || 0) >= bestW) {
        bestW = s.width || 0;
        avatar = s.url;
      }
    }
    const detail = (meta?.metadata?.contentMetadataViewModel?.metadataRows || [])
      .flatMap((r) => r?.metadataParts || [])
      .map(
        (p) =>
          (typeof p?.text?.content === 'string' && p.text.content) || ns.simpleText(p?.text)
      )
      .filter(Boolean)
      .join(' · ');
    return norm(lockup.contentId, name, avatar, detail);
  }

  function parseChannelRenderer(r) {
    const detail = [ns.simpleText(r.subscriberCountText), ns.simpleText(r.videoCountText)]
      .filter(Boolean)
      .join(' · ');
    return norm(r.channelId, ns.simpleText(r.title), ns.pickThumb(r.thumbnail?.thumbnails), detail);
  }

  // Recorre todo el JSON buscando canales (robusto ante cambios de layout).
  function crawlChannels(node, out, depth) {
    if (!node || depth > 12 || out.length >= MAX_SUBS) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        crawlChannels(item, out, depth + 1);
        if (out.length >= MAX_SUBS) break;
      }
      return;
    }
    if (typeof node !== 'object') return;
    if (node.continuationItemRenderer) return;
    const lockup = node.lockupViewModel;
    if (lockup && typeof lockup === 'object') {
      if (lockup.contentType === 'LOCKUP_CONTENT_TYPE_CHANNEL') {
        const parsed = parseLockupChannel(lockup);
        if (parsed && !out.some((o) => o.key === parsed.key)) out.push(parsed);
      }
      return; // no baja más dentro de un item ya procesado
    }
    const r = node.channelRenderer || node.gridChannelRenderer;
    if (r && typeof r === 'object' && r.channelId) {
      const parsed = parseChannelRenderer(r);
      if (parsed && !out.some((o) => o.key === parsed.key)) out.push(parsed);
      return;
    }
    // Formato genérico: cualquier objeto con id + título de canal (sin ser
    // video ni lista). Cubre renderers nuevos que YouTube renombre.
    if (
      typeof node.channelId === 'string' &&
      node.title &&
      !node.videoId &&
      !node.playlistId
    ) {
      const parsed = parseChannelRenderer(node);
      if (parsed && !out.some((o) => o.key === parsed.key)) out.push(parsed);
      return;
    }
    for (const key of Object.keys(node)) {
      crawlChannels(node[key], out, depth + 1);
      if (out.length >= MAX_SUBS) break;
    }
  }

  // Busca el token de continuación (más canales al hacer scroll en la web).
  function findContinuationToken(node, depth = 0) {
    if (!node || depth > 15) return '';
    if (Array.isArray(node)) {
      for (const item of node) {
        const t = findContinuationToken(item, depth + 1);
        if (t) return t;
      }
      return '';
    }
    if (typeof node !== 'object') return '';
    const t = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof t === 'string' && t) return t;
    for (const key of Object.keys(node)) {
      const found = findContinuationToken(node[key], depth + 1);
      if (found) return found;
    }
    return '';
  }

  // Extrae un objeto JSON tras una marca con balanceo de llaves (robusto).
  function extractJsonAfter(html, marker) {
    const idx = html.indexOf(marker);
    if (idx < 0) return null;
    const start = html.indexOf('{', idx);
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let quote = '';
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === quote) inStr = false;
      } else if (c === '"' || c === "'") {
        inStr = true;
        quote = c;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  // Clave y contexto exactos que la propia web usa para pedir más tandas.
  function innertubeConfig(html) {
    const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || '';
    const context = extractJsonAfter(html, '"INNERTUBE_CONTEXT"');
    return { key, context };
  }

  // Claves de la sesión desde el DOM de la página abierta (plan B cuando el
  // fetch de /feed/channels no trae HTML útil: la web ya las cargó en sus
  // <script>, y el content-script sí puede leer ese texto).
  function domInnertubeConfig() {
    try {
      for (const s of document.querySelectorAll('script')) {
        const text = s.textContent || '';
        if (!text.includes('INNERTUBE_API_KEY')) continue;
        const key = text.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || '';
        const context = extractJsonAfter(text, '"INNERTUBE_CONTEXT"');
        if (key && context) return { key, context };
      }
    } catch {
      // DOM inaccesible: se devuelve vacío abajo.
    }
    return { key: '', context: null };
  }

  // Config para youtubei: primero el HTML de /feed/channels; si no sirve,
  // las claves del DOM actual. Lanza 'AUTH' si hubo redirección a login.
  async function getBrowseConfig() {
    let html = '';
    let authed = true;
    try {
      const res = await fetch('https://www.youtube.com/feed/channels', {
        credentials: 'same-origin'
      });
      if (/consent\.youtube\.com|accounts\.google\.com/.test(res.url || '')) {
        authed = false;
      } else if (res.ok) {
        html = await res.text();
      }
    } catch {
      // Sin red: se intenta el DOM actual abajo.
    }
    if (html) {
      const cfg = innertubeConfig(html);
      if (cfg.key && cfg.context) return { key: cfg.key, context: cfg.context, html };
    }
    const domCfg = domInnertubeConfig();
    if (domCfg.key && domCfg.context) return { key: domCfg.key, context: domCfg.context, html: '' };
    throw new Error(authed ? 'EMPTY' : 'AUTH');
  }

  // Prueba de sesión para youtubei: la web firma sus llamadas con un hash de
  // la cookie SAPISID (misma fórmula que el cliente oficial). Sin esta
  // cabecera YouTube responde como anónimo aunque las cookies viajen.
  async function sha1Hex(text) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const sid =
        document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/)?.[1] ||
        document.cookie.match(/(?:^|;\s*)__Secure-3PAPISID=([^;]+)/)?.[1] ||
        '';
      if (sid) {
        const ts = Math.floor(Date.now() / 1000);
        const hash = await sha1Hex(`${ts} ${decodeURIComponent(sid)} ${location.origin}`);
        headers.Authorization = `SAPISIDHASH ${ts}_${hash}`;
        headers['X-Origin'] = location.origin;
        headers['X-Goog-AuthUser'] = '0';
      }
    } catch {
      // Sin firma: la llamada irá como anónima y el flujo la degradará.
    }
    return headers;
  }

  // Llamada directa a la API interna (lo mismo que la web al navegar/paginar).
  async function browseJson(apiKey, context, extra) {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: await authHeaders(),
        body: JSON.stringify({ context, ...extra })
      }
    );
    if (res.status === 401 || res.status === 403) throw new Error('AUTH');
    if (!res.ok) throw new Error(`browse ${res.status}`);
    return res.json();
  }

  // Respaldo sin peticiones: lee los canales que YouTube ya renderizó en la
  // guía lateral (menú). Cero tráfico extra: es lo mismo que ver la pantalla.
  // Solo aporta lo visible en la guía; se fusiona con lo del fetch.
  function readGuideSubs() {
    const out = [];
    const links = document.querySelectorAll(
      'ytd-guide-renderer ytd-guide-entry-renderer a[href]'
    );
    for (const a of links) {
      const key = ns.safeChannelPath(a.getAttribute('href'));
      if (!key) continue; // Inicio, Shorts, Historial… no son canales
      const name = (
        a.querySelector('.title')?.textContent ||
        a.querySelector('yt-formatted-string')?.textContent ||
        a.getAttribute('title') ||
        ''
      )
        .trim()
        .slice(0, 80);
      if (!name) continue;
      if (out.some((o) => o.key === key)) continue;
      out.push({
        key,
        name,
        url: `https://www.youtube.com${key}`,
        avatar: ns.imgUrl(a.querySelector('img')),
        detail: ''
      });
    }
    return out;
  }

  // ---------- Cargador incremental (30 por página bajo demanda) ----------
  // El popup abre con la primera tanda y solo pide más tandas al avanzar
  // de página. `session` vive en memoria; `cache` permite reanudar 10 min.
  let session = null; // { items, nextToken, exhausted, key, context }
  // cache = { at, items, nextToken, exhausted, key, context }

  function mergeList(out, list) {
    for (const sub of list) {
      const i = out.findIndex((o) => o.key === sub.key);
      if (i < 0) out.push(sub);
      else if (isStubChannel(out[i]) && !isStubChannel(sub)) out[i] = sub;
    }
  }

  // Registro provisional: sin foto y con nombre genérico (viene de un import
  // sin nombres). Se mejora en cuanto llega el dato real con nombre/foto.
  function isStubChannel(s) {
    return (
      !s.avatar && (!s.name || s.name === 'Canal' || /^Canal [\w-]{4}$/.test(s.name || ''))
    );
  }

  // Arranque: base instantánea del caché de /feed/channels + red (config,
  // bloques del HTML, guía y primera tanda del feed). Lanza 'AUTH'/'EMPTY'
  // solo si no hay nada que mostrar.
  async function initSession() {
    session = { items: [], nextToken: '', exhausted: false, key: '', context: '' };
    let authFailed = false;
    // 1) Base instantánea: lo cacheado al visitar /feed/channels.
    mergeList(session.items, await ns.getFreshStoredSubs());
    // 2) Red: completa y deja token para paginar.
    try {
      const cfg = await getBrowseConfig();
      session.key = cfg.key;
      session.context = cfg.context;
      if (cfg.html) {
        for (const data of ns.extractAllInitialData(cfg.html)) crawlChannels(data, session.items, 0);
      }
      mergeList(session.items, readGuideSubs());
      try {
        const first = await browseJson(cfg.key, cfg.context, { browseId: 'FEchannels' });
        crawlChannels(first, session.items, 0);
        session.nextToken = findContinuationToken(first);
      } catch (e) {
        if (e && e.message === 'AUTH') throw e;
        // browse no disponible: vale la base y la guía.
      }
      if (!session.nextToken) session.exhausted = true;
    } catch (e) {
      authFailed = e && e.message === 'AUTH';
      session.exhausted = true; // sin config no hay más tandas; vale la base
    }
    // 3) Último recurso: caché viejo de cualquier edad antes que vacío.
    if (session.items.length === 0) {
      mergeList(session.items, await ns.getAnyStoredSubs());
    }
    if (session.items.length === 0) throw new Error(authFailed ? 'AUTH' : 'EMPTY');
  }

  // Una tanda más (equivale a seguir paginando en la web).
  async function loadNextBatch() {
    if (!session || session.exhausted) return;
    if (!session.nextToken) {
      session.exhausted = true;
      return;
    }
    try {
      const json = await browseJson(session.key, session.context, {
        continuation: session.nextToken
      });
      crawlChannels(json, session.items, 0);
      session.nextToken = findContinuationToken(json);
      if (!session.nextToken) session.exhausted = true;
    } catch {
      session.exhausted = true; // ante fallo de red, no reintentar en bucle
    }
  }

  // Garantiza al menos `n` canales cargados. Devuelve lo cargado hasta ahora
  // y si queda más por pedir (`hasMore`).
  async function ensureSubs(n) {
    if (cache && Date.now() - cache.at < SUBS_TTL) {
      session = {
        items: cache.items,
        nextToken: cache.nextToken,
        exhausted: cache.exhausted,
        key: cache.key,
        context: cache.context
      };
    }
    if (!session) await initSession();
    let guard = 0;
    while (session.items.length < n && !session.exhausted && guard < 15) {
      guard++;
      await loadNextBatch();
    }
    cache = {
      at: Date.now(),
      items: session.items,
      nextToken: session.nextToken,
      exhausted: session.exhausted,
      key: session.key,
      context: session.context
    };
    await ns.saveStoredSubs(session.items); // persiste lo logrado para el popup
    return { items: session.items, hasMore: !session.exhausted };
  }

  function bustSubsCache() {
    cache = null;
    session = null;
  }

  ns.ensureSubs = ensureSubs;
  ns.bustSubsCache = bustSubsCache;
  ns.SUBS_TTL = SUBS_TTL; // lo usa feed-cache para la frescura del caché
})(window.YTCF);
