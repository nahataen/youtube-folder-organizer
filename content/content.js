/* Carpetas YouTube — Organizador de Suscripciones (content script, mundo ISOLATED).
 * Inyecta una sección "MIS CARPETAS" en el sidebar (guía) de YouTube y un
 * botón "＋ Carpeta" en el menú de acciones del video (ytd-menu-renderer).
 * Sin popup: las carpetas viven en el sidebar, el alta de canales en el video.
 * Datos solo en chrome.storage.local.
 * Sin innerHTML con datos de usuario: todo se crea con createElement + textContent. */

(() => {
  'use strict';

  const STORE_KEY = 'ytFoldersV1';
  const SECTION_ID = 'ytcf-section';
  const MAX_NAME = 40;

  /** @type {{ id: string, name: string, open: boolean, channels: { key: string, name: string, url: string, avatar: string }[] }[]} */
  let folders = [];
  let currentChannel = null;
  let injectTimer = 0;

  // ---------- Storage ----------
  async function load() {
    try {
      const data = await chrome.storage.local.get(STORE_KEY);
      folders = Array.isArray(data[STORE_KEY]) ? data[STORE_KEY] : [];
    } catch {
      folders = [];
    }
  }

  async function save() {
    try {
      await chrome.storage.local.set({ [STORE_KEY]: folders });
    } catch {
      toast('No se pudo guardar en el almacenamiento local.');
    }
  }

  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // ¿Ya existe una carpeta con ese nombre? Insensible a mayúsculas y espacios.
  // excludeId se usa al renombrar para no chocar con la propia carpeta.
  function nameExists(name, excludeId) {
    const needle = name.trim().toLowerCase();
    return folders.some((f) => f.id !== excludeId && f.name.trim().toLowerCase() === needle);
  }

  // ---------- Utilidades ----------
  function toast(msg) {
    document.querySelector('.ytcf-toast')?.remove();
    const el = document.createElement('div');
    el.className = 'ytcf-toast';
    el.textContent = msg; // textContent: sin HTML inyectado
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('ytcf-toast-show'));
    setTimeout(() => {
      el.classList.remove('ytcf-toast-show');
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

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

  // Círculo con la inicial del canal (respaldo si no hay foto).
  function makeAvatarFallback(name) {
    const el = document.createElement('span');
    el.className = 'ytcf-avatar ytcf-avatar-fallback';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return el;
  }

  // Detecta el canal de la página actual (página de canal o video en reproducción).
  function detectCurrentChannel() {
    // 1) Página de canal: /@handle, /channel/ID, /c/nombre, /user/nombre
    const path = safeChannelPath(location.pathname);
    if (path) {
      const header = document.querySelector('ytd-c4-tabbed-header-renderer');
      const avatar = findAvatar(
        'ytd-c4-tabbed-header-renderer #avatar img, ytd-page-header-renderer #avatar img, ytd-c4-tabbed-header-renderer img#img'
      );
      const nameEl =
        header?.querySelector('ytd-channel-name #text') ||
        document.querySelector('ytd-c4-tabbed-header-renderer #channel-name #text');
      const name = cleanTitle(nameEl?.textContent) || cleanTitle(document.title) || 'Canal actual';
      return {
        key: path,
        name,
        url: `https://www.youtube.com${path}`,
        avatar
      };
    }
    // 2) Página de video: extrae el canal del autor.
    if (location.pathname === '/watch') {
      const anchor = document.querySelector(
        'ytd-watch-metadata ytd-channel-name a[href], #owner ytd-channel-name a[href], ytd-channel-name a[href^="/@"], ytd-channel-name a[href^="/channel/"]'
      );
      const href = anchor?.getAttribute('href');
      const key = href ? safeChannelPath(href) : null;
      if (key) {
        const avatar = findAvatar(
          '#owner #avatar img, ytd-watch-metadata #avatar img, ytd-video-owner-renderer #avatar img'
        );
        return {
          key,
          name: cleanTitle(anchor.textContent) || 'Canal del video',
          url: `https://www.youtube.com${key}`,
          avatar
        };
      }
    }
    return null;
  }

  // ---------- Render ----------
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

  // YouTube marca el modo oscuro con <html dark>: forzamos clase propia
  // con colores explícitos para garantizar contraste.
  function syncTheme() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    section.classList.toggle('ytcf-dark', document.documentElement.hasAttribute('dark'));
  }

  function render() {
    const root = document.getElementById(SECTION_ID);
    if (!root) return;
    root.querySelector('.ytcf-body')?.remove();
    root.appendChild(buildBody());
    syncTheme();
  }

  function buildBody() {
    const body = document.createElement('div');
    body.className = 'ytcf-body';

    if (folders.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'ytcf-empty';
      empty.textContent = 'Aún no tienes carpetas. Pulsa + para crear la primera.';
      body.appendChild(empty);
      return body;
    }

    for (const folder of folders) {
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
    head.appendChild(folderIcon());

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
      showRenameForm(wrap, folder);
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
      folders = folders.filter((f) => f.id !== folder.id);
      await save();
      render();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    head.appendChild(actions);

    const toggle = async () => {
      folder.open = !folder.open;
      await save();
      render();
      // Muestra el muro de videos de la carpeta en el contenido (módulo folderView.js).
      window.YTCFView?.openFolder(folder);
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
            avatar.replaceWith(makeAvatarFallback(ch.name));
          }, { once: true });
          link.appendChild(avatar);
        } else {
          link.appendChild(makeAvatarFallback(ch.name));
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
          await save();
          render();
        });
        row.appendChild(rm);
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  // Formulario inline para crear carpeta
  function showCreateForm(root) {
    if (root.querySelector('.ytcf-form')) return;
    const form = document.createElement('div');
    form.className = 'ytcf-form';

    const input = document.createElement('input');
    input.className = 'ytcf-input';
    input.type = 'text';
    input.maxLength = MAX_NAME;
    input.placeholder = 'Nombre de la carpeta…';
    input.setAttribute('aria-label', 'Nombre de la nueva carpeta');

    const row = document.createElement('div');
    row.className = 'ytcf-form-row';

    const ok = document.createElement('button');
    ok.className = 'ytcf-btn';
    ok.type = 'button';
    ok.textContent = 'Crear';

    const cancel = document.createElement('button');
    cancel.className = 'ytcf-btn ytcf-btn-ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';

    const commit = async () => {
      const name = input.value.trim().slice(0, MAX_NAME);
      if (!name) {
        input.focus();
        return;
      }
      if (nameExists(name)) {
        toast(`Ya existe una carpeta llamada "${name}".`);
        input.focus();
        input.select();
        return;
      }
      folders.unshift({ id: uid(), name, open: false, channels: [] });
      await save();
      form.remove();
      render();
      toast(`Carpeta "${name}" creada.`);
    };

    ok.addEventListener('click', commit);
    cancel.addEventListener('click', () => form.remove());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') form.remove();
      e.stopPropagation(); // evita atajos de YouTube al escribir
    });

    row.appendChild(ok);
    row.appendChild(cancel);
    form.appendChild(input);
    form.appendChild(row);
    root.appendChild(form);
    input.focus();
  }

  // Formulario inline para renombrar
  function showRenameForm(wrap, folder) {
    const head = wrap.querySelector('.ytcf-folder-head');
    if (!head || wrap.querySelector('.ytcf-form')) return;
    const form = document.createElement('div');
    form.className = 'ytcf-form';

    const input = document.createElement('input');
    input.className = 'ytcf-input';
    input.type = 'text';
    input.maxLength = MAX_NAME;
    input.value = folder.name;
    input.setAttribute('aria-label', 'Nuevo nombre de la carpeta');

    const row = document.createElement('div');
    row.className = 'ytcf-form-row';

    const ok = document.createElement('button');
    ok.className = 'ytcf-btn';
    ok.type = 'button';
    ok.textContent = 'Guardar';

    const cancel = document.createElement('button');
    cancel.className = 'ytcf-btn ytcf-btn-ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';

    const commit = async () => {
      const name = input.value.trim().slice(0, MAX_NAME);
      if (!name) {
        input.focus();
        return;
      }
      if (nameExists(name, folder.id)) {
        toast(`Ya existe otra carpeta llamada "${name}".`);
        input.focus();
        input.select();
        return;
      }
      folder.name = name;
      await save();
      render();
    };

    ok.addEventListener('click', commit);
    cancel.addEventListener('click', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') render();
      e.stopPropagation();
    });

    row.appendChild(ok);
    row.appendChild(cancel);
    form.appendChild(input);
    form.appendChild(row);
    head.after(form);
    input.focus();
    input.select();
  }

  // ---------- Botón "＋ Carpeta" en el menú de acciones del video ----------
  // Vive dentro del ytd-menu-renderer de la página de reproducción (/watch),
  // no en el sidebar. Solo se muestra cuando se detecta el canal del video.
  const WATCHBTN_ID = 'ytcf-watch-add';

  // Solo el menú principal de acciones bajo el título (hay otros
  // ytd-menu-renderer en comentarios, descripción, etc. que se ignoran).
  function watchMenu() {
    return (
      document.querySelector('ytd-watch-metadata #actions ytd-menu-renderer') ||
      document.querySelector('ytd-watch-metadata ytd-menu-renderer') ||
      null
    );
  }

  function watchSlot(menu) {
    return menu.querySelector('#top-level-buttons-computed') || menu;
  }

  function removeWatchButton() {
    document.getElementById(WATCHBTN_ID)?.remove();
    closeWatchPicker();
  }

  function ensureWatchButton() {
    if (location.pathname !== '/watch') {
      removeWatchButton();
      return;
    }
    const channel = detectCurrentChannel();
    currentChannel = channel;
    if (!channel) {
      removeWatchButton();
      return;
    }
    const menu = watchMenu();
    if (!menu) return; // acciones aún no renderizadas; el observer reintenta
    const slot = watchSlot(menu);
    let wrap = document.getElementById(WATCHBTN_ID);
    if (wrap && wrap.parentNode !== slot) {
      wrap.remove();
      wrap = null;
    }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = WATCHBTN_ID;
      wrap.className = 'ytcf-watch-add';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ytcf-watch-btn';
      // stopPropagation: evita que el clic burbujee a los handlers de YouTube.
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onWatchAddClick();
      });
      wrap.appendChild(btn);
    }
    // Siempre a la izquierda del Like (primer botón de la barra de acciones).
    if (slot.firstElementChild !== wrap) slot.prepend(wrap);
    const btn = wrap.querySelector('button');
    btn.textContent = '＋ Carpeta';
    btn.title = `Añadir "${channel.name}" a una carpeta`;
    btn.setAttribute('aria-label', `Añadir el canal ${channel.name} a una carpeta`);
    if (wrap.dataset.ckey !== channel.key) {
      wrap.dataset.ckey = channel.key; // autoplay / SPA: cierra el selector obsoleto
      closeWatchPicker();
    }
  }

  function onWatchAddClick() {
    const wrap = document.getElementById(WATCHBTN_ID);
    // Si el selector ya está abierto, el clic alterna (cerrar).
    if (document.querySelector('.ytcf-watch-picker')) {
      closeWatchPicker();
      return;
    }
    if (!wrap) return;
    // Re-detecta en el momento del clic: no confía en el caché del observer,
    // que puede quedar obsoleto durante los re-renders de YouTube.
    const channel = detectCurrentChannel() || currentChannel;
    if (!channel) {
      toast('No se pudo detectar el canal de este video. Espera a que cargue la página.');
      return;
    }
    currentChannel = channel;
    if (folders.length === 0) {
      toast('Crea primero una carpeta en «MIS CARPETAS» del menú lateral.');
      return;
    }
    // Vía rápida: una sola carpeta y el canal aún no está en ella.
    if (
      folders.length === 1 &&
      !folders[0].channels.some((c) => c.key === channel.key)
    ) {
      addToFolder(folders[0].id);
      return;
    }
    // El selector lista TODAS las carpetas: permite añadir o quitar,
    // para corregir un guardado por error sin ir al sidebar.
    showWatchPicker(wrap, channel, folders);
  }

  function closeWatchPicker() {
    document.querySelector('.ytcf-watch-picker')?.remove();
    document.removeEventListener('click', onWatchPickerOutside, true);
    document.removeEventListener('keydown', onWatchPickerKey, true);
    window.removeEventListener('resize', repositionWatchPicker);
    window.removeEventListener('scroll', repositionWatchPicker, true);
  }

  function onWatchPickerOutside(e) {
    const picker = document.querySelector('.ytcf-watch-picker');
    const wrap = document.getElementById(WATCHBTN_ID);
    if (!picker) return;
    if (picker.contains(e.target)) return;
    if (wrap && wrap.contains(e.target)) return;
    closeWatchPicker();
  }

  function onWatchPickerKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeWatchPicker();
  }

  // Re-ancla el selector bajo el botón: el menú solo se cierra con clic
  // fuera, botón Cancelar o guardado — nunca por scroll o resize.
  function repositionWatchPicker() {
    const picker = document.querySelector('.ytcf-watch-picker');
    const wrap = document.getElementById(WATCHBTN_ID);
    if (!picker || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // botón oculto temporalmente
    const w = picker.offsetWidth;
    const left = Math.min(Math.max(8, rect.right - w), window.innerWidth - w - 8);
    picker.style.top = `${rect.bottom + 8}px`;
    picker.style.left = `${Math.max(8, left)}px`;
  }
  // Selector flotante con posición fija sobre la página: no depende del
  // layout interno de la barra de acciones (que puede recortar o mover hijos).
  // Cada carpeta indica si ya contiene el canal (✓): clic añade o quita.
  function showWatchPicker(wrap, channel, allFolders) {
    closeWatchPicker();
    const picker = document.createElement('div');
    picker.className = 'ytcf-watch-picker';
    picker.setAttribute('role', 'listbox');
    picker.setAttribute('aria-label', 'Elegir carpeta');
    picker.style.position = 'fixed';

    const head = document.createElement('div');
    head.className = 'ytcf-watch-picker-title';
    head.textContent = `Añadir o quitar «${channel.name}»:`;
    head.title = channel.name;
    picker.appendChild(head);

    for (const f of allFolders) {
      const member = f.channels.some((c) => c.key === channel.key);
      const item = document.createElement('button');
      item.className = 'ytcf-watch-picker-item' + (member ? ' ytcf-watch-picker-item-added' : '');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', member ? 'true' : 'false');
      item.textContent = member
        ? `✓ ${f.name} (${f.channels.length})`
        : `${f.name} (${f.channels.length})`;
      item.title = member ? `Quitar de "${f.name}"` : `Añadir a "${f.name}"`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (member) removeFromFolder(f.id);
        else addToFolder(f.id);
      });
      picker.appendChild(item);
    }

    const close = document.createElement('button');
    close.className = 'ytcf-watch-picker-cancel';
    close.type = 'button';
    close.textContent = 'Cancelar';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeWatchPicker();
    });
    picker.appendChild(close);

    document.body.appendChild(picker);
    repositionWatchPicker();

    document.addEventListener('click', onWatchPickerOutside, true);
    document.addEventListener('keydown', onWatchPickerKey, true);
    window.addEventListener('resize', repositionWatchPicker);
    window.addEventListener('scroll', repositionWatchPicker, true);
  }

  async function addToFolder(folderId) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder || !currentChannel) return;
    if (folder.channels.some((c) => c.key === currentChannel.key)) {
      toast('Ese canal ya está en la carpeta.');
      render();
      return;
    }
    // Re-detecta al guardar: el avatar suele cargarse después de navegar.
    const channel = { ...currentChannel };
    const fresh = detectCurrentChannel();
    if (fresh && fresh.key === channel.key && fresh.avatar) channel.avatar = fresh.avatar;
    folder.channels.push(channel);
    folder.open = true;
    await save();
    render();
    closeWatchPicker();
    toast(`Añadido a "${folder.name}".`);
  }

  // Quita el canal del video actual de una carpeta (deshace un alta por error).
  async function removeFromFolder(folderId) {
    const channel = detectCurrentChannel() || currentChannel;
    const folder = folders.find((f) => f.id === folderId);
    if (!folder || !channel) return;
    if (!folder.channels.some((c) => c.key === channel.key)) {
      toast('Ese canal ya no está en la carpeta.');
      render();
      return;
    }
    folder.channels = folder.channels.filter((c) => c.key !== channel.key);
    await save();
    render();
    closeWatchPicker();
    toast(`Quitado de "${folder.name}".`);
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

    const add = document.createElement('button');
    add.className = 'ytcf-icon-btn ytcf-add';
    add.type = 'button';
    add.title = 'Crear carpeta';
    add.setAttribute('aria-label', 'Crear carpeta');
    add.textContent = '+';
    add.addEventListener('click', () => showCreateForm(section));

    header.appendChild(title);
    header.appendChild(add);
    section.appendChild(header);
    section.appendChild(buildBody());
    return section;
  }

  function ensureInject() {
    const guide = guideContainer();
    if (!guide) return; // guía aún no renderizada (o mini-guía)
    currentChannel = detectCurrentChannel();
    const existing = document.getElementById(SECTION_ID);
    if (existing && guide.contains(existing)) {
      render(); // refresca cambios de storage
      ensureWatchButton();
      return;
    }
    existing?.remove();
    // Inserta al principio para máxima visibilidad.
    guide.prepend(buildSection());
    syncTheme();
    ensureWatchButton();
  }

  function scheduleInject() {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      ensureInject();
      ensureWatchButton();
    }, 300);
  }

  // ---------- Arranque ----------
  async function init() {
    await load();
    ensureInject();

    // YouTube es SPA: re-inyecta cuando la guía se re-renderiza o cambia la URL.
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        currentChannel = detectCurrentChannel();
        removeWatchButton();
        window.YTCFView?.close(); // al navegar se vuelve al contenido normal
      }
      const guide = guideContainer();
      if (guide && !guide.contains(document.getElementById(SECTION_ID))) scheduleInject();
      // Refresca el canal actual aunque la sección exista (navegación watch -> canal).
      const fresh = detectCurrentChannel();
      if ((fresh?.key || null) !== (currentChannel?.key || null)) {
        currentChannel = fresh;
        render();
        ensureWatchButton();
      } else if (
        location.pathname === '/watch' &&
        currentChannel &&
        !document.getElementById(WATCHBTN_ID)
      ) {
        // YouTube re-renderizó la barra de acciones y retiró nuestro botón.
        ensureWatchButton();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Sigue cambios de tema claro/oscuro (<html dark>).
    new MutationObserver(syncTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dark']
    });

    chrome.storage?.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORE_KEY]) {
        folders = changes[STORE_KEY].newValue || [];
        render();
        closeWatchPicker();
        // Si la carpeta abierta se eliminó, cierra su muro.
        const openId = window.YTCFView?.getOpenId?.();
        if (openId && !folders.some((f) => f.id === openId)) window.YTCFView.close();
      }
    });
  }

  init();
})();
