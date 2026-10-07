/* Carpetas YouTube — sección "MIS CARPETAS" del sidebar (sidebar/sidebar.js).
 * CRUD visual de carpetas y canales + arranque del content-script:
 * carga el storage, inyecta la sección y observa la SPA de YouTube.
 * Las llamadas al módulo watch (`ns.ensureWatchButton?.()`…) usan `?.`
 * porque ese script carga después (ver manifest.json). */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const SECTION_ID = 'ytcf-section';
  // Id sintético del muro general: no existe en el storage, así que el
  // listener de cambios no debe cerrarlo por "carpeta eliminada".
  const GENERAL_WALL_ID = '__general__';
  let injectTimer = 0;

  // YouTube marca el modo oscuro con <html dark>: forzamos clase propia
  // con colores explícitos para garantizar contraste.
  function syncTheme() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    section.classList.toggle('ytcf-dark', document.documentElement.hasAttribute('dark'));
  }

  function renderSidebar() {
    const root = document.getElementById(SECTION_ID);
    if (!root) return;
    root.querySelector('.ytcf-body')?.remove();
    root.appendChild(buildBody());
    syncTheme();
  }

  function buildBody() {
    const body = document.createElement('div');
    body.className = 'ytcf-body';

    if (ns.folders.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'ytcf-empty';
      empty.textContent = 'Aún no tienes carpetas. Pulsa + para crear la primera.';
      body.appendChild(empty);
      return body;
    }

    for (const folder of ns.folders) {
      body.appendChild(buildFolder(folder));
    }
    return body;
  }

  function buildFolder(folder) {
    const wrap = document.createElement('div');
    wrap.className = 'ytcf-folder';
    wrap.dataset.folderId = folder.id;

    // Cabecera de la carpeta
    const head = document.createElement('div');
    head.className = 'ytcf-folder-head';
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', folder.open ? 'true' : 'false');
    head.title = folder.name;

    const arrow = document.createElement('span');
    arrow.className = 'ytcf-arrow' + (folder.open ? ' ytcf-arrow-open' : '');
    arrow.textContent = '▸';

    head.appendChild(arrow);
    head.appendChild(ns.folderIcon());

    const name = document.createElement('span');
    name.className = 'ytcf-folder-name';
    name.textContent = folder.name;
    head.appendChild(name);

    const count = document.createElement('span');
    count.className = 'ytcf-count';
    count.textContent = String(folder.channels.length);
    head.appendChild(count);

    // Acciones: renombrar / eliminar
    const actions = document.createElement('span');
    actions.className = 'ytcf-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'ytcf-icon-btn';
    renameBtn.type = 'button';
    renameBtn.title = 'Renombrar carpeta';
    renameBtn.setAttribute('aria-label', `Renombrar ${folder.name}`);
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ns.showRenameForm(wrap, folder);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'ytcf-icon-btn ytcf-danger';
    delBtn.type = 'button';
    delBtn.title = 'Eliminar carpeta';
    delBtn.setAttribute('aria-label', `Eliminar ${folder.name}`);
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar la carpeta "${folder.name}"? Los canales no se dan de baja, solo se quitan de la carpeta.`)) return;
      ns.folders = ns.folders.filter((f) => f.id !== folder.id);
      await ns.saveFolders();
      renderSidebar();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    head.appendChild(actions);

    const toggle = async () => {
      // Solo expande/colapsa: el muro general se abre desde el título
      // "MIS CARPETAS" (openGeneralWall).
      folder.open = !folder.open;
      await ns.saveFolders();
      renderSidebar();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    wrap.appendChild(head);

    // Canales de la carpeta
    if (folder.open) {
      const list = document.createElement('div');
      list.className = 'ytcf-channels';

      if (folder.channels.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'ytcf-hint';
        hint.textContent = 'Carpeta vacía. Abre un video del canal y usa «＋ Carpeta» en el menú de acciones.';
        list.appendChild(hint);
      }

      for (const ch of folder.channels) {
        const row = document.createElement('div');
        row.className = 'ytcf-channel';

        const link = document.createElement('a');
        link.className = 'ytcf-channel-link';
        link.href = ch.url;
        link.title = ch.name;

        if (ch.avatar) {
          const avatar = document.createElement('img');
          avatar.className = 'ytcf-avatar';
          avatar.alt = '';
          avatar.loading = 'lazy';
          avatar.src = ch.avatar;
          avatar.referrerPolicy = 'no-referrer';
          // Si la URL guardada ya no carga, muestra la inicial en vez de icono roto.
          avatar.addEventListener('error', () => {
            avatar.replaceWith(ns.avatarFallback(ch.name));
          }, { once: true });
          link.appendChild(avatar);
        } else {
          link.appendChild(ns.avatarFallback(ch.name));
        }

        const label = document.createElement('span');
        label.className = 'ytcf-channel-name';
        label.textContent = ch.name;

        link.appendChild(label);
        row.appendChild(link);

        const rm = document.createElement('button');
        rm.className = 'ytcf-icon-btn ytcf-remove';
        rm.type = 'button';
        rm.title = 'Quitar de la carpeta';
        rm.setAttribute('aria-label', `Quitar ${ch.name} de ${folder.name}`);
        rm.textContent = '×';
        rm.addEventListener('click', async () => {
          folder.channels = folder.channels.filter((c) => c.key !== ch.key);
          await ns.saveFolders();
          renderSidebar();
        });
        row.appendChild(rm);
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  // ---------- Inyección en el sidebar ----------
  function guideContainer() {
    return (
      document.querySelector('ytd-guide-renderer #guide-inner-content') ||
      document.querySelector('#guide-inner-content') ||
      document.querySelector('ytd-guide-renderer #sections') ||
      null
    );
  }

  function buildSection() {
    const section = document.createElement('div');
    section.id = SECTION_ID;
    section.className = 'ytcf-section';

    const header = document.createElement('div');
    header.className = 'ytcf-header';

    const title = document.createElement('h3');
    title.className = 'ytcf-title';
    title.textContent = 'MIS CARPETAS';
    title.title = 'Ver el muro general con los videos de todas las carpetas';
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.addEventListener('click', openGeneralWall);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openGeneralWall();
      }
    });

    const add = document.createElement('button');
    add.className = 'ytcf-icon-btn ytcf-add';
    add.type = 'button';
    add.title = 'Crear carpeta';
    add.setAttribute('aria-label', 'Crear carpeta');
    add.textContent = '+';
    add.addEventListener('click', () => ns.showCreateForm(section));

    header.appendChild(title);
    header.appendChild(add);
    section.appendChild(header);
    section.appendChild(buildBody());
    return section;
  }

  // Muro general: una carpeta sintética con los canales de TODAS las
  // carpetas (sin duplicados) + la lista de grupos para los filtros.
  // Se abre desde el título "MIS CARPETAS". Los canales se copian para
  // anotar `groups` sin contaminar lo guardado en el storage.
  function openGeneralWall() {
    const seen = new Map(); // key -> copia del canal con `groups: [ids]`
    for (const f of ns.folders) {
      for (const ch of f.channels) {
        let entry = seen.get(ch.key);
        if (!entry) {
          entry = { ...ch, groups: [] };
          seen.set(ch.key, entry);
        }
        entry.groups.push(f.id);
      }
    }
    const channels = [...seen.values()];
    window.YTCFView?.openFolder({
      id: GENERAL_WALL_ID,
      name: 'Mis carpetas',
      sub: ns.folders.length === 0
        ? 'Sin carpetas'
        : `${ns.folders.length} ${ns.folders.length === 1 ? 'carpeta' : 'carpetas'} · ${channels.length} ${channels.length === 1 ? 'canal' : 'canales'}`,
      groups: ns.folders.map((f) => ({ id: f.id, name: f.name, count: f.channels.length })),
      channels
    });
  }

  function ensureSidebar() {
    const guide = guideContainer();
    if (!guide) return; // guía aún no renderizada (o mini-guía)
    ns.currentChannel = ns.detectCurrentChannel();
    const existing = document.getElementById(SECTION_ID);
    if (existing && guide.contains(existing)) {
      renderSidebar(); // refresca cambios de storage
      ns.ensureWatchButton?.();
      return;
    }
    existing?.remove();
    // Inserta al principio para máxima visibilidad.
    guide.prepend(buildSection());
    syncTheme();
    ns.ensureWatchButton?.();
  }

  function scheduleInject() {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      ensureSidebar();
      ns.ensureWatchButton?.();
    }, 300);
  }

  // ---------- Arranque ----------
  async function init() {
    await ns.loadFolders();
    ensureSidebar();

    // YouTube es SPA: re-inyecta cuando la guía se re-renderiza o cambia la URL.
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        ns.currentChannel = ns.detectCurrentChannel();
        ns.removeWatchButton?.();
        window.YTCFView?.close(); // al navegar se vuelve al contenido normal
      }
      const guide = guideContainer();
      if (guide && !guide.contains(document.getElementById(SECTION_ID))) scheduleInject();
      // Refresca el canal actual aunque la sección exista (navegación watch -> canal).
      const fresh = ns.detectCurrentChannel();
      if ((fresh?.key || null) !== (ns.currentChannel?.key || null)) {
        ns.currentChannel = fresh;
        renderSidebar();
        ns.ensureWatchButton?.();
      } else if (
        location.pathname === '/watch' &&
        ns.currentChannel &&
        ns.WATCHBTN_ID &&
        !document.getElementById(ns.WATCHBTN_ID)
      ) {
        // YouTube re-renderizó la barra de acciones y retiró nuestro botón.
        ns.ensureWatchButton?.();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Sigue cambios de tema claro/oscuro (<html dark>).
    new MutationObserver(syncTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dark']
    });

    chrome.storage?.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[ns.STORE_KEY]) {
        ns.folders = changes[ns.STORE_KEY].newValue || [];
        renderSidebar();
        ns.closeWatchPicker?.();
        // Si la carpeta abierta se eliminó, cierra su muro (el general no
        // vive en el storage y nunca se cierra por esta vía).
        const openId = window.YTCFView?.getOpenId?.();
        if (openId && openId !== GENERAL_WALL_ID && !ns.folders.some((f) => f.id === openId)) window.YTCFView.close();
      }
    });
  }

  ns.renderSidebar = renderSidebar;
  ns.ensureSidebar = ensureSidebar;

  init();
})(window.YTCF);
