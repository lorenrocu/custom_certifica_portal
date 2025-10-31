/**
 * QR Overlay Manager - Versión calibrada 1:1 con QWeb
 * - Usa PNG del backend (/report/barcode) con oversampling entero
 * - Aplica "innerInset" (quiet zone interno) para igualar tamaño de patrones
 * - Compone LOGO + QR en un único PNG y lo embebe en el PDF (PDFLib)
 * - Vista previa usa el MISMO pipeline del PDF (cero borrosidad)
 */

class QROverlayManager {
  constructor() {
    this.PDFLib = null;
    this.librariesLoaded = false;
    this.useRealLibraries = false;
  }

  /* =========================
   * Inicialización
   * =======================*/
  async initialize() {
    try {
      await this.loadLibraries();
      this.useRealLibraries = !!(this.PDFLib && this.PDFLib.PDFDocument);
      console.log(this.useRealLibraries
        ? '✅ PDFLib cargado; se usará overlay JS real'
        : '⚠️ PDFLib no disponible; se usará fallback /overlay');
    } catch (e) {
      console.warn('⚠️ No se pudieron cargar librerías:', e);
      this.useRealLibraries = false;
    }
  }

  async loadLibraries() {
    // Cargar PDF-lib si no existe
    if (typeof PDFLib === 'undefined') {
      await this.loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      this.PDFLib = window.PDFLib;
    } else {
      this.PDFLib = window.PDFLib;
    }
    this.librariesLoaded = !!this.PDFLib;
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* =========================
   * Utilidades
   * =======================*/
  dataURLToUint8Array(dataURL) {
    const parts = dataURL.split(',');
    const base64 = parts[1] || '';
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async downloadPDF(url) {
    const r = await fetch(url, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.arrayBuffer();
  }

  /* =========================
   * Construcción del PNG (LOGO + QR) 1:1 con QWeb
   * =======================*/
  /**
   * buildCompositePNG(qrText, qrSizeToken, logoSrc, layoutSpec)
   * - Para 1.5cm usa:
   *   container: 118x233, logo: 56, spacing: 14, qrMarginX: 9, qrSizePx: 100, innerInset: 2
   * - Oversample x4 y reducción por factor entero => nitidez perfecta
   * - innerInset reduce el área “activa” del QR para igualar tamaño de patrones
   */
  async buildCompositePNG(qrText, _qrSizeToken, logoSrc, layoutSpec) {
    const useCustom = !!layoutSpec;

    // Layout 1.5 cm EXACTO (coincide con tu QWeb)
    const containerWidth  = useCustom ? (layoutSpec.containerWidth  ?? 118) : 118;
    const containerHeight = useCustom ? (layoutSpec.containerHeight ?? 233) : 233;
    const logoHeight      = useCustom ? (layoutSpec.logoHeight      ?? 56)  : 56;
    const spacing         = useCustom ? (layoutSpec.spacing         ?? 14)  : 14;
    const qrMarginX       = useCustom ? (layoutSpec.qrMarginX       ?? 9)   : 9;
    const qrNominalPx     = useCustom ? (layoutSpec.qrSizePx        ?? 100) : 100;

    // Quiet zone interno para igualar “finder patterns” del QWeb
    const innerInset = useCustom && typeof layoutSpec.innerInset === 'number' ? layoutSpec.innerInset : 2;
    const qrDrawSize = qrNominalPx - innerInset * 2; // p.ej., 96 si inset=2

    // Oversampling entero (x4) => se pide grande y se reduce sin suavizado
    const oversample = 4;
    const fetchW = Math.max(100, qrDrawSize * oversample);
    const fetchH = fetchW;

    // 1) Obtener PNG del QR desde backend
    const qrUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${fetchW}&height=${fetchH}`;
    const qrBigImg = await this.loadImage(qrUrl);

    // 2) Reducir al tamaño final (sin suavizado, factor entero)
    const qrCanvas = document.createElement('canvas');
    qrCanvas.width = qrDrawSize;
    qrCanvas.height = qrDrawSize;
    const qctx = qrCanvas.getContext('2d');
    qctx.imageSmoothingEnabled = false;
    qctx.clearRect(0, 0, qrDrawSize, qrDrawSize);
    qctx.drawImage(qrBigImg, 0, 0, qrDrawSize, qrDrawSize);

    // 3) Componer LOGO + QR en un único PNG
    const canvas = document.createElement('canvas');
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Fondo BLANCO como en QWeb
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    // Logo (estirado al ancho del contenedor, altura fija)
    if (logoSrc && logoHeight > 0) {
      try {
        const logoImg = await this.loadImage(logoSrc);
        ctx.drawImage(logoImg, 0, 0, containerWidth, logoHeight);
      } catch (e) {
        console.warn('Logo no disponible para componer:', e);
      }
    }

    // QR (alineado con margen lateral X e inset interno)
    const qrX = qrMarginX + innerInset;
    const qrY = (logoHeight ? logoHeight + spacing : 0) + innerInset;
    ctx.drawImage(qrCanvas, qrX, qrY, qrDrawSize, qrDrawSize);

    const dataUrl = canvas.toDataURL('image/png');
    return this.dataURLToUint8Array(dataUrl);
  }

  /* =========================
   * Vista previa (usa el MISMO pipeline que el PDF)
   * =======================*/
  async updateQRPreview(imgSelector, qrText, _sizeToken, logoSrc = null, layoutSpec = null) {
    const imgEl = document.querySelector(imgSelector);
    if (!imgEl) return;

    try {
      const pngBytes = await this.buildCompositePNG(qrText, _sizeToken, logoSrc, layoutSpec);
      const blob = new Blob([pngBytes], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      imgEl.src = url;
      imgEl.style.imageRendering = 'pixelated';
    } catch (e) {
      console.warn('Preview fallback:', e);
      // Fallback mínimo (solo QR)
      imgEl.src = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=100&height=100`;
      imgEl.style.imageRendering = 'pixelated';
    }
  }

  /* =========================
   * Generación PDF (overlay JS real) + Fallback servidor
   * =======================*/
  async generateQROverlay(pdfUrl, qrText, qrSizeToken, filename = 'certificado-qr.pdf', logoSrc = null, layoutSpec = null) {
    try {
      if (!(this.useRealLibraries && this.PDFLib && this.PDFLib.PDFDocument)) {
        this.redirectToServerOverlay();
        return true;
      }

      // 1) Descargar PDF original
      const pdfBytes = await this.downloadPDF(pdfUrl);
      const pdfDoc = await this.PDFLib.PDFDocument.load(pdfBytes);

      // 2) Construir PNG compuesto idéntico al de QWeb
      const compositePNG = await this.buildCompositePNG(qrText, qrSizeToken, logoSrc, layoutSpec);
      const pdfImage = await pdfDoc.embedPng(compositePNG);

      // 3) Posicionar en primera página (esquina sup. derecha)
      const [firstPage] = pdfDoc.getPages();
      const { width: pageW, height: pageH } = firstPage.getSize();

      const containerW = (layoutSpec?.containerWidth ?? 118);
      const containerH = (layoutSpec?.containerHeight ?? 233);

      const margin = 20; // mismo “feeling” que el QWeb
      const drawW = containerW; // px≈pt; coincide visualmente
      const drawH = containerH;

      const x = pageW - drawW - margin;
      const y = pageH - drawH - margin;

      firstPage.drawImage(pdfImage, { x, y, width: drawW, height: drawH });

      // 4) Descargar
      const out = await pdfDoc.save();
      this.downloadFile(out, filename);
      return true;

    } catch (e) {
      console.error('❌ Error overlay JS:', e);
      this.redirectToServerOverlay();
      return true;
    }
  }

  downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  redirectToServerOverlay() {
    try {
      const current = window.location.pathname;
      const target = current.replace('/overlay_js', '/overlay');
      const finalUrl = `${window.location.origin}${target}${window.location.search}`;
      window.location.href = finalUrl;
    } catch (e) {
      console.warn('No se pudo redirigir a /overlay:', e);
    }
  }
}

// Instancia global
window.qrOverlayManager = new QROverlayManager();
window.qrOverlayManager.initialize().catch((e) => console.error('Init error:', e));
