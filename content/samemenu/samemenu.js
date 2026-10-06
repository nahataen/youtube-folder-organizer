/* Carpetas YouTube — mismo botón "＋ Carpeta" en la cabecera del canal
 * (samemenu/samemenu.js). "Same menu": reutiliza el botón del video.
 *
 * Sin código duplicado: el aspecto lo hereda de core/shared.css (chip
 * `ytcf-chip`) y la funcionalidad de `ns.toggleChannelPicker(wrap)`
 * (selector flotante + alta/baja).
 * Este archivo solo localiza la nueva ruta y mantiene el botón en la SPA.
 *
 * Ruta: contenedor de acciones de la cabecera del canal
 * (`ytFlexibleActionsViewModelHost` dentro de `ytd-page-header-renderer`).
 * OJO: esas clases las genera YouTube y pueden cambiar; hay respaldos abajo. */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const SAMEMENU_ID = 'ytcf-samemenu-add';

  // Solo páginas de canal (/@handle, /channel/ID, /c/x, /user/x).
  // /watch devuelve null aquí, así que nunca compite con el botón del video.
  function isChannelPage() {
    return !!ns.safeChannelPath(location.pathname);
  }

  function channelActionsSlot() {
    return (
      document.querySelector('ytd-page-header-renderer .ytFlexibleActionsViewModelHost') ||
      document.querySelector('.ytFlexibleActionsViewModelHost') ||
      document.querySelector('ytd-page-header-renderer #actions') ||
      null
    );
  }

  function removeSameMenuButton() {
    document.getElementById(SAMEMENU_ID)?.remove();
  }

  function ensureSameMenuButton() {
    if (!isChannelPage()) {
      removeSameMenuButton();
      return;
    }
    const channel = ns.detectCurrentChannel();
    ns.currentChannel = channel;
    if (!channel) {
      removeSameMenuButton();
      return;
    }
    const slot = channelActionsSlot();
    if (!slot) return; // cabecera aún no renderizada; el observer reintenta
    let wrap = document.getElementById(SAMEMENU_ID);
    if (wrap && wrap.parentNode !== slot) {
      wrap.remove();
      wrap = null;
    }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = SAMEMENU_ID;
      wrap.className = 'ytcf-watch-add';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ytcf-chip';
      // stopPropagation: evita que el clic burbujee a los handlers de YouTube.
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        ns.toggleChannelPicker(wrap);
      });
      wrap.appendChild(btn);
    }
    // Al final de las acciones (junto a Suscribirse); si YouTube lo mueve, se recoloca.
    if (slot.lastElementChild !== wrap) slot.append(wrap);
    const btn = wrap.querySelector('button');
    btn.textContent = '＋ Carpeta';
    btn.title = `Añadir "${channel.name}" a una carpeta`;
    btn.setAttribute('aria-label', `Añadir el canal ${channel.name} a una carpeta`);
    if (wrap.dataset.ckey !== channel.key) {
      wrap.dataset.ckey = channel.key; // SPA entre canales: cierra el selector obsoleto
      ns.closeWatchPicker();
    }
  }

  // YouTube es SPA: observa navegación y re-renders de la cabecera.
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      removeSameMenuButton();
      ns.closeWatchPicker(); // el selector abierto ya no vale en la nueva página
    }
    if (!isChannelPage()) return;
    const fresh = ns.detectCurrentChannel();
    if ((fresh?.key || null) !== (ns.currentChannel?.key || null)) {
      ns.currentChannel = fresh;
      ensureSameMenuButton();
    } else if (fresh && !document.getElementById(SAMEMENU_ID)) {
      // YouTube re-renderizó la cabecera y retiró nuestro botón.
      ensureSameMenuButton();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  ensureSameMenuButton();
})(window.YTCF);
