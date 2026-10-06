# 📁 Carpetas YouTube

**Organiza tus suscripciones de YouTube en carpetas, sin salir de YouTube.**

¿Sigues a 50 canales y tu sidebar es un caos? Esta extensión agrega una sección **"MIS CARPETAS"** al menú lateral de YouTube para que guardes tus canales por temas (música, cocina, programación…) y, al hacer clic en una carpeta, veas los videos recientes de esos canales directamente en la página.

Funciona en **Microsoft Edge** y **Google Chrome**.

---

## ✨ Qué puedes hacer

- **Crear carpetas** con el botón `+` del sidebar (sin nombres repetidos).
- **Renombrar y eliminar** carpetas con dos clics. Eliminar una carpeta no te desuscribe de nada, solo la quita de tu lista.
- **Añadir el canal actual**: visita un canal o un video y pulsa *"Añadir canal actual"* al pie de la sección.
- **Ver el muro de una carpeta**: clic en la carpeta y el contenido principal muestra los videos recientes de sus canales, agrupados por canal, con miniatura, duración, vistas y fecha.
- **Carpeta vacía con mensaje claro**: si aún no agregaste canales, verás *"Aún no has agregado canales a esta categoría."* en vez de una pantalla en blanco.
- **Modo claro y oscuro**: respeta el tema que uses en YouTube.

---

## 📥 Instalación (2 minutos)

1. Descarga este repositorio (`Code` → `Download ZIP`) y extráelo en una carpeta.
2. Abre `edge://extensions/` (o `chrome://extensions/`).
3. Activa el **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida** y selecciona la carpeta extraída.
5. Abre [youtube.com](https://www.youtube.com), despliega el menú lateral (☰) y busca **MIS CARPETAS**.

---

## 🧠 Cómo funciona por dentro (sin tecnicismos)

> Si las palabras raras te asustan, aquí van traducidas a lenguaje normal.

- **Un programita que vive dentro de YouTube.** La extensión no es una página aparte: son unos archivos (*content scripts*) que el navegador ejecuta automáticamente cada vez que abres youtube.com. Por eso la sección aparece integrada en el menú, con el mismo diseño y el mismo modo oscuro.
- **Tus carpetas se guardan en tu propio navegador.** Se usa el almacenamiento local del navegador (`chrome.storage.local`, o sea, una cajita privada dentro de Edge/Chrome). Nada viaja a ningún servidor nuestro — porque no tenemos servidor.
- **Para mostrar los videos, lee la página pública del canal.** Igual que cuando tú visitas la pestaña "Videos" de un canal, la extensión la lee para sacar títulos y miniaturas. Lo hace de a pocos canales por vez y guarda el resultado 10 minutos para no pedir de más. Si esa lectura falla, usa el **RSS oficial de YouTube** (un formato de avisos que el propio YouTube ofrece para seguir canales).
- **Pide un solo permiso: `storage`.** Solo necesita guardar tus carpetas. No lee tus contraseñas, no ve tus mensajes, no necesita acceso a todo internet.
- **Manifiesto V3.** Es el formato moderno que exigen Edge y Chrome para las extensiones (más seguro y con menos permisos que el anterior).

---

## 🗂️ Estructura del proyecto

```
manifest.json            → la "cédula" de la extensión: nombre, versión, permisos
content/
  content.js             → la sección MIS CARPETAS del sidebar (crear, renombrar, añadir canal)
  content.css            → estilos del sidebar (claro/oscuro)
  folderView.js          → el muro de videos al hacer clic en una carpeta
  folderView.css         → estilos del muro (parrilla, tarjetas, carga)
icons/                   → iconos 16, 48 y 128 px
```

---

## 🔒 Privacidad

- Todo se queda en tu equipo. No hay cuentas, no hay analítica, no hay servidores.
- Las únicas conexiones son a `youtube.com`: las páginas de canales que visitas (para listar videos) y sus feeds RSS oficiales.

## 📌 Versiones

- **v1.1.0** — muro de videos por carpeta, fotos de perfil, modo oscuro garantizado.
- **v1.0.0** — sección de carpetas en el sidebar con CRUD de carpetas y canales.
