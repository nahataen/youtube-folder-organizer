/* Carpetas YouTube — último video por fila del popup (subs/latest.js).
 * Rellena la miniatura+título del video más reciente de cada suscripción
 * visible, en tandas de 3 (mismo ritmo que el muro). Reutiliza la caché de
 * 10 min de videos.js: revisitar una página no pide red. Las respuestas
 * tardías de otra página se descartan por token.
 * Expone: ns.fillLatestVideos(listEl, subs) + ns.invalidateLatest(). */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  let latestToken = 0;

  function invalidateLatest() {
    latestToken++;
  }

  async function fillLatestVideos(listEl, subs) {
    const token = ++latestToken;
    if (!listEl) return;
    const cells = [...listEl.querySelectorAll('.ytcf-subs-latest')];
    const CONCURRENCY = 3;
    for (let i = 0; i < cells.length; i += CONCURRENCY) {
      const batch = cells.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((cell) => {
          const sub = subs.find((s) => s.key === cell.dataset.subKey);
          if (!sub) return Promise.resolve({ cell, videos: [] });
          return ns.fetchChannelVideos(sub).then((videos) => ({ cell, videos }));
        })
      );
      if (token !== latestToken || !listEl.isConnected) return;
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        paintLatestVideo(r.value.cell, r.value.videos);
      }
    }
  }

  function paintLatestVideo(cell, videos) {
    const v = videos && videos[0];
    cell.replaceChildren();
    if (!v) {
      const empty = document.createElement('span');
      empty.className = 'ytcf-subs-latest-empty';
      empty.textContent = 'Sin videos recientes';
      cell.appendChild(empty);
      return;
    }
    const link = document.createElement('a');
    link.className = 'ytcf-subs-latest-link';
    link.href = `https://www.youtube.com/watch?v=${v.videoId}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = `${v.title} (abre en pestaña nueva)`;
    if (v.thumb) {
      const img = document.createElement('img');
      img.className = 'ytcf-subs-latest-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.src = v.thumb;
      img.referrerPolicy = 'no-referrer';
      link.appendChild(img);
    }
    const title = document.createElement('span');
    title.className = 'ytcf-subs-latest-title';
    title.textContent = `▶ ${v.title}`;
    link.appendChild(title);
    cell.appendChild(link);
  }

  ns.fillLatestVideos = fillLatestVideos;
  ns.invalidateLatest = invalidateLatest;
})(window.YTCF);
