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
   * buildCompositePNG(qrText, qrSizeToken, logoSrc, layoutSpec, qualityOptions)
   * - Para 1.5cm usa:
   *   container: 118x233, logo: 56, spacing: 14, qrMarginX: 9, qrSizePx: 100, innerInset: 2
   * - Oversample dinámico (x8-x16) y reducción optimizada => nitidez máxima
   * - innerInset reduce el área "activa" del QR para igualar tamaño de patrones
   * - Canvas optimizado para renderizado de alta calidad
   * - qualityOptions: { useSvg, oversampleFactor, resolutionFactor }
   */
  async buildCompositePNG(qrText, _qrSizeToken, logoSrc, layoutSpec, qualityOptions = {}) {
    // Configuración de calidad por defecto
    const {
      useSvg = true,
      oversampleFactor = 'auto',
      resolutionFactor = 4
    } = qualityOptions;

    // Intentar primero con SVG para máxima calidad si está habilitado
    if (useSvg) {
      try {
        return await this.buildCompositePNGFromSVG(qrText, _qrSizeToken, logoSrc, layoutSpec, qualityOptions);
      } catch (e) {
        console.warn('SVG fallback failed, using PNG method:', e);
      }
    }
    
    return await this.buildCompositePNGFromPNG(qrText, _qrSizeToken, logoSrc, layoutSpec, qualityOptions);
  }

  /**
   * buildCompositePNGFromSVG - Método preferido con calidad vectorial
   */
  async buildCompositePNGFromSVG(qrText, _qrSizeToken, logoSrc, layoutSpec, qualityOptions = {}) {
    const {
      resolutionFactor = 4
    } = qualityOptions;
    
    const useCustom = !!layoutSpec;

    // Layout 1.5 cm EXACTO (coincide con tu QWeb)
    const containerWidth  = useCustom ? (layoutSpec.containerWidth  ?? 118) : 118;
    const containerHeight = useCustom ? (layoutSpec.containerHeight ?? 233) : 233;
    const logoHeight      = useCustom ? (layoutSpec.logoHeight      ?? 56)  : 56;
    const spacing         = useCustom ? (layoutSpec.spacing         ?? 14)  : 14;
    const qrMarginX       = useCustom ? (layoutSpec.qrMarginX       ?? 9)   : 9;
    const qrNominalPx     = useCustom ? (layoutSpec.qrSizePx        ?? 100) : 100;

    // Quiet zone interno para igualar "finder patterns" del QWeb
    const innerInset = useCustom && typeof layoutSpec.innerInset === 'number' ? layoutSpec.innerInset : 2;
    const qrDrawSize = qrNominalPx - innerInset * 2;

    // 1) Obtener SVG del QR desde backend (calidad vectorial perfecta)
    const qrSvgUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${qrDrawSize}&height=${qrDrawSize}&format=svg`;
    const svgResponse = await fetch(qrSvgUrl);
    if (!svgResponse.ok) throw new Error('SVG QR not available');
    
    const svgText = await svgResponse.text();
    
    // 2) Crear canvas con alta resolución para renderizar SVG (factor configurable)
    const highRes = resolutionFactor;
    const canvas = document.createElement('canvas');
    canvas.width = containerWidth * highRes;
    canvas.height = containerHeight * highRes;
    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: false,
      colorSpace: 'srgb',
      willReadFrequently: false
    });
    
    // Configuración para máxima calidad
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(highRes, highRes);
    
    // Fondo blanco sólido
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, containerWidth, containerHeight);

    // 3) Renderizar logo si existe
    if (logoSrc && logoHeight > 0) {
      try {
        const logoImg = await this.loadImage(logoSrc);
        ctx.drawImage(logoImg, 0, 0, containerWidth, logoHeight);
      } catch (e) {
        console.warn('Logo no disponible para componer:', e);
      }
    }

    // 4) Renderizar SVG del QR
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const svgImg = await this.loadImage(svgUrl);
    
    const qrX = qrMarginX + innerInset;
    const qrY = (logoHeight ? logoHeight + spacing : 0) + innerInset;
    ctx.drawImage(svgImg, qrX, qrY, qrDrawSize, qrDrawSize);
    
    URL.revokeObjectURL(svgUrl);

    // 5) Reducir a resolución final manteniendo la calidad
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = containerWidth;
    finalCanvas.height = containerHeight;
    const finalCtx = finalCanvas.getContext('2d', {
      alpha: false,
      desynchronized: false,
      colorSpace: 'srgb',
      willReadFrequently: false
    });
    
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    finalCtx.drawImage(canvas, 0, 0, containerWidth, containerHeight);

    const dataUrl = finalCanvas.toDataURL('image/png');
    return this.dataURLToUint8Array(dataUrl);
  }

  /**
   * buildCompositePNGFromPNG - Método fallback mejorado
   */
  async buildCompositePNGFromPNG(qrText, _qrSizeToken, logoSrc, layoutSpec, qualityOptions = {}) {
    const {
      oversampleFactor = 'auto'
    } = qualityOptions;
    
    const useCustom = !!layoutSpec;

    // Layout 1.5 cm EXACTO (coincide con tu QWeb)
    const containerWidth  = useCustom ? (layoutSpec.containerWidth  ?? 118) : 118;
    const containerHeight = useCustom ? (layoutSpec.containerHeight ?? 233) : 233;
    const logoHeight      = useCustom ? (layoutSpec.logoHeight      ?? 56)  : 56;
    const spacing         = useCustom ? (layoutSpec.spacing         ?? 14)  : 14;
    const qrMarginX       = useCustom ? (layoutSpec.qrMarginX       ?? 9)   : 9;
    const qrNominalPx     = useCustom ? (layoutSpec.qrSizePx        ?? 100) : 100;

    // Quiet zone interno para igualar "finder patterns" del QWeb
    const innerInset = useCustom && typeof layoutSpec.innerInset === 'number' ? layoutSpec.innerInset : 2;
    const qrDrawSize = qrNominalPx - innerInset * 2; // p.ej., 96 si inset=2

    // Oversampling: automático o manual según configuración del usuario
    let oversample;
    if (oversampleFactor === 'auto') {
      // Oversampling dinámico: más agresivo para QRs pequeños
      if (qrDrawSize <= 100) {
        oversample = 16; // Máxima calidad para QRs pequeños (1.5cm)
      } else if (qrDrawSize <= 200) {
        oversample = 12; // Alta calidad para QRs medianos (3.5cm)
      } else if (qrDrawSize <= 400) {
        oversample = 8;  // Buena calidad para QRs grandes (5cm)
      } else {
        oversample = 6;  // Calidad optimizada para QRs muy grandes (9.5cm)
      }
    } else {
      // Usar factor manual especificado por el usuario
      oversample = parseInt(oversampleFactor) || 8;
    }
    
    const fetchW = Math.max(200, qrDrawSize * oversample);
    const fetchH = fetchW;

    // 1) Obtener PNG del QR desde backend con máxima resolución
    const qrUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${fetchW}&height=${fetchH}`;
    const qrBigImg = await this.loadImage(qrUrl);

    // 2) Crear canvas intermedio con configuración optimizada para alta calidad
    const qrCanvas = document.createElement('canvas');
    qrCanvas.width = qrDrawSize;
    qrCanvas.height = qrDrawSize;
    const qctx = qrCanvas.getContext('2d', {
      alpha: false,           // Sin canal alpha para mejor rendimiento
      desynchronized: false,  // Sincronizado para mejor calidad
      colorSpace: 'srgb',     // Espacio de color estándar
      willReadFrequently: false // Optimizado para escritura
    });
    
    // Configuración avanzada del contexto para máxima calidad
    qctx.imageSmoothingEnabled = false;
    qctx.imageSmoothingQuality = 'high';
    qctx.textRenderingOptimization = 'optimizeQuality';
    
    // Fondo blanco sólido para evitar artefactos
    qctx.fillStyle = '#FFFFFF';
    qctx.fillRect(0, 0, qrDrawSize, qrDrawSize);
    
    // Reducir con algoritmo optimizado (nearest neighbor para preservar bordes nítidos)
    qctx.drawImage(qrBigImg, 0, 0, qrDrawSize, qrDrawSize);

    // 3) Componer LOGO + QR en un único PNG con máxima calidad
    const canvas = document.createElement('canvas');
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    const ctx = canvas.getContext('2d', {
      alpha: false,           // Sin canal alpha para mejor rendimiento
      desynchronized: false,  // Sincronizado para mejor calidad
      colorSpace: 'srgb',     // Espacio de color estándar
      willReadFrequently: false // Optimizado para escritura
    });
    
    // Configuración avanzada para composición de alta calidad
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = 'high';
    ctx.textRenderingOptimization = 'optimizeQuality';
    
    // Fondo BLANCO sólido como en QWeb (sin transparencias)
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
   * Vista previa optimizada (usa el MISMO pipeline que el PDF)
   * =======================*/
  async updateQRPreview(imgSelector, qrText, _sizeToken, logoSrc = null, layoutSpec = null, qualityOptions = {}) {
    const element = document.querySelector(imgSelector);
    if (!element) return;

    try {
      const pngBytes = await this.buildCompositePNG(qrText, _sizeToken, logoSrc, layoutSpec, qualityOptions);
      
      if (element.tagName.toLowerCase() === 'canvas') {
        // Si es un canvas, dibujar directamente
        const blob = new Blob([pngBytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        
        img.onload = () => {
          const ctx = element.getContext('2d', {
            alpha: false,
            desynchronized: false,
            colorSpace: 'srgb',
            willReadFrequently: false
          });
          
          // Configurar contexto para máxima calidad y nitidez
          ctx.imageSmoothingEnabled = false;
          ctx.imageSmoothingQuality = 'high';
          ctx.textRenderingOptimization = 'optimizeQuality';
          
          // Asegurar fondo blanco sólido
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, element.width, element.height);
          
          // Dibujar imagen con máxima precisión
          ctx.drawImage(img, 0, 0, element.width, element.height);
          
          // Limpiar URL para evitar memory leaks
          URL.revokeObjectURL(url);
        };
        
        img.src = url;
        
      } else {
        // Si es una imagen, usar el método anterior
        const blob = new Blob([pngBytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        
        // Configurar imagen para máxima nitidez
        element.src = url;
        element.style.imageRendering = 'pixelated';
        element.style.imageRendering = 'crisp-edges';
        element.style.imageRendering = '-moz-crisp-edges';
        element.style.imageRendering = '-webkit-optimize-contrast';
        
        // Limpiar URL anterior para evitar memory leaks
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      
    } catch (e) {
      console.warn('Preview fallback:', e);
      
      if (element.tagName.toLowerCase() === 'canvas') {
         // Fallback para canvas: crear imagen básica
         const fallbackUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=400&height=400`;
         const img = new Image();
         
         img.onload = () => {
           const ctx = element.getContext('2d', {
             alpha: false,
             desynchronized: false,
             colorSpace: 'srgb',
             willReadFrequently: false
           });
           
           ctx.imageSmoothingEnabled = false;
           ctx.imageSmoothingQuality = 'high';
           ctx.textRenderingOptimization = 'optimizeQuality';
           
           // Fondo blanco sólido
           ctx.fillStyle = '#FFFFFF';
           ctx.fillRect(0, 0, element.width, element.height);
           
           // Dibujar imagen fallback
           ctx.drawImage(img, 0, 0, element.width, element.height);
         };
         
         img.src = fallbackUrl;
        
      } else {
        // Fallback mejorado para imagen
        const fallbackUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=400&height=400`;
        element.src = fallbackUrl;
        element.style.imageRendering = 'pixelated';
        element.style.imageRendering = 'crisp-edges';
      }
    }
  }

  /* =========================
   * Generación PDF (overlay JS real) + Fallback servidor
   * =======================*/
  async generateQROverlay(pdfUrl, qrText, qrSizeToken, filename = 'certificado-qr.pdf', logoSrc = null, layoutSpec = null, qualityOptions = {}) {
    try {
      if (!(this.useRealLibraries && this.PDFLib && this.PDFLib.PDFDocument)) {
        this.redirectToServerOverlay();
        return true;
      }

      // 1) Descargar PDF original
      const pdfBytes = await this.downloadPDF(pdfUrl);
      const pdfDoc = await this.PDFLib.PDFDocument.load(pdfBytes);

      // 2) Construir PNG compuesto idéntico al de QWeb con opciones de calidad
      const compositePNG = await this.buildCompositePNG(qrText, qrSizeToken, logoSrc, layoutSpec, qualityOptions);
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
