// Service Worker de Trial Revolution
//
// El anterior no cacheaba nada: era un pass-through a red con un 503 si
// fallaba. En una prueba de trial eso significa que **cualquier recarga sin
// cobertura deja al espectador mirando la pantalla de espera**, y cuando la
// cobertura vuelve la app arranca de cero. Para quien lo vive eso es «he
// refrescado y me ha devuelto al principio».
//
// Estrategia:
//   · navegación (el propio index.html) → RED PRIMERO, con 3,5 s de paciencia.
//     Si la red contesta, se guarda y se sirve: nadie se queda con una versión
//     vieja, que es justo lo que hay que evitar cuando se sube un arreglo a
//     media carrera. Si la red tarda o falla, se sirve lo guardado y la app
//     arranca igual.
//   · resto de lo nuestro (iconos, manifiesto) → lo guardado primero, y se
//     refresca por detrás.
//   · data.json, Firebase y gstatic → NUNCA de la caché. Son datos, y un dato
//     viejo servido como nuevo es peor que no tener dato.
const CACHE = 'tr-armazon-5';
// El SDK de Firebase se guarda también. La web pública lo importa en caliente
// (no al arrancar), así que sin él degrada en vez de morir — pero sin él no
// hay canal en vivo, y con lo guardado en el teléfono más el SDK la app
// arranca entera sin cobertura. Es código, no datos, y está clavado en 10.12.0.
const SDK = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
];
const ARMAZON = [
  './', './index.html', './manifest.json',
  './icon-180.png', './icon-192.png', './icon-512.png'
].concat(SDK);
const ESPERA_RED_MS = 3500;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ARMAZON.map(u => c.add(u).catch(() => {}))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .catch(() => {})
      .then(() => self.clients.claim())
  );
});

function _guarda(req, res) {
  if (!res || !res.ok || res.type === 'opaque') return;
  const copia = res.clone();
  caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                      // a la red, sin tocar
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  // De fuera sólo se guarda el SDK: los datos de Firebase van siempre a la red.
  if (url.origin !== self.location.origin &&
      url.pathname.indexOf('/firebasejs/') === -1) return;
  if (url.pathname.indexOf('data.json') !== -1) return;  // datos, no armazón

  const esNavegacion = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (esNavegacion) {
    e.respondWith((async () => {
      let porRed = null;
      try {
        const red = fetch(req).then(r => { _guarda(req, r); return r; });
        const reloj = new Promise(ok => setTimeout(() => ok(null), ESPERA_RED_MS));
        porRed = await Promise.race([red.catch(() => null), reloj]);
        if (porRed) return porRed;
        // La red tarda demasiado: se sirve lo guardado y que la red siga a lo
        // suyo por detrás, para que la próxima vez esté al día.
        const guardado = await caches.match('./index.html', { ignoreSearch: true });
        if (guardado) return guardado;
        return await red;              // no hay nada guardado: toca esperar
      } catch (err) {
        const guardado = await caches.match('./index.html', { ignoreSearch: true });
        if (guardado) return guardado;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Sin conexión</title>' +
          '<body style="font:16px/1.5 system-ui;padding:32px;text-align:center">' +
          '<h1 style="font-size:19px">Sin conexión</h1>' +
          '<p>No hay cobertura y esta es la primera vez que abres la app en este ' +
          'teléfono, así que no hay nada guardado todavía.</p>' +
          '<p><button onclick="location.reload()" style="padding:10px 18px;font-size:15px">' +
          'Reintentar</button></p></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // El manifiesto, a la RED primero.
  //
  // 21 nov: cambiar 'theme_color' no llegaba a los telefonos. Una PWA instalada
  // en Android es un WebAPK, y Chrome solo se entera de que el manifiesto ha
  // cambiado cuando lo vuelve a descargar — como mucho una vez al dia, y al
  // abrir la app. Servirle una copia guardada de hace semanas es, como poco,
  // meter un retraso mas encima de ese; y como el manifiesto son cuatro lineas,
  // no se gana nada guardandolo primero.
  //
  // Se mantiene en el armazon para que exista sin cobertura, pero la copia solo
  // se usa si la red falla.
  //
  // OJO: la URL del manifiesto NO se puede cambiar ni mover. Chrome vuelve a
  // pedir exactamente la que tenia al instalar; si responde 404, esa app no se
  // actualiza nunca mas. Nada de 'manifest.json?v=2'.
  if (url.pathname.indexOf('manifest.json') !== -1) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        _guarda(req, r);
        return r;
      } catch (err) {
        const guardado = await caches.match(req, { ignoreSearch: true });
        return guardado || new Response('', { status: 503 });
      }
    })());
    return;
  }

  // Iconos: lo guardado primero, y se refresca por detrás.
  e.respondWith((async () => {
    const guardado = await caches.match(req, { ignoreSearch: true });
    if (guardado) {
      fetch(req).then(r => _guarda(req, r)).catch(() => {});
      return guardado;
    }
    try {
      const r = await fetch(req);
      _guarda(req, r);
      return r;
    } catch (err) {
      return new Response('', { status: 503 });
    }
  })());
});
