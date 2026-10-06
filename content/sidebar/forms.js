/* Carpetas YouTube — formularios del sidebar (sidebar/forms.js).
 * Creación y renombrado inline de carpetas. Llaman a `ns.renderSidebar()`
 * al confirmar o cancelar. */

window.YTCF = window.YTCF || {};

((ns) => {
  'use strict';

  // Formulario inline para crear carpeta
  function showCreateForm(root) {
    if (root.querySelector('.ytcf-form')) return;
    const form = document.createElement('div');
    form.className = 'ytcf-form';

    const input = document.createElement('input');
    input.className = 'ytcf-input';
    input.type = 'text';
    input.maxLength = ns.MAX_NAME;
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
      form.remove();
      ns.renderSidebar();
      ns.toast(`Carpeta "${name}" creada.`);
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
    input.maxLength = ns.MAX_NAME;
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
      const name = input.value.trim().slice(0, ns.MAX_NAME);
      if (!name) {
        input.focus();
        return;
      }
      if (ns.folderNameExists(name, folder.id)) {
        ns.toast(`Ya existe otra carpeta llamada "${name}".`);
        input.focus();
        input.select();
        return;
      }
      folder.name = name;
      await ns.saveFolders();
      ns.renderSidebar();
    };

    ok.addEventListener('click', commit);
    cancel.addEventListener('click', ns.renderSidebar);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') ns.renderSidebar();
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

  ns.showCreateForm = showCreateForm;
  ns.showRenameForm = showRenameForm;
})(window.YTCF);
