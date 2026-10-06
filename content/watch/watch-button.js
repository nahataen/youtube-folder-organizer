/* Carpetas YouTube — botón "＋ Carpeta" del video (watch/watch-button.js).
 * Vive dentro del ytd-menu-renderer de la página de reproducción (/watch),
 * no en el sidebar. Solo se muestra cuando se detecta el canal del video.
 * El selector lista TODAS las carpetas: clic añade o quita (✓ = ya la contiene).
 * Carga el último (ver manifest.json): al final se auto-sincroniza por si el
 * arranque del sidebar ya resolvió el storage antes de que existiera este módulo. */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

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
    const channel = ns.detectCurrentChannel();
    ns.currentChannel = channel;
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
    const channel = ns.detectCurrentChannel() || ns.currentChannel;
    if (!channel) {
      ns.toast('No se pudo detectar el canal de este video. Espera a que cargue la página.');
      return;
    }
    ns.currentChannel = channel;
    if (ns.folders.length === 0) {
      ns.toast('Crea primero una carpeta en «MIS CARPETAS» del menú lateral.');
      return;
    }
    // Vía rápida: una sola carpeta y el canal aún no está en ella.
    if (
      ns.folders.length === 1 &&
      !ns.folders[0].channels.some((c) => c.key === channel.key)
    ) {
      addToFolder(ns.folders[0].id);
      return;
    }
    // El selector lista TODAS las carpetas: permite añadir o quitar,
    // para corregir un guardado por error sin ir al sidebar.
    showWatchPicker(wrap, channel, ns.folders);
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
    const folder = ns.folders.find((f) => f.id === folderId);
    if (!folder || !ns.currentChannel) return;
    if (folder.channels.some((c) => c.key === ns.currentChannel.key)) {
      ns.toast('Ese canal ya está en la carpeta.');
      ns.renderSidebar();
      return;
    }
    // Re-detecta al guardar: el avatar suele cargarse después de navegar.
    const channel = { ...ns.currentChannel };
    const fresh = ns.detectCurrentChannel();
    if (fresh && fresh.key === channel.key && fresh.avatar) channel.avatar = fresh.avatar;
    folder.channels.push(channel);
    folder.open = true;
    await ns.saveFolders();
    ns.renderSidebar();
    closeWatchPicker();
    ns.toast(`Añadido a "${folder.name}".`);
  }

  // Quita el canal del video actual de una carpeta (deshace un alta por error).
  async function removeFromFolder(folderId) {
    const channel = ns.detectCurrentChannel() || ns.currentChannel;
    const folder = ns.folders.find((f) => f.id === folderId);
    if (!folder || !channel) return;
    if (!folder.channels.some((c) => c.key === channel.key)) {
      ns.toast('Ese canal ya no está en la carpeta.');
      ns.renderSidebar();
      return;
    }
    folder.channels = folder.channels.filter((c) => c.key !== channel.key);
    await ns.saveFolders();
    ns.renderSidebar();
    closeWatchPicker();
    ns.toast(`Quitado de "${folder.name}".`);
  }

  ns.WATCHBTN_ID = WATCHBTN_ID;
  ns.ensureWatchButton = ensureWatchButton;
  ns.removeWatchButton = removeWatchButton;
  ns.closeWatchPicker = closeWatchPicker;

  // Auto-sincroniza al cargar: el sidebar pudo resolver el storage antes de
  // que este módulo existiera (los content-scripts comparten microtareas).
  ensureWatchButton();
})(window.YTCF);
