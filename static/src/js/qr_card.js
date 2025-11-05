/*
 * Componente: JS Card para QR
 * - Construye la URL al servicio externo: https://ctf-qr.onrender.com/card?qr=<encoded_odoo_url>&cm=<size>
 * - Realiza una petición GET (fetch) y renderiza la imagen devuelta
 * - Manejo de tamaños (cm) y errores de conexión
 */

(function () {
  const SERVICE_BASE = 'https://ctf-qr.onrender.com/card?qr=';

  function buildServiceUrl(odooUrl, cmSize) {
    const encoded = encodeURIComponent(odooUrl || '');
    const size = cmSize || '1.5';
    return `${SERVICE_BASE}${encoded}&cm=${encodeURIComponent(size)}`;
  }

  async function loadQrImage(imgEl, odooUrl, cmSize) {
    if (!imgEl) return;
    if (!odooUrl) {
      showError(imgEl, 'URL de QR no disponible');
      return;
    }

    const fullUrl = buildServiceUrl(odooUrl, cmSize);
    imgEl.dataset.cm = cmSize;
    imgEl.dataset.qrUrl = odooUrl;

    try {
      // Realizamos GET explícito para cumplir el requisito y manejar errores.
      const resp = await fetch(fullUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Estado HTTP ${resp.status}`);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      imgEl.src = objectUrl;
      imgEl.alt = `QR (${cmSize} cm)`;
      imgEl.title = `QR generado (${cmSize} cm)`;
      imgEl.classList.add('js-qr-card-loaded');
      clearError(imgEl);

      // Limpieza del objeto URL cuando la imagen se descargue/cambie
      const old = imgEl.dataset.objectUrl;
      imgEl.dataset.objectUrl = objectUrl;
      if (old) {
        try { URL.revokeObjectURL(old); } catch (e) {}
      }
    } catch (err) {
      // Como fallback, intentamos asignar la URL directa al src del img
      try {
        imgEl.src = fullUrl;
        imgEl.alt = `QR (${cmSize} cm)`;
        imgEl.title = `QR generado (${cmSize} cm)`;
        clearError(imgEl);
      } catch (e) {
        showError(imgEl, 'No se pudo cargar el QR. Verifique su conexión.');
      }
    }
  }

  function showError(imgEl, message) {
    let errBox = imgEl.nextElementSibling;
    if (!errBox || !errBox.classList.contains('js-qr-error')) {
      errBox = document.createElement('div');
      errBox.className = 'js-qr-error';
      errBox.style.color = '#b00020';
      errBox.style.fontSize = '12px';
      errBox.style.marginTop = '6px';
      imgEl.insertAdjacentElement('afterend', errBox);
    }
    errBox.textContent = message || 'Error cargando el QR';
  }

  function clearError(imgEl) {
    const errBox = imgEl.nextElementSibling;
    if (errBox && errBox.classList.contains('js-qr-error')) {
      errBox.textContent = '';
    }
  }

  function setupSizeButtons() {
    const buttons = document.querySelectorAll('.js-qr-size');
    buttons.forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const targetSel = btn.getAttribute('data-target');
        const cm = btn.getAttribute('data-cm') || '1.5';
        const imgEl = document.querySelector(targetSel);
        if (!imgEl) return;
        const odooUrl = imgEl.getAttribute('data-qr-url') || imgEl.dataset.qrUrl;
        loadQrImage(imgEl, odooUrl, cm);
      });
    });
  }

  function initQrCards() {
    const imgs = document.querySelectorAll('img.js-qr-card');
    imgs.forEach(imgEl => {
      const odooUrl = imgEl.getAttribute('data-qr-url') || imgEl.dataset.qrUrl;
      const size = imgEl.getAttribute('data-cm') || imgEl.dataset.cm || '1.5';
      loadQrImage(imgEl, odooUrl, size);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initQrCards();
    setupSizeButtons();
  });
})();