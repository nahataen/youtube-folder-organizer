/* Carpetas YouTube — Módulo de muro de videos por carpeta (folderView.js).
 *
 * Al hacer clic en una carpeta, muestra en el contenido principal de YouTube
 * los videos recientes de los canales de esa carpeta, agrupados por canal.
 * Si la carpeta no tiene canales, muestra un estado vacío con mensaje.
 *
 * Sin API key: obtiene los videos del HTML público de cada canal (/videos).
 * Todo el DOM se crea con createElement + textContent (sin HTML inyectado).
 * Expone: window.YTCFView = { openFolder(folder), close(), getOpenId() } */

(() => {
  'use strict';

  const WALL_ID = 'ytcf-wall';
  const CACHE_TTL = 10 * 60 * 1000; // 10 minutos
  const PER_CHANNEL = 12; // videos por canal

  const cache = new Map(); // key del canal -> { at, videos }
  let hiddenSiblings = []; // nodos de YouTube ocultos mientras el muro está abierto
  let openId = null;
  let requestToken = 0;

  // ---------- Utilidades DOM ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function pageManager() {
    return document.querySelector('ytd-app #page-manager');
  }

  function syncWallTheme() {
    const wall = document.getElementById(WALL_ID);
    if (!wall) return;
    wall.classList.toggle('ytcf-dark', document.documentElement.hasAttribute('dark'));
  }

  // ---------- Extracción de videos (HTML público de /videos) ----------
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

  // Extrae el objeto ytInitialData del HTML con balanceo de llaves (robusto).
  function extractInitialData(html) {
    const idx = html.indexOf('ytInitialData');
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

  // Formato nuevo de YouTube (2024+): lockupViewModel en vez de videoRenderer.
  // contentType distingue videos de shorts/otros (solo aceptamos VIDEO).
  function parseLockup(lockup) {
    if (!lockup || typeof lockup !== 'object') return null;
    if (lockup.contentType && lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
    const tap = lockup.rendererContext?.commandContext?.onTap?.innertubeCommand;
    const urlId = tap?.commandMetadata?.webCommandMetadata?.url?.match(/[?&]v=([\w-]{11})/)?.[1];
    const videoId = tap?.watchEndpoint?.videoId || urlId || lockup.contentId;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || '')) return null;

    const meta = lockup.metadata?.lockupMetadataViewModel;
    const rawTitle = meta?.title;
    const title =
      (typeof rawTitle?.content === 'string' && rawTitle.content) ||
      simpleText(rawTitle) ||
      'Video';

    // Miniatura: la fuente de mayor ancho.
    let thumb = '';
    let bestW = -1;
    const sources = lockup.contentImage?.thumbnailViewModel?.image?.sources || [];
    for (const s of sources) {
      if (s?.url && (s.width || 0) >= bestW) {
        bestW = s.width || 0;
        thumb = s.url;
      }
    }

    // Duración: primer badge del overlay inferior de la miniatura.
    let duration = '';
    const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || [];
    for (const o of overlays) {
      const badges = o?.thumbnailBottomOverlayViewModel?.badges || [];
      for (const b of badges) {
        const t = b?.thumbnailBadgeViewModel?.text;
        if (typeof t === 'string' && t) {
          duration = t;
          break;
        }
      }
      if (duration) break;
    }

    // Vistas/fecha: partes de texto de las filas de metadatos.
    const parts = [];
    const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
    for (const r of rows) {
      for (const p of r?.metadataParts || []) {
        const t =
          (typeof p?.text?.content === 'string' && p.text.content) || simpleText(p?.text);
        if (t) parts.push(t);
      }
    }
    // Heurística: la parte con palabras de tiempo es la fecha; la otra, vistas.
    let views = '';
    let published = '';
    const isTime = (s) =>
      /\bhace\b|hora|día|semana|mes|año|minuto|segundo|hour|minute|second|day|week|month|year|ago|streamed|transmitido|directo|live|premiere|estreno/i.test(
        s
      );
    for (const p of parts) {
      if (!published && isTime(p)) published = p;
      else if (!views) views = p;
    }

    return { videoId, title: String(title).slice(0, 150), thumb, duration, views, published };
  }

  // Recorre todo el JSON buscando videos donde sea que YouTube los ponga
  // (robusto ante cambios de layout: listas, parrillas, estantes, secciones).
  function crawlVideos(node, out, depth) {
    if (!node || out.length >= PER_CHANNEL || depth > 10) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        crawlVideos(item, out, depth + 1);
        if (out.length >= PER_CHANNEL) break;
      }
      return;
    }
    if (typeof node !== 'object') return;
    if (node.continuationItemRenderer) return;
    // Formato nuevo (lockupViewModel) tiene prioridad; abajo el clásico.
    if (node.lockupViewModel && typeof node.lockupViewModel === 'object') {
      const parsed = parseLockup(node.lockupViewModel);
      if (parsed && !out.some((o) => o.videoId === parsed.videoId)) out.push(parsed);
      return; // no baja más dentro de un item ya procesado
    }
    const v = node.videoRenderer || node.gridVideoRenderer || node.compactVideoRenderer;
    if (v?.videoId && /^[a-zA-Z0-9_-]{11}$/.test(v.videoId)) {
      if (!out.some((o) => o.videoId === v.videoId)) {
        out.push({
          videoId: v.videoId,
          title: simpleText(v.title) || 'Video',
          thumb: pickThumb(v.thumbnail?.thumbnails),
          duration: simpleText(v.lengthText),
          views: simpleText(v.viewCountText) || simpleText(v.shortViewCountText),
          published: simpleText(v.publishedTimeText)
        });
      }
      return; // no baja más dentro de un video ya capturado
    }
    for (const key of Object.keys(node)) {
      crawlVideos(node[key], out, depth + 1);
      if (out.length >= PER_CHANNEL) break;
    }
  }

  function parseVideos(data) {
    const out = [];
    try {
      crawlVideos(data?.contents, out, 0);
    } catch {
      // Estructura inesperada: se devuelve lo recolectado hasta ahora.
    }
    return out;
  }

  async function scrapeChannelVideos(channel) {
    const res = await fetch(`${channel.url}/videos`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const data = extractInitialData(html);
    if (!data) throw new Error('Sin datos');
    return parseVideos(data);
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

  // Respaldo RSS (funciona sin sesión y sin consentimiento) para claves /channel/ID.
  async function fetchRssVideos(channel) {
    const m = channel.key.match(/^\/channel\/(UC[\w-]{22})$/);
    if (!m) throw new Error('Sin RSS para esta URL');
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`);
    if (!res.ok) throw new Error(`RSS ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const entries = [...doc.getElementsByTagName('entry')].slice(0, PER_CHANNEL);
    if (entries.length === 0) throw new Error('RSS vacío');
    const text = (entry, tag) => entry.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
    return entries
      .map((entry) => {
        const videoId = text(entry, 'yt:videoId');
        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
        const thumb = entry.getElementsByTagName('media:thumbnail')[0];
        const stats = entry.getElementsByTagName('media:statistics')[0];
        return {
          videoId,
          title: text(entry, 'title') || 'Video',
          thumb:
            thumb?.getAttribute('url') || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: '',
          views: compactViews(stats?.getAttribute('views')),
          published: text(entry, 'published').slice(0, 10)
        };
      })
      .filter(Boolean);
  }

  async function fetchChannelVideos(channel) {
    const cached = cache.get(channel.key);
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.videos;
    let videos = [];
    let scrapedOk = true;
    try {
      videos = await scrapeChannelVideos(channel);
    } catch {
      scrapedOk = false;
      videos = [];
    }
    if (videos.length === 0 && !scrapedOk) {
      try {
        videos = await fetchRssVideos(channel); // respaldo
      } catch {
        throw new Error('Sin videos');
      }
      if (videos.length === 0) throw new Error('Sin videos');
    }
    cache.set(channel.key, { at: Date.now(), videos });
    return videos;
  }

  // ---------- Construcción del muro ----------
  function buildHeader(wall, folder, onRefresh) {
    const head = el('div', 'ytcf-wall-head');

    const back = el('button', 'ytcf-btn ytcf-btn-ghost', '← Volver');
    back.type = 'button';
    back.title = 'Volver al contenido de YouTube';
    back.addEventListener('click', close);

    const titles = el('div', 'ytcf-wall-titles');
    titles.appendChild(el('h2', 'ytcf-wall-title', folder.name));
    titles.appendChild(
      el(
        'p',
        'ytcf-wall-sub',
        folder.channels.length === 0
          ? 'Sin canales'
          : `${folder.channels.length} ${folder.channels.length === 1 ? 'canal' : 'canales'}`
      )
    );

    const refresh = el('button', 'ytcf-btn ytcf-btn-ghost', '↻ Actualizar');
    refresh.type = 'button';
    refresh.title = 'Volver a cargar los videos';
    refresh.addEventListener('click', onRefresh);

    head.appendChild(back);
    head.appendChild(titles);
    head.appendChild(refresh);
    wall.appendChild(head);
  }

  function buildEmpty(wall) {
    const box = el('div', 'ytcf-wall-empty');
    box.appendChild(el('div', 'ytcf-wall-empty-icon', '📁'));
    box.appendChild(
      el('p', 'ytcf-wall-empty-text', 'Aún no has agregado canales a esta categoría.')
    );
    box.appendChild(
      el(
        'p',
        'ytcf-wall-empty-hint',
        'Visita la página de un canal o un video y usa «Añadir canal actual» en el sidebar.'
      )
    );
    wall.appendChild(box);
  }

  function buildSkeleton(wall, n = 8) {
    const wrap = el('div', 'ytcf-wall-loading');
    const grid = el('div', 'ytcf-grid');
    for (let i = 0; i < n; i++) {
      const card = el('div', 'ytcf-card ytcf-skel-card');
      card.appendChild(el('div', 'ytcf-skel-thumb'));
      card.appendChild(el('div', 'ytcf-skel-line'));
      card.appendChild(el('div', 'ytcf-skel-line ytcf-skel-short'));
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    wall.appendChild(wrap);
  }

  function channelAvatarFallback(name) {
    const wrap = el(
      'span',
      'ytcf-avatar ytcf-avatar-fallback',
      (name || '?').trim().charAt(0).toUpperCase() || '?'
    );
    wrap.setAttribute('aria-hidden', 'true');
    return wrap;
  }

  function videoCard(v, channelName) {
    const a = el('a', 'ytcf-card');
    a.href = `https://www.youtube.com/watch?v=${v.videoId}`;
    a.title = v.title;

    const thumbWrap = el('div', 'ytcf-thumb');
    if (v.thumb) {
      const img = document.createElement('img');
      img.className = 'ytcf-thumb-img';
      img.alt = '';
      img.loading = 'lazy';
      img.src = v.thumb;
      img.referrerPolicy = 'no-referrer';
      thumbWrap.appendChild(img);
    }
    if (v.duration) thumbWrap.appendChild(el('span', 'ytcf-dur', v.duration));

    const meta = el('div', 'ytcf-meta');
    meta.appendChild(el('div', 'ytcf-vtitle', v.title));
    meta.appendChild(el('div', 'ytcf-vchan', channelName));
    const stats = [v.views, v.published].filter(Boolean).join(' • ');
    if (stats) meta.appendChild(el('div', 'ytcf-vstats', stats));

    a.appendChild(thumbWrap);
    a.appendChild(meta);
    return a;
  }

  function channelSection(channel, videos, failed) {
    const sec = el('section', 'ytcf-chan-sec');

    const head = el('div', 'ytcf-chan-head');
    const link = el('a', 'ytcf-chan-link');
    link.href = channel.url;
    link.title = `Ir al canal ${channel.name}`;
    if (channel.avatar) {
      const img = document.createElement('img');
      img.className = 'ytcf-avatar';
      img.alt = '';
      img.loading = 'lazy';
      img.src = channel.avatar;
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.replaceWith(channelAvatarFallback(channel.name)), {
        once: true
      });
      link.appendChild(img);
    } else {
      link.appendChild(channelAvatarFallback(channel.name));
    }
    link.appendChild(el('span', 'ytcf-chan-name', channel.name));
    head.appendChild(link);
    if (!failed) head.appendChild(el('span', 'ytcf-count', String(videos.length)));
    sec.appendChild(head);

    if (failed) {
      sec.appendChild(
        el('p', 'ytcf-hint', `No se pudieron cargar los videos de ${channel.name}.`)
      );
      return sec;
    }
    if (videos.length === 0) {
      sec.appendChild(el('p', 'ytcf-hint', `${channel.name} aún no muestra videos.`));
      return sec;
    }
    const grid = el('div', 'ytcf-grid');
    for (const v of videos) grid.appendChild(videoCard(v, channel.name));
    sec.appendChild(grid);
    return sec;
  }

  // ---------- Abrir / cerrar ----------
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  // YouTube tiene la barra superior fija: si tapa el inicio del muro,
  // añade relleno superior extra para que nada quede cortado arriba.
  function fixTopOverlap(wall) {
    if (!wall || !wall.isConnected) return;
    wall.style.paddingTop = '';
    const masthead = document.querySelector('ytd-masthead');
    const mastH = masthead ? Math.round(masthead.getBoundingClientRect().height) : 56;
    const top = Math.round(wall.getBoundingClientRect().top);
    if (top < mastH) {
      wall.style.paddingTop = `calc(24px + ${mastH - top}px)`;
    }
  }

  function onResize() {
    const wall = document.getElementById(WALL_ID);
    if (wall) fixTopOverlap(wall);
  }

  async function openFolder(folder, opts = {}) {
    const pm = pageManager();
    if (!pm || !folder) return;
    const token = ++requestToken;
    openId = folder.id;

    let wall = document.getElementById(WALL_ID);
    if (!wall) {
      wall = el('div', 'ytcf-wall');
      wall.id = WALL_ID;
    }
    // Oculta el contenido normal de YouTube (se restaura al cerrar).
    hiddenSiblings = [];
    for (const child of [...pm.children]) {
      if (child === wall) continue;
      hiddenSiblings.push(child);
      child.style.display = 'none';
    }
    if (!wall.isConnected) pm.prepend(wall);
    wall.replaceChildren();
    syncWallTheme();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    requestAnimationFrame(() => fixTopOverlap(wall));

    buildHeader(wall, folder, () => openFolder(folder, { bust: true }));

    if (folder.channels.length === 0) {
      buildEmpty(wall);
      window.scrollTo({ top: 0 });
      return;
    }

    buildSkeleton(wall);
    window.scrollTo({ top: 0 });

    if (opts.bust) {
      for (const ch of folder.channels) cache.delete(ch.key);
    }
    // Por tandas de 3 y pintado progresivo: evita ráfagas de peticiones
    // (ritmo parecido al de navegar a mano) y muestra antes los primeros.
    const CONCURRENCY = 3;
    let firstBatch = true;
    for (let i = 0; i < folder.channels.length; i += CONCURRENCY) {
      const batch = folder.channels.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map((ch) => fetchChannelVideos(ch)));
      // Si el usuario abrió otra carpeta mientras cargaba, esto ya no vale.
      if (token !== requestToken || openId !== folder.id) return;
      if (firstBatch) {
        wall.querySelector('.ytcf-wall-loading')?.remove();
        firstBatch = false;
      }
      results.forEach((r, j) => {
        wall.appendChild(
          channelSection(batch[j], r.status === 'fulfilled' ? r.value : [], r.status !== 'fulfilled')
        );
      });
    }
  }

  function close() {
    if (!openId && !document.getElementById(WALL_ID)) return;
    openId = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.getElementById(WALL_ID)?.remove();
    for (const n of hiddenSiblings) {
      if (n.isConnected) n.style.display = '';
    }
    hiddenSiblings = [];
  }

  // Si YouTube re-renderiza y retira el muro, suelta las referencias sin pelear.
  new MutationObserver(() => {
    if (openId && !document.getElementById(WALL_ID)) {
      openId = null;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      for (const n of hiddenSiblings) {
        if (n.isConnected) n.style.display = '';
      }
      hiddenSiblings = [];
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Tema claro/oscuro (<html dark>).
  new MutationObserver(syncWallTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['dark']
  });

  window.YTCFView = { openFolder, close, getOpenId: () => openId };
})();
