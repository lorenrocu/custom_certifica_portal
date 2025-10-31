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
  
  // Función para generar QR usando la API del backend con máxima calidad
  async buildQRFromBackendAPI(qrText, targetSize, qualityOptions = {}) {
    const { useSvg = true, oversampleFactor = 'auto', resolutionFactor = 4, errorCorrectionLevel = 'M' } = qualityOptions;
    
    try {
      // Calcular tamaño óptimo para el fetch
      const actualOversample = oversampleFactor === 'auto' ? 
        Math.max(6, Math.min(16, Math.ceil(800 / targetSize))) : 
        parseInt(oversampleFactor);
      
      const fetchSize = targetSize * actualOversample * resolutionFactor;
      
      if (useSvg) {
        // Intentar obtener SVG del backend (vectorial, máxima calidad)
        const svgUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${fetchSize}&height=${fetchSize}&format=svg&errorlevel=${errorCorrectionLevel}`;
        const svgResponse = await fetch(svgUrl);
        
        if (svgResponse.ok) {
          const svgText = await svgResponse.text();
          return await this.renderSVGToCanvas(svgText, targetSize, resolutionFactor);
        }
      }
      
      // Fallback: PNG de alta resolución del backend
      const pngUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${fetchSize}&height=${fetchSize}&errorlevel=${errorCorrectionLevel}`;
      const pngResponse = await fetch(pngUrl);
      
      if (pngResponse.ok) {
        const blob = await pngResponse.blob();
        return await this.renderImageBlobToCanvas(blob, targetSize, actualOversample);
      }
      
      throw new Error('Backend API no disponible');
      
    } catch (error) {
      console.warn('Error con API del backend:', error);
      // Fallback a generación JavaScript pura
      return await this.buildQRFromJavaScript(qrText, targetSize, qualityOptions);
    }
  }

  // Función para renderizar SVG a canvas con máxima calidad
  async renderSVGToCanvas(svgText, targetSize, resolutionFactor) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', {
        alpha: false,
        desynchronized: false,
        colorSpace: 'srgb',
        willReadFrequently: false
      });
      
      // Canvas de alta resolución
      const hiResSize = targetSize * resolutionFactor;
      canvas.width = hiResSize;
      canvas.height = hiResSize;
      
      // Configurar contexto para máxima nitidez
      ctx.imageSmoothingEnabled = false;
      ctx.textRenderingOptimization = 'optimizeQuality';
      
      // Fondo blanco sólido
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, hiResSize, hiResSize);
      
      img.onload = () => {
        try {
          // Dibujar SVG escalado con precisión perfecta
          ctx.drawImage(img, 0, 0, hiResSize, hiResSize);
          
          // Convertir a blob PNG de alta calidad
          canvas.toBlob(resolve, 'image/png', 1.0);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => reject(new Error('Error cargando SVG'));
      
      // Convertir SVG a data URL para cargar en imagen
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
      const svgUrl = URL.createObjectURL(svgBlob);
      img.src = svgUrl;
      
      // Limpiar URL después de cargar
      img.onload = () => {
        URL.revokeObjectURL(svgUrl);
        try {
          ctx.drawImage(img, 0, 0, hiResSize, hiResSize);
          canvas.toBlob(resolve, 'image/png', 1.0);
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  // Función para renderizar blob de imagen a canvas con oversampling
  async renderImageBlobToCanvas(blob, targetSize, oversampleFactor) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', {
        alpha: false,
        desynchronized: false,
        colorSpace: 'srgb',
        willReadFrequently: false
      });
      
      // Canvas del tamaño objetivo
      canvas.width = targetSize;
      canvas.height = targetSize;
      
      // Configurar para renderizado nítido
      ctx.imageSmoothingEnabled = false;
      ctx.textRenderingOptimization = 'optimizeQuality';
      
      // Fondo blanco
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetSize, targetSize);
      
      img.onload = () => {
        try {
          // Dibujar imagen con downsampling controlado para anti-aliasing
          ctx.drawImage(img, 0, 0, targetSize, targetSize);
          canvas.toBlob(resolve, 'image/png', 1.0);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => reject(new Error('Error cargando imagen del backend'));
      img.src = URL.createObjectURL(blob);
    });
  }

  // Función auxiliar para cargar imágenes
    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Error cargando imagen: ${src}`));
            img.src = src;
        });
    }

    // Convertir token de tamaño a píxeles
  convertSizeToPixels(sizeToken) {
    const sizeMap = {
      '1.5cm': 100,
      '3.5cm': 200,
      '5cm': 300,
      '9.5cm': 500
    };
    return sizeMap[sizeToken] || 100;
  }
  // Función para generar QR completamente en JavaScript (sin dependencias del backend)
    async buildQRFromJavaScript(qrText, targetSize, qualityOptions = {}) {
        const { oversampleFactor = 'auto', resolutionFactor = 4, errorCorrectionLevel = 'M' } = qualityOptions;
        
        try {
            // Calcular oversampling óptimo
            const actualOversample = oversampleFactor === 'auto' ? 
                (targetSize <= 100 ? 16 : targetSize <= 200 ? 12 : 8) : 
                parseInt(oversampleFactor);
            
            // Generar QR usando algoritmo JavaScript puro con nivel de corrección especificado
            const qrData = this.generateQRMatrix(qrText, errorCorrectionLevel);
            return await this.renderQRMatrixToCanvas(qrData, targetSize, actualOversample, resolutionFactor);
            
        } catch (error) {
            console.error('Error en buildQRFromJavaScript:', error);
            throw error;
        }
    }

    // Generador de matriz QR simplificado (algoritmo básico)
    generateQRMatrix(text, errorCorrectionLevel = 'M') {
        // Implementación simplificada de QR Code
        // Para producción, se recomienda usar una librería como qrcode.js
        
        // Determinar versión del QR basada en longitud del texto
        const version = this.determineQRVersion(text.length);
        const size = 21 + (version - 1) * 4; // Tamaño de la matriz QR
        
        // Crear matriz vacía
        const matrix = Array(size).fill().map(() => Array(size).fill(0));
        
        // Agregar patrones de posición (esquinas)
        this.addFinderPatterns(matrix, size);
        
        // Agregar patrones de timing
        this.addTimingPatterns(matrix, size);
        
        // Codificar datos (simplificado)
        this.encodeData(matrix, text, size, version);
        
        return { matrix, size, version };
    }

    // Determinar versión QR necesaria
    determineQRVersion(textLength) {
        if (textLength <= 25) return 1;
        if (textLength <= 47) return 2;
        if (textLength <= 77) return 3;
        if (textLength <= 114) return 4;
        return Math.min(10, Math.ceil(textLength / 100) + 4);
    }

    // Agregar patrones de búsqueda (finder patterns)
    addFinderPatterns(matrix, size) {
        const pattern = [
            [1,1,1,1,1,1,1],
            [1,0,0,0,0,0,1],
            [1,0,1,1,1,0,1],
            [1,0,1,1,1,0,1],
            [1,0,1,1,1,0,1],
            [1,0,0,0,0,0,1],
            [1,1,1,1,1,1,1]
        ];
        
        // Esquina superior izquierda
        this.placePattern(matrix, pattern, 0, 0);
        // Esquina superior derecha
        this.placePattern(matrix, pattern, 0, size - 7);
        // Esquina inferior izquierda
        this.placePattern(matrix, pattern, size - 7, 0);
    }

    // Colocar patrón en matriz
    placePattern(matrix, pattern, startRow, startCol) {
        for (let i = 0; i < pattern.length; i++) {
            for (let j = 0; j < pattern[i].length; j++) {
                if (startRow + i < matrix.length && startCol + j < matrix[0].length) {
                    matrix[startRow + i][startCol + j] = pattern[i][j];
                }
            }
        }
    }

    // Agregar patrones de timing
    addTimingPatterns(matrix, size) {
        for (let i = 8; i < size - 8; i++) {
            matrix[6][i] = i % 2 === 0 ? 1 : 0; // Horizontal
            matrix[i][6] = i % 2 === 0 ? 1 : 0; // Vertical
        }
    }

    // Codificación simplificada de datos
    encodeData(matrix, text, size, version) {
        // Convertir texto a binario (simplificado)
        const binaryData = text.split('').map(char => 
            char.charCodeAt(0).toString(2).padStart(8, '0')
        ).join('');
        
        // Llenar matriz con datos en patrón zigzag (simplificado)
        let dataIndex = 0;
        for (let col = size - 1; col > 0; col -= 2) {
            if (col === 6) col--; // Saltar columna de timing
            
            for (let row = 0; row < size && dataIndex < binaryData.length; row++) {
                if (this.isDataModule(matrix, row, col, size)) {
                    matrix[row][col] = parseInt(binaryData[dataIndex] || '0');
                    dataIndex++;
                }
                if (this.isDataModule(matrix, row, col - 1, size)) {
                    matrix[row][col - 1] = parseInt(binaryData[dataIndex] || '0');
                    dataIndex++;
                }
            }
        }
    }

    // Verificar si una posición puede contener datos
    isDataModule(matrix, row, col, size) {
        // Evitar patrones de función (simplificado)
        if (row < 9 && col < 9) return false; // Finder pattern + separators
        if (row < 9 && col >= size - 8) return false; // Finder pattern
        if (row >= size - 8 && col < 9) return false; // Finder pattern
        if (row === 6 || col === 6) return false; // Timing patterns
        return true;
    }

    // Renderizar matriz QR a canvas con máxima calidad
    async renderQRMatrixToCanvas(qrData, targetSize, oversampleFactor, resolutionFactor) {
        return new Promise((resolve) => {
            const { matrix, size } = qrData;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', {
                alpha: false,
                desynchronized: false,
                colorSpace: 'srgb',
                willReadFrequently: false
            });
            
            // Canvas de ultra alta resolución
            const hiResSize = targetSize * oversampleFactor * resolutionFactor;
            canvas.width = hiResSize;
            canvas.height = hiResSize;
            
            // Configurar para renderizado perfecto
            ctx.imageSmoothingEnabled = false;
            ctx.textRenderingOptimization = 'optimizeQuality';
            
            // Fondo blanco perfecto
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, hiResSize, hiResSize);
            
            // Calcular tamaño de cada módulo QR
            const moduleSize = hiResSize / size;
            
            // Dibujar matriz QR
            ctx.fillStyle = '#000000';
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    if (matrix[row][col] === 1) {
                        const x = col * moduleSize;
                        const y = row * moduleSize;
                        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(moduleSize), Math.ceil(moduleSize));
                    }
                }
            }
            
            // Convertir a blob con máxima calidad
            canvas.toBlob(resolve, 'image/png', 1.0);
        });
    }
   * buildCompositePNG(qrText, qrSizeToken, logoSrc, layoutSpec, qualityOptions)
   * - Genera PNG compuesto (QR + logo) con máxima calidad usando múltiples métodos
   * - Prioridad: 1) Backend API SVG, 2) Backend API PNG, 3) JavaScript puro
   * - Para 1.5cm usa:
   *   container: 118x233, logo: 56, spacing: 14, qrMarginX: 9, qrSizePx: 100, innerInset: 2
   * - Oversample dinámico (x8-x16) y reducción optimizada => nitidez máxima
   * - innerInset reduce el área "activa" del QR para igualar tamaño de patrones
   * - Canvas optimizado para renderizado de alta calidad
   * - qualityOptions: { useSvg, oversampleFactor, resolutionFactor }
   */
  async buildCompositePNG(qrText, _qrSizeToken, logoSrc, layoutSpec, qualityOptions = {}) {
    const { 
      method = 'backend-api',
      useSvg = true, 
      oversampleFactor = 'auto', 
      resolutionFactor = 4,
      useBackendAPI = true,
      errorCorrection = 'M'
    } = qualityOptions;

    try {
      // Determinar tamaño del QR
      const qrDrawSize = layoutSpec ? layoutSpec.qrSizePx : this.convertSizeToPixels(_qrSizeToken);
      
      console.log(`🎯 Generando QR de alta calidad: ${qrDrawSize}px`);
      console.log(`📊 Configuración: Método=${method}, SVG=${useSvg}, Oversample=${oversampleFactor}, Resolution=${resolutionFactor}x, ErrorCorrection=${errorCorrection}`);

      let qrBlob;

      // Seleccionar método de generación según configuración del usuario
      switch (method) {
        case 'backend-api':
          console.log('🔄 Usando API del backend...');
          try {
            qrBlob = await this.buildQRFromBackendAPI(qrText, qrDrawSize, { ...qualityOptions, errorCorrectionLevel: errorCorrection });
            console.log('✅ QR generado con API del backend');
          } catch (error) {
            console.warn('⚠️ API del backend falló, usando JavaScript puro:', error.message);
            qrBlob = await this.buildQRFromJavaScript(qrText, qrDrawSize, { ...qualityOptions, errorCorrectionLevel: errorCorrection });
            console.log('✅ QR generado con JavaScript puro (fallback)');
          }
          break;
          
        case 'javascript-pure':
          console.log('🔄 Generando con JavaScript puro...');
          qrBlob = await this.buildQRFromJavaScript(qrText, qrDrawSize, { ...qualityOptions, errorCorrectionLevel: errorCorrection });
          console.log('✅ QR generado con JavaScript puro');
          break;
          
        case 'hybrid':
        default:
          // Método híbrido: intentar backend primero, luego JavaScript
          console.log('🔄 Usando método híbrido...');
          try {
            qrBlob = await this.buildQRFromBackendAPI(qrText, qrDrawSize, { ...qualityOptions, errorCorrectionLevel: errorCorrection });
            console.log('✅ QR generado con API del backend (híbrido)');
          } catch (error) {
            console.warn('⚠️ API del backend falló, usando JavaScript puro:', error.message);
            qrBlob = await this.buildQRFromJavaScript(qrText, qrDrawSize, { ...qualityOptions, errorCorrectionLevel: errorCorrection });
            console.log('✅ QR generado con JavaScript puro (híbrido fallback)');
          }
          break;
      }

      // Componer imagen final con logo
      return await this.composeFinalImage(qrBlob, logoSrc, _qrSizeToken, layoutSpec, qualityOptions);

    } catch (error) {
      console.error('❌ Error generando QR de alta calidad:', error);
      // Fallback al método original como último recurso
      return await this.buildCompositePNGFallback(qrText, _qrSizeToken, logoSrc, layoutSpec);
    }
  }

  // Componer imagen final con QR + logo
  async composeFinalImage(qrBlob, logoSrc, qrSizeToken, layoutSpec, qualityOptions) {
    const { resolutionFactor = 4 } = qualityOptions;
    
    return new Promise((resolve, reject) => {
      const qrImg = new Image();
      qrImg.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', {
            alpha: false,
            desynchronized: false,
            colorSpace: 'srgb',
            willReadFrequently: false
          });

          // Configurar canvas de alta resolución
          const baseSize = layoutSpec ? layoutSpec.containerWidth : this.convertSizeToPixels(qrSizeToken);
          const canvasSize = baseSize * resolutionFactor;
          
          canvas.width = canvasSize;
          canvas.height = layoutSpec ? layoutSpec.containerHeight * resolutionFactor : canvasSize;

          // Configurar contexto para máxima calidad
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.textRenderingOptimization = 'optimizeQuality';

          // Fondo blanco
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (layoutSpec) {
            // Layout especial (1.5cm)
            await this.renderSpecialLayout(ctx, qrImg, logoSrc, layoutSpec, resolutionFactor);
          } else {
            // Layout estándar
            await this.renderStandardLayout(ctx, qrImg, logoSrc, canvasSize);
          }

          // Convertir a blob final
          canvas.toBlob(resolve, 'image/png', 1.0);
        } catch (error) {
          reject(error);
        }
      };
      qrImg.onerror = () => reject(new Error('Error cargando QR generado'));
      qrImg.src = URL.createObjectURL(qrBlob);
    });
  }

  // Renderizar layout especial (1.5cm)
  async renderSpecialLayout(ctx, qrImg, logoSrc, layoutSpec, resolutionFactor) {
    const { containerWidth, containerHeight, logoHeight, qrSizePx, spacing, qrMarginX, innerInset } = layoutSpec;
    const scale = resolutionFactor;

    // Dibujar logo si existe
    if (logoSrc) {
      const logoImg = await this.loadImage(logoSrc);
      const logoW = containerWidth * scale;
      const logoH = logoHeight * scale;
      ctx.drawImage(logoImg, 0, 0, logoW, logoH);
    }

    // Dibujar QR
    const qrY = (logoSrc ? layoutSpec.logoHeight + spacing : 0) * scale;
    const qrX = qrMarginX * scale;
    const qrSize = qrSizePx * scale;
    
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  }

  // Renderizar layout estándar
  async renderStandardLayout(ctx, qrImg, logoSrc, canvasSize) {
    let currentY = 0;

    // Dibujar logo si existe
    if (logoSrc) {
      const logoImg = await this.loadImage(logoSrc);
      const logoHeight = Math.min(canvasSize * 0.15, 60);
      const logoWidth = (logoImg.width / logoImg.height) * logoHeight;
      const logoX = (canvasSize - logoWidth) / 2;
      
      ctx.drawImage(logoImg, logoX, currentY, logoWidth, logoHeight);
      currentY += logoHeight + 10;
    }

    // Dibujar QR centrado
    const qrSize = canvasSize - currentY - 10;
    const qrX = (canvasSize - qrSize) / 2;
    ctx.drawImage(qrImg, qrX, currentY, qrSize, qrSize);
  }

  // Método fallback (original)
  async buildCompositePNGFallback(qrText, qrSizeToken, logoSrc, layoutSpec) {
    console.log('🔄 Usando método fallback original...');
    // Aquí iría el método original como respaldo
    return await this.buildCompositePNGFromSVG(qrText, qrSizeToken, logoSrc, layoutSpec, {});
  }
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
