/**
 * QR Overlay Manager - Gestiona la superposición de códigos QR en PDFs
 * Correcciones clave para igualar EXACTO al QWeb (1.5 cm):
 * 1) Fondo blanco en el canvas (sin transparencia).
 * 2) Para 1.5 cm: pedir QR 100x100 y dibujar 1:1 (sin reescalar).
 * 3) Mantener layout 118x233 con logo 118x56, spacing 14, margen X = 9, QR 100x100.
 */

class QROverlayManager {
  constructor() {
    this.PDFLib = null;
    this.QRCode = null;
    this.librariesLoaded = false;
    this.useRealLibraries = false;

    // Tamaños EXACTOS usados por el backend/QWeb
    this.EXACT_QR_MAP = {
      '1.5cm': 100,
      '3.5cm': 234,
      '5.0cm': 333,
      '9.5cm': 587,
    };
  }

  async initialize() {
    try {
      await this.loadLibraries();
      if (this.PDFLib) {
        this.useRealLibraries = true;
      } else {
        this.useRealLibraries = false;
      }
    } catch {
      this.useRealLibraries = false;
    }
  }

  async loadLibraries() {
    try {
      if (typeof PDFLib === 'undefined') {
        await this.loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      }
      this.PDFLib = window.PDFLib || null;

      // (Opcional) QRCode.js no es imprescindible porque obtenemos el PNG real del backend
      if (typeof QRCode === 'undefined') {
        await this.loadScript('https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js');
      }
      this.QRCode = window.QRCode || null;

      this.librariesLoaded = !!this.PDFLib;
    } catch (e) {
      this.PDFLib = null;
      this.QRCode = null;
      this.librariesLoaded = false;
    }
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

  // Mantengo el helper, pero para 1.5cm usaremos EXACT_QR_MAP siempre.
  convertSizeToPixels(size) {
    if (this.EXACT_QR_MAP[size]) return this.EXACT_QR_MAP[size];
    if (typeof size === 'number') return size;
    const m = typeof size === 'string' && size.match(/^(\d+(?:\.\d+)?)cm$/);
    if (m) return Math.round(parseFloat(m[1]) * 28.35);
    return 42;
  }

  async downloadPDF(url) {
    const r = await fetch(url, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  }

  async generateQROverlay(pdfUrl, qrText, qrSize, filename = 'certificado-qr.pdf', logoSrc = null, layoutSpec = null) {
    try {
      if (this.useRealLibraries && this.PDFLib?.PDFDocument) {
        return await this.generateRealOverlay(pdfUrl, qrText, qrSize, filename, logoSrc, layoutSpec);
      }
      this.redirectToServerOverlay();
      return true;
    } catch (error) {
      console.error('generateQROverlay error:', error);
      const demo = this.createDemoPDF(qrText, qrSize, filename);
      this.downloadFile(demo, filename);
      return true;
    }
  }

  /**
   * Genera el PNG compuesto (logo + QR) SIN transparencia y con medidas exactas.
   * PARA 1.5cm: usa estrictamente 118x233 contenedor, logo 118x56, spacing 14, qrMarginX 9 y QR 100x100.
   */
  async buildCompositePNG(qrText, qrSize, logoSrc, layoutSpec) {
    const useCustom = !!layoutSpec;

    // Medidas EXACTAS cuando hay layout 1.5 cm
    let containerWidth = useCustom ? (layoutSpec.containerWidth || 118) : this.convertSizeToPixels(qrSize);
    let containerHeight = useCustom ? (layoutSpec.containerHeight || 233) : containerWidth;
    let logoHeight = 0;
    let spacing = 0;
    let qrMarginX = 0;

    // Tamaño del QR interno (usar EXACTAMENTE 100 para 1.5 cm)
    const qrInnerPx = useCustom
      ? (layoutSpec.qrSizePx || this.convertSizeToPixels(qrSize))
      : this.convertSizeToPixels(qrSize);

    if (useCustom) {
      logoHeight = layoutSpec.logoHeight || 56;
      spacing = layoutSpec.spacing || 14;
      qrMarginX = layoutSpec.qrMarginX || 9;
    } else {
      // Sin layout: aproximación razonable
      logoHeight = Math.round(containerWidth * 0.48);
      spacing = 6;
      qrMarginX = 0;
      containerHeight = logoHeight + spacing + qrInnerPx;
    }

    // 1) Crear canvas con fondo BLANCO (para evitar fondo negro en PDF)
    const canvas = document.createElement('canvas');
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, containerWidth, containerHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    // 2) Dibujar logo (si hay)
    if (logoSrc && logoHeight > 0) {
      try {
        const logoImg = await this.loadImage(logoSrc);
        // Estirar al ancho del contenedor (como QWeb dentro del bloque de 118px)
        ctx.drawImage(logoImg, 0, 0, containerWidth, logoHeight);
      } catch (e) {
        // Si falla el logo, simplemente no lo dibujamos
      }
    }

    // 3) Descargar QR del backend en el tamaño EXACTO (sin oversampling si es 1.5 cm)
    const exactPx = this.EXACT_QR_MAP[qrSize] || qrInnerPx;
    // Para 1.5 cm queremos 100x100 exacto, sin reescalar.
    const fetchWidth = exactPx;
    const fetchHeight = exactPx;
    const qrUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${fetchWidth}&height=${fetchHeight}`;
    const qrImg = await this.loadImage(qrUrl);

    // 4) Dibujar QR 1:1 para no alterar el patrón
    const qrX = qrMarginX;
    const qrY = logoHeight + (logoHeight ? spacing : 0);
    ctx.drawImage(qrImg, qrX, qrY, exactPx, exactPx);

    // 5) Exportar PNG
    const dataUrl = canvas.toDataURL('image/png');
    return this.dataURLToUint8Array(dataUrl);
  }

  async generateRealOverlay(pdfUrl, qrText, qrSize, filename, logoSrc, layoutSpec = null) {
    // 1) Descargar PDF original
    const pdfBytes = await this.downloadPDF(pdfUrl);
    const pdfDoc = await this.PDFLib.PDFDocument.load(pdfBytes);

    // 2) Preparar imagen compuesta (logo + QR) EXACTA
    const compositePngBytes = await this.buildCompositePNG(qrText, qrSize, logoSrc, layoutSpec);
    const compositeImage = await pdfDoc.embedPng(compositePngBytes);

    // 3) Posicionar en la esquina superior derecha (coordenadas en puntos;
    //    usamos los mismos píxeles como puntos para mantener la apariencia)
    const firstPage = pdfDoc.getPage(0);
    const { width, height } = firstPage.getSize();

    const cw = (layoutSpec?.containerWidth) || this.convertSizeToPixels(qrSize);
    const ch = (layoutSpec?.containerHeight) || ( (layoutSpec?.logoHeight || Math.round(cw*0.48)) + (layoutSpec?.spacing || 6) + (layoutSpec?.qrSizePx || this.convertSizeToPixels(qrSize)) );

    const margin = 20;
    const x = width - cw - margin;
    const y = height - ch - margin;

    firstPage.drawImage(compositeImage, { x, y, width: cw, height: ch });

    // 4) Guardar y descargar
    const out = await pdfDoc.save();
    this.downloadFile(out, filename);
    return true;
  }

  async updateQRPreview(imgSelector, qrText, targetPx, logoSrc = null, layoutSpec = null) {
    const imgEl = document.querySelector(imgSelector);
    if (!imgEl) return;

    try {
      // Usamos el mismo pipeline del PDF: componer un PNG con fondo blanco y asignarlo al <img>
      const pngBytes = await this.buildCompositePNG(
        qrText,
        // OJO: aquí targetPx se envía como '1.5cm' / '3.5cm' etc. desde el HTML.
        // Lo pasamos tal cual para que buildCompositePNG aplique EXACT_QR_MAP.
        targetPx,
        logoSrc,
        layoutSpec
      );
      const blob = new Blob([pngBytes], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      imgEl.src = url;
      imgEl.style.imageRendering = 'pixelated';
    } catch (e) {
      // Fallback: mostrar directamente el QR del backend en el <img> (solo el QR sin logo)
      const exactPx = this.EXACT_QR_MAP[targetPx] || this.convertSizeToPixels(targetPx);
      imgEl.src = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${exactPx}&height=${exactPx}`;
      imgEl.style.imageRendering = 'pixelated';
    }
  }

  dataURLToUint8Array(dataURL) {
    const parts = dataURL.split(',');
    const base64 = parts[1] || '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Importante para Odoo: respetar cookies/same-origin (imágenes internas)
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  redirectToServerOverlay() {
    try {
      const current = window.location.pathname;
      const target = current.replace('/overlay_js', '/overlay');
      const finalUrl = `${window.location.origin}${target}${window.location.search}`;
      window.location.href = finalUrl;
    } catch {}
  }

  // ---- Utilidades de demo/compatibilidad (no toques) ----
  createDemoPDF(qrText, qrSize, filename) {
    const content = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 200>>stream
BT /F1 12 Tf 50 700 Td (CERTIFICADO DE DEMOSTRACION) Tj
0 -20 Td (QR Size: ${qrSize}) Tj
0 -20 Td (QR URL: ${qrText}) Tj
0 -20 Td (Filename: ${filename}) Tj
ET endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
0000000010 00000 n
0000000053 00000 n
0000000108 00000 n
0000000331 00000 n
0000000608 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
708
%%EOF`;
    return content;
  }

  downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Inicializar global
window.qrOverlayManager = new QROverlayManager();
window.qrOverlayManager.initialize().catch(() => {});
