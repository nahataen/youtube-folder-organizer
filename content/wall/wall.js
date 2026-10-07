/* Carpetas YouTube — muro de videos por carpeta (wall/wall.js).
 * Al hacer clic en una carpeta, muestra en el contenido principal de YouTube
 * los videos recientes de los canales de esa carpeta, agrupados por canal.
 * Si la carpeta no tiene canales, muestra un estado vacío con mensaje.
 * Todo el DOM se crea con createElement + textContent (sin HTML inyectado).
 * Expone: window.YTCFView = { openFolder(folder), close(), getOpenId() } */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const el = ns.el;
  const WALL_ID = 'ytcf-wall';

  let hiddenSiblings = []; // nodos de YouTube ocultos mientras el muro está abierto
  let openId = null;
  let requestToken = 0;

  function pageManager() {
    return document.querySelector('ytd-app #page-manager');
  }

  function syncWallTheme() {
    const wall = document.getElementById(WALL_ID);
    if (!wall) return;
    wall.classList.toggle('ytcf-dark', document.documentElement.hasAttribute('dark'));
  }

  // ---------- Construcción del muro ----------
  function buildHeader(wall, folder, onRefresh) {
    const head = el('div', 'ytcf-wall-head');

    const back = el('button', 'ytcf-chip', '← Volver');
    back.type = 'button';
    back.title = 'Volver al contenido de YouTube';
    back.addEventListener('click', close);

    const titles = el('div', 'ytcf-wall-titles');
    titles.appendChild(el('h2', 'ytcf-wall-title', folder.name));
    titles.appendChild(
      el(
        'p',
        'ytcf-wall-sub',
        folder.sub ||
          (folder.channels.length === 0
            ? 'Sin canales'
            : `${folder.channels.length} ${folder.channels.length === 1 ? 'canal' : 'canales'}`)
      )
    );

    const refresh = el('button', 'ytcf-chip', '↻ Actualizar');
    refresh.type = 'button';
    refresh.title = 'Volver a cargar los videos';
    refresh.addEventListener('click', onRefresh);

    // Popup de suscripciones (módulo subs/): añadirlas a carpetas.
    const subs = el('button', 'ytcf-chip', 'Suscripciones');
    subs.type = 'button';
    subs.title = 'Ver mis suscripciones y añadirlas a carpetas';
    subs.addEventListener('click', () => {
      if (ns.openSubsPopup) ns.openSubsPopup();
      else ns.toast('Módulo de suscripciones no disponible.');
    });

    head.appendChild(back);
    head.appendChild(titles);
    head.appendChild(subs);
    head.appendChild(refresh);
    wall.appendChild(head);

    // Filtros por categoría (muro general): "Todas" + un chip por carpeta.
    if (Array.isArray(folder.groups) && folder.groups.length > 0) {
      wall.appendChild(buildFilters(wall, folder));
    }
  }

  function buildFilters(wall, folder) {
    const bar = el('div', 'ytcf-wall-filters');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Filtrar por categoría');
    bar.appendChild(filterButton(wall, bar, 'all', `Todas (${folder.channels.length})`));
    for (const g of folder.groups) {
      bar.appendChild(filterButton(wall, bar, g.id, `${g.name} (${g.count})`));
    }
    return bar;
  }

  function filterButton(wall, bar, id, label) {
    const btn = el(
      'button',
      'ytcf-chip ytcf-wall-filter' + (id === 'all' ? ' ytcf-wall-filter-active' : '')
    );
    btn.type = 'button';
    btn.textContent = label;
    btn.title = id === 'all' ? 'Mostrar todas las categorías' : `Mostrar solo ${label}`;
    btn.setAttribute('aria-pressed', id === 'all' ? 'true' : 'false');
    btn.addEventListener('click', () => {
      wall.dataset.filter = id;
      for (const b of bar.querySelectorAll('.ytcf-wall-filter')) {
        const active = b === btn;
        b.classList.toggle('ytcf-wall-filter-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      applyWallFilter(wall);
    });
    return btn;
  }

  // Oculta las secciones de canal que no pertenecen al filtro activo.
  // Cada sección lleva en `data-groups` los ids de sus carpetas.
  function applyWallFilter(wall) {
    const filter = wall.dataset.filter || 'all';
    let visible = 0;
    for (const sec of wall.querySelectorAll('.ytcf-chan-sec')) {
      const show = filter === 'all' || (sec.dataset.groups || '').split(' ').includes(filter);
      sec.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    const noresult = wall.querySelector('.ytcf-wall-noresult');
    if (noresult) noresult.style.display = visible === 0 ? '' : 'none';
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
        'Abre un video del canal y usa «＋ Carpeta» en el menú de acciones.'
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
    if (Array.isArray(channel.groups)) sec.dataset.groups = channel.groups.join(' ');

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
      img.addEventListener('error', () => img.replaceWith(ns.avatarFallback(channel.name)), {
        once: true
      });
      link.appendChild(img);
    } else {
      link.appendChild(ns.avatarFallback(channel.name));
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
    wall.dataset.filter = 'all';
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
    const noresult = el('p', 'ytcf-wall-noresult ytcf-hint', 'Esta categoría aún no tiene canales.');
    noresult.style.display = 'none';
    wall.appendChild(noresult);
    window.scrollTo({ top: 0 });

    if (opts.bust) ns.bustChannelCache(folder.channels);
    // Por tandas de 3 y pintado progresivo: evita ráfagas de peticiones
    // (ritmo parecido al de navegar a mano) y muestra antes los primeros.
    const CONCURRENCY = 3;
    let firstBatch = true;
    for (let i = 0; i < folder.channels.length; i += CONCURRENCY) {
      const batch = folder.channels.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map((ch) => ns.fetchChannelVideos(ch)));
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
      // Las secciones nuevas respetan el filtro activo (si el usuario ya filtró).
      applyWallFilter(wall);
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
})(window.YTCF);
