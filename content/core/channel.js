/* Carpetas YouTube — detección del canal actual (core/channel.js).
 * Página de canal (/... ) o autor del video en reproducción (/watch). */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  function detectCurrentChannel() {
    // 1) Página de canal: /@handle, /channel/ID, /c/nombre, /user/nombre
    const path = ns.safeChannelPath(location.pathname);
    if (path) {
      const header = document.querySelector('ytd-c4-tabbed-header-renderer');
      const avatar = ns.findAvatar(
        'ytd-c4-tabbed-header-renderer #avatar img, ytd-page-header-renderer #avatar img, ytd-c4-tabbed-header-renderer img#img'
      );
      const nameEl =
        header?.querySelector('ytd-channel-name #text') ||
        document.querySelector('ytd-c4-tabbed-header-renderer #channel-name #text');
      const name = ns.cleanTitle(nameEl?.textContent) || ns.cleanTitle(document.title) || 'Canal actual';
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
      const key = href ? ns.safeChannelPath(href) : null;
      if (key) {
        const avatar = ns.findAvatar(
          '#owner #avatar img, ytd-watch-metadata #avatar img, ytd-video-owner-renderer #avatar img'
        );
        return {
          key,
          name: ns.cleanTitle(anchor.textContent) || 'Canal del video',
          url: `https://www.youtube.com${key}`,
          avatar
        };
      }
    }
    return null;
  }

  ns.detectCurrentChannel = detectCurrentChannel;
})(window.YTCF);
