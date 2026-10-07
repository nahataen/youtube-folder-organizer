/* Carpetas YouTube — popup de suscripciones del muro (subs/popup.js).
 * Modal con las suscripciones del usuario (30 por página): cada fila permite
 * añadirla a una categoría existente y arriba se puede crear una nueva.
 * Todo el DOM se crea con createElement + textContent (sin HTML inyectado).
 * Expone: ns.openSubsPopup() (alterna abrir/cerrar). */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const PAGE_SIZE = 30;

  let overlay = null;
  let listEl = null;
  let pagerEl = null;
  let countEl = null;
  let formWrap = null;
  let subs = [];
  let page = 0;
  let hasMore = false; // quedan tandas por pedir al avanzar de página

  function openSubsPopup() {
    if (overlay) {
      closeSubsPopup();
      return;
    }
    buildShell();
    loadSubs(false);
  }

  function closeSubsPopup() {
    ns.invalidateLatest(); // descarta rellenos de video en vuelo
    document.removeEventListener('keydown', onKey, true);
    overlay?.remove();
    overlay = null;
    listEl = null;
    pagerEl = null;
    countEl = null;
    formWrap = null;
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeSubsPopup();
  }

  // ---------- Estructura ----------
  function buildShell() {
    overlay = document.createElement('div');
    overlay.className = 'ytcf-subs-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSubsPopup();
    });

    const modal = document.createElement('div');
    modal.className = 'ytcf-subs-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Mis suscripciones');
    overlay.appendChild(modal);

    const head = document.createElement('div');
    head.className = 'ytcf-subs-head';
    const title = document.createElement('h2');
    title.className = 'ytcf-subs-title';
    title.textContent = 'Mis suscripciones';
    head.appendChild(title);
    countEl = document.createElement('span');
    countEl.className = 'ytcf-subs-count';
    head.appendChild(countEl);
    const close = document.createElement('button');
    close.className = 'ytcf-subs-close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Cerrar';
    close.setAttribute('aria-label', 'Cerrar');
    close.addEventListener('click', closeSubsPopup);
    head.appendChild(close);
    modal.appendChild(head);

    const toolbar = document.createElement('div');
    toolbar.className = 'ytcf-subs-toolbar';
    const add = document.createElement('button');
    add.className = 'ytcf-chip';
    add.type = 'button';
    add.textContent = '＋ Nueva carpeta';
    add.title = 'Crear una carpeta sin salir del popup';
    add.addEventListener('click', () => {
      formWrap.style.display = formWrap.style.display === 'none' ? '' : 'none';
      formWrap.querySelector('input')?.focus();
    });
    toolbar.appendChild(add);
    const imp = document.createElement('button');
    imp.className = 'ytcf-chip';
    imp.type = 'button';
    imp.textContent = '⬆ Importar';
    imp.title = 'Cargar una lista desde un archivo SQLite (reemplaza la guardada)';
    imp.addEventListener('click', () => fileInput.click());
    toolbar.appendChild(imp);
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.sqlite,.sqlite3,.db';
    fileInput.style.display = 'none';
    fileInput.setAttribute('aria-label', 'Archivo SQLite de suscripciones');
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = ''; // permite re-elegir el mismo archivo
      if (file) importSqliteFile(file);
    });
    toolbar.appendChild(fileInput);
    const exp = document.createElement('button');
    exp.className = 'ytcf-chip';
    exp.type = 'button';
    exp.textContent = '⬇ SQLite';
    exp.title = 'Descargar la lista de suscripciones como archivo SQLite';
    exp.addEventListener('click', exportSqlite);
    toolbar.appendChild(exp);
    modal.appendChild(toolbar);

    formWrap = buildCreateForm();
    formWrap.style.display = 'none';
    modal.appendChild(formWrap);

    listEl = document.createElement('div');
    listEl.className = 'ytcf-subs-list';
    modal.appendChild(listEl);

    pagerEl = document.createElement('div');
    pagerEl.className = 'ytcf-subs-pager';
    modal.appendChild(pagerEl);

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
  }

  function buildCreateForm() {
    const form = document.createElement('div');
    form.className = 'ytcf-subs-form';

    const input = document.createElement('input');
    input.className = 'ytcf-subs-input';
    input.type = 'text';
    input.maxLength = ns.MAX_NAME;
    input.placeholder = 'Nombre de la carpeta…';
    input.setAttribute('aria-label', 'Nombre de la nueva carpeta');
    form.appendChild(input);

    const ok = document.createElement('button');
    ok.className = 'ytcf-chip';
    ok.type = 'button';
    ok.textContent = 'Crear';
    form.appendChild(ok);

    const cancel = document.createElement('button');
    cancel.className = 'ytcf-subs-cancel';
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => {
      formWrap.style.display = 'none';
    });
    form.appendChild(cancel);

    const commit = async () => {
      const name = input.value.trim().slice(0, ns.MAX_NAME);
      if (!name) {
        input.focus();
        return;
      }
      if (ns.folderNameExists(name)) {
        ns.toast(`Ya existe una carpeta llamada "${name}".`);
        input.focus();
        input.select();
        return;
      }
      ns.folders.unshift({ id: ns.uid(), name, open: false, channels: [] });
      await ns.saveFolders();
      ns.renderSidebar();
      input.value = '';
      formWrap.style.display = 'none';
      ns.toast(`Carpeta "${name}" creada.`);
      renderList(); // reconstruye los selectores con la carpeta nueva
    };
    ok.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') formWrap.style.display = 'none';
      e.stopPropagation(); // evita atajos de YouTube al escribir
    });
    return form;
  }

  // ---------- Carga ----------
  // Carga inicial: solo la primera tanda (30). El resto llega al avanzar.
  async function loadSubs(bust) {
    page = 0;
    hasMore = false;
    listEl.replaceChildren();
    pagerEl.replaceChildren();
    countEl.textContent = '';
    const loading = document.createElement('p');
    loading.className = 'ytcf-hint';
    loading.textContent = 'Cargando suscripciones…';
    listEl.appendChild(loading);
    try {
      if (bust) ns.bustSubsCache();
      const r = await ns.ensureSubs(PAGE_SIZE);
      subs = r.items;
      hasMore = r.hasMore;
    } catch (e) {
      subs = [];
      hasMore = false;
      showSubsError(e && e.message === 'AUTH' ? 'auth' : 'error');
      return;
    }
    if (subs.length === 0) {
      showSubsError('error');
      return;
    }
    renderList();
  }

  function showSubsError(kind) {
    listEl.replaceChildren();
    pagerEl.replaceChildren();
    countEl.textContent = '';
    const hint = document.createElement('p');
    hint.className = 'ytcf-hint';
    hint.textContent =
      kind === 'auth'
        ? 'Inicia sesión en YouTube para ver tus suscripciones.'
        : 'No se pudieron cargar tus suscripciones. Comprueba tu conexión e inténtalo de nuevo.';
    listEl.appendChild(hint);
    const retry = document.createElement('button');
    retry.className = 'ytcf-chip';
    retry.type = 'button';
    retry.textContent = '↻ Reintentar';
    retry.addEventListener('click', () => loadSubs(true));
    listEl.appendChild(retry);
  }

  // ---------- Lista + paginación ----------
  function totalPages() {
    return Math.max(1, Math.ceil(subs.length / PAGE_SIZE));
  }

  function renderList() {
    if (!listEl) return;
    if (page > totalPages() - 1) page = totalPages() - 1;
    listEl.replaceChildren();
    // "+" = hay más tandas por pedir al avanzar de página.
    countEl.textContent =
      subs.length === 1 && !hasMore ? '1 canal' : `${subs.length}${hasMore ? '+' : ''} canales`;
    const start = page * PAGE_SIZE;
    for (const sub of subs.slice(start, start + PAGE_SIZE)) {
      listEl.appendChild(buildRow(sub));
    }
    renderPager();
    ns.fillLatestVideos(listEl, subs);
  }

  function renderPager() {
    pagerEl.replaceChildren();
    if (totalPages() <= 1 && !hasMore) return;
    const prev = document.createElement('button');
    prev.className = 'ytcf-chip';
    prev.type = 'button';
    prev.textContent = '← Anterior';
    prev.disabled = page === 0;
    prev.addEventListener('click', () => {
      if (page > 0) {
        page--;
        renderList();
        listEl.scrollTop = 0;
      }
    });
    const label = document.createElement('span');
    label.className = 'ytcf-subs-page';
    // Sin "de Y" mientras queden tandas por pedir (el total aún no se conoce).
    label.textContent = hasMore ? `Página ${page + 1}` : `Página ${page + 1} de ${totalPages()}`;
    const next = document.createElement('button');
    next.className = 'ytcf-chip';
    next.type = 'button';
    next.textContent = 'Siguiente →';
    next.disabled = !((page + 1) * PAGE_SIZE < subs.length || hasMore);
    next.addEventListener('click', async () => {
      // Si la página siguiente aún no está cargada, se pide antes de avanzar.
      const need = (page + 2) * PAGE_SIZE;
      if (subs.length < need && hasMore) {
        next.disabled = true;
        next.textContent = 'Cargando…';
        try {
          const r = await ns.ensureSubs(need);
          subs = r.items;
          hasMore = r.hasMore;
        } catch {
          ns.toast('No se pudieron cargar más suscripciones.');
        }
      }
      if ((page + 1) * PAGE_SIZE < subs.length) {
        page++;
        renderList();
        listEl.scrollTop = 0;
      } else {
        renderList(); // refresca el paginador (apaga Siguiente si no hay más)
      }
    });
    pagerEl.appendChild(prev);
    pagerEl.appendChild(label);
    pagerEl.appendChild(next);
  }

  function buildRow(sub) {
    const row = document.createElement('div');
    row.className = 'ytcf-subs-row';

    if (sub.avatar) {
      const img = document.createElement('img');
      img.className = 'ytcf-subs-avatar';
      img.alt = '';
      img.loading = 'lazy';
      img.src = sub.avatar;
      img.referrerPolicy = 'no-referrer';
      img.addEventListener(
        'error',
        () => img.replaceWith(ns.avatarFallback(sub.name)),
        { once: true }
      );
      row.appendChild(img);
    } else {
      row.appendChild(ns.avatarFallback(sub.name));
    }

    const info = document.createElement('div');
    info.className = 'ytcf-subs-info';
    const name = document.createElement('div');
    name.className = 'ytcf-subs-name';
    name.textContent = sub.name;
    name.title = sub.name;
    info.appendChild(name);
    if (sub.detail) {
      const detail = document.createElement('div');
      detail.className = 'ytcf-subs-detail';
      detail.textContent = sub.detail;
      detail.title = sub.detail;
      info.appendChild(detail);
    }
    const memberIn = ns.folders.filter((f) =>
      f.channels.some((c) => c.key === sub.key)
    );
    if (memberIn.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'ytcf-subs-member';
      badge.textContent =
        memberIn.length === 1 ? `✓ en ${memberIn[0].name}` : `✓ en ${memberIn.length} carpetas`;
      badge.title = memberIn.map((f) => f.name).join(', ');
      info.appendChild(badge);
    }
    // Último video del canal (miniatura+título): lo rellena fillLatestVideos.
    const latest = document.createElement('div');
    latest.className = 'ytcf-subs-latest';
    latest.dataset.subKey = sub.key;
    const skel = document.createElement('div');
    skel.className = 'ytcf-subs-latest-skel';
    skel.setAttribute('aria-hidden', 'true');
    latest.appendChild(skel);
    info.appendChild(latest);
    row.appendChild(info);

    // Selector de acción inmediata: elegir mueve el canal a esa carpeta
    // (lo saca de las demás); "∅ Quitar" lo saca de todas. Sin botón aparte.
    const select = document.createElement('select');
    select.className = 'ytcf-subs-select';
    select.setAttribute('aria-label', `Carpeta para ${sub.name}`);
    if (ns.folders.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sin carpetas (crea una arriba)';
      select.appendChild(opt);
      select.disabled = true;
    } else {
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = 'Mover a…';
      select.appendChild(ph);
      for (const f of ns.folders) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = `${f.name} (${f.channels.length})`;
        select.appendChild(opt);
      }
      const out = document.createElement('option');
      out.value = '__none__';
      out.textContent = '∅ Quitar de carpetas';
      select.appendChild(out);
    }
    row.appendChild(select);

    if (!select.disabled) {
      select.addEventListener('change', () => {
        const v = select.value;
        select.value = ''; // vuelve al placeholder; renderList redibuja
        if (!v) return;
        moveSubToFolder(sub, v);
      });
    }

    return row;
  }

  // Mover es exclusivo: el canal queda SOLO en la carpeta elegida (o en
  // ninguna con '__none__'). Si te equivocas, eliges otra y se cambia solo.
  async function moveSubToFolder(sub, folderId) {
    if (folderId === '__none__') {
      const was = ns.folders.filter((f) => f.channels.some((c) => c.key === sub.key));
      if (was.length === 0) {
        ns.toast('No está en ninguna carpeta.');
        renderList();
        return;
      }
      for (const f of was) f.channels = f.channels.filter((c) => c.key !== sub.key);
      await ns.saveFolders();
      ns.renderSidebar();
      ns.toast(
        was.length === 1 ? `Quitado de "${was[0].name}".` : 'Quitado de las carpetas.'
      );
      renderList();
      return;
    }
    const folder = ns.folders.find((f) => f.id === folderId);
    if (!folder) return;
    const current = ns.folders.filter((f) => f.channels.some((c) => c.key === sub.key));
    if (current.length === 1 && current[0].id === folderId) {
      ns.toast(`Ya está en "${folder.name}".`);
      renderList();
      return;
    }
    for (const f of current) f.channels = f.channels.filter((c) => c.key !== sub.key);
    folder.channels.push({ key: sub.key, name: sub.name, url: sub.url, avatar: sub.avatar });
    await ns.saveFolders();
    ns.renderSidebar();
    ns.toast(
      current.length > 0 ? `Movido a "${folder.name}".` : `Añadido a "${folder.name}".`
    );
    renderList(); // actualiza insignias y conteos
  }

  // Descarga la lista como archivo SQLite real (tabla subscriptions).
  async function exportSqlite() {
    try {
      const r = await chrome.runtime.sendMessage({ scope: 'ytcf-subsdb', op: 'export' });
      if (!r || !r.ok || !Array.isArray(r.bytes) || r.bytes.length === 0) {
        ns.toast('No se pudo exportar: la lista está vacía.');
        return;
      }
      const blob = new Blob([new Uint8Array(r.bytes)], { type: 'application/x-sqlite3' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'suscripciones.sqlite';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    } catch {
      ns.toast('No se pudo exportar.');
    }
  }

  // Carga una lista desde un archivo SQLite (valida el esquema en el worker
  // y reemplaza la guardada). Avisa cuántos canales entraron.
  async function importSqliteFile(file) {
    if (file.size > 20 * 1024 * 1024) {
      ns.toast('Ese archivo es demasiado grande.');
      return;
    }
    let bytes = [];
    try {
      bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    } catch {
      ns.toast('No se pudo leer ese archivo.');
      return;
    }
    if (bytes.length === 0) {
      ns.toast('Ese archivo está vacío.');
      return;
    }
    let r = null;
    try {
      r = await chrome.runtime.sendMessage({ scope: 'ytcf-subsdb', op: 'import', bytes });
    } catch {
      r = null;
    }
    if (!r || !r.ok) {
      ns.toast('Archivo inválido: no es una base de suscripciones.');
      return;
    }
    ns.bustSubsCache();
    await loadSubs(false);
    ns.toast(`Se importaron ${r.count} ${r.count === 1 ? 'canal' : 'canales'}.`);
  }

  ns.openSubsPopup = openSubsPopup;
})(window.YTCF);
