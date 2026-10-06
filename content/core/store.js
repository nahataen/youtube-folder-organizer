/* Carpetas YouTube — estado y persistencia (core/store.js).
 * Única fuente de verdad en memoria: `ns.folders` y `ns.currentChannel`.
 * Persistencia en `chrome.storage.local` bajo una sola clave. */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  const STORE_KEY = 'ytFoldersV1';
  const MAX_NAME = 40;

  /** @type {{ id: string, name: string, open: boolean, channels: { key: string, name: string, url: string, avatar: string }[] }[]} */
  ns.folders = [];
  ns.currentChannel = null;

  async function loadFolders() {
    try {
      const data = await chrome.storage.local.get(STORE_KEY);
      ns.folders = Array.isArray(data[STORE_KEY]) ? data[STORE_KEY] : [];
    } catch {
      ns.folders = [];
    }
  }

  async function saveFolders() {
    try {
      await chrome.storage.local.set({ [STORE_KEY]: ns.folders });
    } catch {
      ns.toast('No se pudo guardar en el almacenamiento local.');
    }
  }

  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // ¿Ya existe una carpeta con ese nombre? Insensible a mayúsculas y espacios.
  // excludeId se usa al renombrar para no chocar con la propia carpeta.
  function folderNameExists(name, excludeId) {
    const needle = name.trim().toLowerCase();
    return ns.folders.some((f) => f.id !== excludeId && f.name.trim().toLowerCase() === needle);
  }

  ns.STORE_KEY = STORE_KEY;
  ns.MAX_NAME = MAX_NAME;
  ns.loadFolders = loadFolders;
  ns.saveFolders = saveFolders;
  ns.uid = uid;
  ns.folderNameExists = folderNameExists;
})(window.YTCF);
