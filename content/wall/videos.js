/* Carpetas YouTube — obtención de videos por canal (wall/videos.js).
 * Sin API key: lee el HTML público de cada canal (/videos) y, como respaldo,
 * el RSS oficial (solo claves /channel/UC…).
 * Caché de 10 min por canal. Lógica pura de datos, sin DOM propio. */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const CACHE_TTL = 10 * 60 * 1000; // 10 minutos
  const PER_CHANNEL = 12; // videos por canal

  const cache = new Map(); // key del canal -> { at, videos }

  // Extrae el objeto ytInitialData del HTML con balanceo de llaves (robusto).
  function extractInitialData(html) {
    const all = extractAllInitialData(html);
    return all.length > 0 ? all[0] : null;
  }

  // Todas las ocurrencias válidas: la primera mención de `ytInitialData`
  // no siempre es el dato (puede ser una referencia previa), así que se
  // prueban todas y se devuelve cada bloque que parsea bien (máx. 5).
  function extractAllInitialData(html) {
    const out = [];
    let from = 0;
    let guard = 0;
    while (out.length < 5 && guard < 12) {
      guard++;
      const idx = html.indexOf('ytInitialData', from);
      if (idx < 0) break;
      from = idx + 'ytInitialData'.length;
      const parsed = extractBalancedFrom(html, idx);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  function extractBalancedFrom(html, idx) {
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
      ns.simpleText(rawTitle) ||
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
          (typeof p?.text?.content === 'string' && p.text.content) || ns.simpleText(p?.text);
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
          title: ns.simpleText(v.title) || 'Video',
          thumb: ns.pickThumb(v.thumbnail?.thumbnails),
          duration: ns.simpleText(v.lengthText),
          views: ns.simpleText(v.viewCountText) || ns.simpleText(v.shortViewCountText),
          published: ns.simpleText(v.publishedTimeText)
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
          views: ns.compactViews(stats?.getAttribute('views')),
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

  function bustChannelCache(channels) {
    for (const ch of channels) cache.delete(ch.key);
  }

  ns.fetchChannelVideos = fetchChannelVideos;
  ns.bustChannelCache = bustChannelCache;
  // Se reutiliza para leer /feed/channels en el módulo de suscripciones.
  ns.extractInitialData = extractInitialData;
  ns.extractAllInitialData = extractAllInitialData;
})(window.YTCF);
