# 📁 Carpetas YouTube

**Organiza tus suscripciones de YouTube en carpetas, sin salir de YouTube.**

Extensión para **Chrome y Edge** que añade una sección **MIS CARPETAS** al menú lateral de YouTube. Crea categorías como música, programación, cocina, etc., y consulta los videos recientes de sus canales.

## ✨ Funciones

* Crear, renombrar y eliminar carpetas.
* Añadir o quitar canales con el botón ＋ Carpeta de cualquier video.
* Ver los videos recientes de cada carpeta.
* Videos agrupados por canal con miniatura, duración, vistas y fecha.
* Soporte para modo claro y oscuro.
* Las carpetas vacías muestran un mensaje informativo.

## 📥 Instalación

1. Descarga el repositorio y extráelo.
2. Abre `edge://extensions/` o `chrome://extensions/`.
3. Activa **Modo de desarrollador**.
4. Selecciona **Cargar descomprimida** y elige la carpeta del proyecto.
5. Abre YouTube y busca **MIS CARPETAS** en el menú lateral.

## ⚙️ Cómo funciona

* Las carpetas se guardan localmente con `chrome.storage.local`.
* Los videos se obtienen de las páginas públicas de YouTube y, como alternativa, mediante RSS.
* No utiliza servidores propios ni cuentas externas.
* Solo solicita el permiso `storage`.
* Utiliza **Manifest V3**.

## 🗂️ Estructura

```text
manifest.json
content/
  core/       → utils.js, store.js, channel.js + shared.css
  sidebar/    → sidebar.js, forms.js + sidebar.css
  watch/      → watch-button.js + watch.css
  wall/       → wall.js, videos.js + folderView.css
icons/
```

## 🔒 Privacidad

Los datos de las carpetas permanecen en tu navegador. La extensión no utiliza cuentas, analítica ni servidores propios.

## 📌 Versiones

* **v1.1.0** — muro de videos, fotos de perfil y modo oscuro.
* **v1.0.0** — carpetas y organización de canales.
