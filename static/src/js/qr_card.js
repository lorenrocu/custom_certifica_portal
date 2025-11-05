// Componente JS para generar y visualizar QR usando servicio externo "Card"
// Funciona sin QWeb para la generación del QR. Solo usamos QWeb para insertar
// los botones y contenedores en la interfaz.

(function () {
  const SERVICE_BASE = 'https://ctf-qr.onrender.com/card?qr=';

  function buildServiceUrl(odooQrDataUrl, cm) {
    const encoded = encodeURIComponent(odooQrDataUrl);
    const size = encodeURIComponent(String(cm || '1.5'));
    return `${SERVICE_BASE}${encoded}&cm=${size}`;
  }

  // Abre una nueva ventana y renderiza la imagen del QR.
  async function openQrWindow(odooQrDataUrl, cm) {
    const url = buildServiceUrl(odooQrDataUrl, cm);

    const win = window.open('', '_blank');
    if (!win) {
      alert('No se pudo abrir la ventana. Por favor, habilita los pop-ups para este sitio.');
      return;
    }

    // Estructura básica de la ventana
    win.document.write(`
      <html>
        <head>
          <title>QR ${cm || '1.5'} cm</title>
          <meta charset="utf-8" />
          <style>
            body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Helvetica,Arial,sans-serif;text-align:center;padding:24px;background:#fff;color:#222}
            .error{color:#b00020;margin-top:16px}
            img{max-width:100%;height:auto}
            .hint{font-size:12px;color:#666;margin-top:12px}
          </style>
        </head>
        <body>
          <h3>QR ${cm || '1.5'} cm</h3>
          <div id="qrContainer"><p>Cargando...</p></div>
          <div class="hint">Si ves un cuadro vacío, espera unos segundos o recarga esta ventana.</div>
        </body>
      </html>
    `);

    try {
      const resp = await fetch(url, { method: 'GET', mode: 'cors' });
      if (!resp.ok) {
        throw new Error(`Respuesta no OK: ${resp.status}`);
      }
      const blob = await resp.blob();
      const imgUrl = win.URL.createObjectURL(blob);
      const container = win.document.getElementById('qrContainer');
      container.innerHTML = '';
      const imgEl = win.document.createElement('img');
      imgEl.alt = `QR ${cm || '1.5'} cm`;
      imgEl.src = imgUrl;
      container.appendChild(imgEl);
    } catch (err) {
      const container = win.document.getElementById('qrContainer');
      // Fallback: intentar mostrar directamente la URL del servicio como src de IMG
      const fallbackImg = win.document.createElement('img');
      fallbackImg.alt = `QR ${cm || '1.5'} cm (fallback)`;
      fallbackImg.src = url;
      container.innerHTML = '';
      container.appendChild(fallbackImg);
      const msg = win.document.createElement('div');
      msg.className = 'error';
      msg.innerHTML = `No se pudo obtener el blob del QR (fetch). Se mostró un fallback directo.<br/>Detalle: ${err && err.message ? err.message : err}`;
      container.appendChild(msg);
    }
  }

  // API pública para reutilización futura con otros tamaños
  window.generateQrCard = function (odooQrDataUrl, cm) {
    return openQrWindow(odooQrDataUrl, cm);
  };

  // Auto-inicialización: vincula los enlaces que tengan la clase .js-card-qr
  function wireLinks() {
    const links = document.querySelectorAll('a.js-card-qr');
    links.forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const qrUrl = a.getAttribute('data-url');
        const cm = a.getAttribute('data-cm') || '1.5';
        if (!qrUrl) {
          console.error('Falta data-url en el enlace .js-card-qr');
          return;
        }
        openQrWindow(qrUrl, cm);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireLinks);
  } else {
    wireLinks();
  }
})();