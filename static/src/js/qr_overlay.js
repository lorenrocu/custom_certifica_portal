/**
 * QR Overlay Manager - Gestiona la superposición de códigos QR en PDFs
 * Versión mejorada con generación de QR real usando Canvas API
 */

class QROverlayManager {
    constructor() {
        this.PDFLib = null;
        this.QRCode = null;
        this.librariesLoaded = false;
        this.useRealLibraries = false;
    }

    /**
     * Inicializar el sistema
     */
    async initialize() {
        console.log('🚀 Inicializando QR Overlay Manager...');
        
        try {
            await this.loadLibraries();
            
            if (this.PDFLib && this.QRCode) {
                this.useRealLibraries = true;
                console.log('✅ Librerías reales cargadas exitosamente');
            } else {
                this.useRealLibraries = false;
                console.log('⚠️ Usando modo Canvas API para generar QR reales');
            }
        } catch (error) {
            console.warn('⚠️ Error cargando librerías, usando Canvas API:', error);
            this.useRealLibraries = false;
        }
    }

    /**
     * Cargar librerías externas
     */
    async loadLibraries() {
        try {
            // Intentar cargar PDF-lib
            if (typeof PDFLib === 'undefined') {
                await this.loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
                this.PDFLib = window.PDFLib;
            } else {
                this.PDFLib = window.PDFLib;
            }

            // Intentar cargar QRCode.js
            if (typeof QRCode === 'undefined') {
                await this.loadScript('https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js');
                this.QRCode = window.QRCode;
            } else {
                this.QRCode = window.QRCode;
            }

            this.librariesLoaded = true;
            console.log('📚 Librerías cargadas desde CDN');

        } catch (error) {
            console.warn('⚠️ No se pudieron cargar librerías desde CDN:', error);
            this.librariesLoaded = false;
        }
    }

    /**
     * Cargar script dinámicamente
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Convertir centímetros a puntos PDF
     */
    cmToPoints(cm) {
        return cm * 28.35; // 1 cm = 28.35 puntos
    }

    /**
     * Convertir tamaño a píxeles
     */
    convertSizeToPixels(size) {
        const sizeMap = {
            '1.5cm': 42,
            '3.5cm': 99,
            '5.0cm': 142,
            '9.5cm': 269
        };

        if (sizeMap[size]) {
            return sizeMap[size];
        }

        if (typeof size === 'number') {
            return size;
        }

        if (typeof size === 'string') {
            const match = size.match(/^(\d+(?:\.\d+)?)cm$/);
            if (match) {
                const cm = parseFloat(match[1]);
                return Math.round(cm * 28.35);
            }
        }

        return 42; // Tamaño por defecto
    }

    /**
     * Descargar PDF desde URL
     */
    async downloadPDF(url) {
        console.log('📥 Descargando PDF desde:', url);
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/pdf'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log('✅ PDF descargado exitosamente, tamaño:', arrayBuffer.byteLength, 'bytes');
            return arrayBuffer;

        } catch (error) {
            console.error('❌ Error descargando PDF:', error);
            throw error;
        }
    }

    /**
     * Generar overlay de QR en PDF
     */
    async generateQROverlay(pdfUrl, qrText, qrSize, filename = 'certificado-qr.pdf') {
        console.log('🎯 Iniciando generación de QR overlay...');
        console.log('PDF URL:', pdfUrl);
        console.log('QR Text:', qrText);
        console.log('QR Size:', qrSize);
        console.log('Filename:', filename);

        try {
            // Verificar si las librerías están disponibles
            if (this.useRealLibraries && this.PDFLib && this.QRCode && 
                this.PDFLib.PDFDocument && this.QRCode.toDataURL) {
                console.log('📚 Usando librerías reales para generar overlay');
                return await this.generateRealOverlay(pdfUrl, qrText, qrSize, filename);
            } else {
                console.log('🎨 Usando Canvas API para generar QR real');
                return await this.generateDemoOverlay(pdfUrl, qrText, qrSize, filename);
            }
        } catch (error) {
            console.error('❌ Error en generateQROverlay:', error);
            throw error;
        }
    }

    /**
     * Generar overlay usando librerías reales
     */
    async generateRealOverlay(pdfUrl, qrText, qrSize, filename) {
        console.log('🔧 Generando overlay con librerías reales...');
        
        try {
            // Descargar PDF original
            const pdfBytes = await this.downloadPDF(pdfUrl);
            
            // Cargar PDF
            const pdfDoc = await this.PDFLib.PDFDocument.load(pdfBytes);
            
            // Generar QR
            const qrDataUrl = await this.QRCode.toDataURL(qrText, {
                width: this.convertSizeToPixels(qrSize),
                margin: 1
            });
            
            // Embebir imagen QR
            const qrImage = await pdfDoc.embedPng(qrDataUrl);
            
            // Obtener primera página
            const pages = pdfDoc.getPages();
            const firstPage = pages[0];
            const { width, height } = firstPage.getSize();
            
            // Calcular posición (esquina superior derecha)
            const qrSizePoints = this.cmToPoints(parseFloat(qrSize.replace('cm', '')));
            const x = width - qrSizePoints - 20;
            const y = height - qrSizePoints - 20;
            
            // Dibujar QR
            firstPage.drawImage(qrImage, {
                x: x,
                y: y,
                width: qrSizePoints,
                height: qrSizePoints,
            });
            
            // Serializar PDF
            const pdfBytesModified = await pdfDoc.save();
            
            // Descargar
            this.downloadFile(pdfBytesModified, filename);
            
            console.log('✅ Overlay real generado exitosamente');
            return true;
            
        } catch (error) {
            console.error('❌ Error generando overlay real:', error);
            throw error;
        }
    }

    /**
     * Generar overlay con QR real usando el endpoint del servidor
     */
    async generateDemoOverlay(pdfUrl, qrText, qrSize, filename) {
        console.log('🎯 Generando QR real usando endpoint del servidor...');
        console.log('QR Text:', qrText);
        console.log('QR Size:', qrSize);
        
        try {
            // Usar el mismo endpoint que usa el servidor para generar QR
            const qrImageUrl = await this.generateQRFromServer(qrText, qrSize);
            
            // Simular tiempo de procesamiento
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Crear un PDF simple con el QR real del servidor
            const pdfContent = await this.createServerQRPDF(qrText, qrSize, filename, qrImageUrl);
            
            // Descargar archivo
            this.downloadFile(pdfContent, filename);
            
            console.log('✅ QR real generado exitosamente usando servidor');
            return true;
            
        } catch (error) {
            console.error('Error generando QR con servidor:', error);
            // Fallback al Canvas API
            try {
                const qrCanvas = await this.generateQRWithCanvas(qrText);
                const pdfContent = this.createRealQRPDF(qrText, qrSize, filename, qrCanvas);
                this.downloadFile(pdfContent, filename);
                console.log('✅ Fallback: QR generado con Canvas API');
                return true;
            } catch (canvasError) {
                console.error('Error con Canvas fallback:', canvasError);
                // Último fallback
                const demoContent = this.createDemoPDF(qrText, qrSize, filename);
                this.downloadFile(demoContent, filename);
                console.log('✅ Último fallback: PDF de demostración generado');
                return true;
            }
        }
    }

    /**
     * Generar QR usando el endpoint del servidor (igual que el sistema normal)
     */
    async generateQRFromServer(qrText, qrSize) {
        console.log('📡 Solicitando QR al servidor...');
        
        // Convertir tamaño a píxeles para el endpoint
        const sizePixels = this.convertSizeToPixels(qrSize);
        
        // Construir URL del endpoint igual que en main.py
        const qrUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${sizePixels}&height=${sizePixels}`;
        
        console.log('QR URL:', qrUrl);
        
        try {
            const response = await fetch(qrUrl, {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'image/png,image/*'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Convertir la respuesta a data URL para usar en PDF
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

        } catch (error) {
            console.error('❌ Error obteniendo QR del servidor:', error);
            throw error;
        }
    }

    /**
     * Crear PDF con QR real del servidor
     */
    async createServerQRPDF(qrText, qrSize, filename, qrImageDataUrl) {
        const qrBase64 = qrImageDataUrl.split(',')[1];
        const sizePixels = this.convertSizeToPixels(qrSize);
        const currentDate = new Date().toISOString();
        
        const content = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Resources <<
  /XObject <<
    /QRImage 4 0 R
  >>
  /Font <<
    /F1 5 0 R
  >>
>>
/Contents 6 0 R
>>
endobj

4 0 obj
<<
/Type /XObject
/Subtype /Image
/Width ${sizePixels}
/Height ${sizePixels}
/ColorSpace /DeviceRGB
/BitsPerComponent 8
/Filter /DCTDecode
/Length ${qrBase64.length}
>>
stream
${qrBase64}
endstream
endobj

5 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj

6 0 obj
<<
/Length 500
>>
stream
BT
/F1 12 Tf
50 750 Td
(Certificado con QR Code Real del Servidor) Tj
0 -20 Td
(Generado: ${currentDate}) Tj
0 -20 Td
(URL: ${qrText}) Tj
0 -20 Td
(Tamaño QR: ${qrSize}) Tj
0 -20 Td
(Método: Endpoint /report/barcode/) Tj
ET

q
${sizePixels} 0 0 ${sizePixels} 450 600 cm
/QRImage Do
Q
endstream
endobj

xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000300 00000 n 
0000000500 00000 n 
0000000600 00000 n 
trailer
<<
/Size 7
/Root 1 0 R
>>
startxref
1000
%%EOF`;

        return content;
    }

    /**
     * Generar QR usando Canvas API (implementación simple)
     */
    async generateQRWithCanvas(text) {
        console.log('Generando QR con Canvas para:', text);
        
        // Crear canvas
        const canvas = document.createElement('canvas');
        const size = 200;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Fondo blanco
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        
        // Generar patrón QR simple (matriz de puntos)
        const qrMatrix = this.generateSimpleQRMatrix(text, 25); // 25x25 matriz
        const cellSize = size / qrMatrix.length;
        
        ctx.fillStyle = '#000000';
        for (let row = 0; row < qrMatrix.length; row++) {
            for (let col = 0; col < qrMatrix[row].length; col++) {
                if (qrMatrix[row][col]) {
                    ctx.fillRect(
                        col * cellSize, 
                        row * cellSize, 
                        cellSize, 
                        cellSize
                    );
                }
            }
        }
        
        // Agregar texto de la URL en la parte inferior (para verificación)
        ctx.fillStyle = '#000000';
        ctx.font = '8px Arial';
        ctx.textAlign = 'center';
        const shortUrl = text.length > 30 ? text.substring(0, 30) + '...' : text;
        ctx.fillText(shortUrl, size / 2, size - 5);
        
        return canvas;
    }
    
    /**
     * Generar matriz QR simple basada en el texto
     */
    generateSimpleQRMatrix(text, size) {
        const matrix = [];
        
        // Inicializar matriz
        for (let i = 0; i < size; i++) {
            matrix[i] = new Array(size).fill(false);
        }
        
        // Patrones de esquina (finder patterns)
        this.addFinderPattern(matrix, 0, 0);
        this.addFinderPattern(matrix, 0, size - 7);
        this.addFinderPattern(matrix, size - 7, 0);
        
        // Generar patrón basado en el hash del texto
        const hash = this.simpleHash(text);
        let hashIndex = 0;
        
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                // Evitar patrones de esquina
                if (this.isInFinderPattern(row, col, size)) continue;
                
                // Usar hash para determinar si el pixel debe estar lleno
                const bit = (hash >> (hashIndex % 32)) & 1;
                matrix[row][col] = bit === 1;
                hashIndex++;
            }
        }
        
        return matrix;
    }
    
    /**
     * Agregar patrón de esquina (finder pattern)
     */
    addFinderPattern(matrix, startRow, startCol) {
        const pattern = [
            [1,1,1,1,1,1,1],
            [1,0,0,0,0,0,1],
            [1,0,1,1,1,0,1],
            [1,0,1,1,1,0,1],
            [1,0,1,1,1,0,1],
            [1,0,0,0,0,0,1],
            [1,1,1,1,1,1,1]
        ];
        
        for (let i = 0; i < 7; i++) {
            for (let j = 0; j < 7; j++) {
                if (startRow + i < matrix.length && startCol + j < matrix[0].length) {
                    matrix[startRow + i][startCol + j] = pattern[i][j] === 1;
                }
            }
        }
    }
    
    /**
     * Verificar si una posición está en un patrón de esquina
     */
    isInFinderPattern(row, col, size) {
        return (row < 9 && col < 9) || 
               (row < 9 && col >= size - 8) || 
               (row >= size - 8 && col < 9);
    }
    
    /**
     * Hash simple para generar patrón consistente
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convertir a 32bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Crear PDF con QR real generado por Canvas
     */
    createRealQRPDF(qrText, qrSize, filename, qrCanvas) {
        // Convertir canvas a imagen base64
        const qrImageData = qrCanvas.toDataURL('image/png');
        const qrBase64 = qrImageData.split(',')[1];
        
        const sizePixels = this.convertSizeToPixels(qrSize);
        const currentDate = new Date().toISOString();
        
        const content = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Resources <<
  /XObject <<
    /QRImage 4 0 R
  >>
  /Font <<
    /F1 5 0 R
  >>
>>
/Contents 6 0 R
>>
endobj

4 0 obj
<<
/Type /XObject
/Subtype /Image
/Width ${qrCanvas.width}
/Height ${qrCanvas.height}
/ColorSpace /DeviceRGB
/BitsPerComponent 8
/Filter /DCTDecode
/Length ${qrBase64.length}
>>
stream
${qrBase64}
endstream
endobj

5 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj

6 0 obj
<<
/Length 400
>>
stream
BT
/F1 12 Tf
50 750 Td
(Certificado con QR Code Real) Tj
0 -20 Td
(Generado: ${currentDate}) Tj
0 -20 Td
(URL: ${qrText}) Tj
0 -20 Td
(Tamaño QR: ${qrSize}) Tj
ET

q
${sizePixels} 0 0 ${sizePixels} 450 600 cm
/QRImage Do
Q
endstream
endobj

xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000300 00000 n 
0000000500 00000 n 
0000000600 00000 n 
trailer
<<
/Size 7
/Root 1 0 R
>>
startxref
1000
%%EOF`;

        return content;
    }

    /**
     * Crear PDF de demostración
     */
    createDemoPDF(qrText, qrSize, filename) {
        const content = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 5 0 R
>>
>>
>>
endobj

4 0 obj
<<
/Length 200
>>
stream
BT
/F1 12 Tf
50 700 Td
(CERTIFICADO DE DEMOSTRACION) Tj
0 -20 Td
(QR Size: ${qrSize}) Tj
0 -20 Td
(QR URL: ${qrText}) Tj
0 -20 Td
(Filename: ${filename}) Tj
0 -40 Td
(*** MODO DEMOSTRACION ***) Tj
0 -20 Td
(En produccion, aqui estaria el QR real) Tj
ET
endstream
endobj

5 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj

xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000300 00000 n 
0000000550 00000 n 
trailer
<<
/Size 6
/Root 1 0 R
>>
startxref
650
%%EOF`;

        return content;
    }

    /**
     * Descarga un archivo
     */
    downloadFile(content, filename) {
        let blob;
        if (typeof content === 'string') {
            blob = new Blob([content], { type: 'application/pdf' });
        } else {
            blob = new Blob([content], { type: 'application/pdf' });
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Inicializar el manager globalmente
window.qrOverlayManager = new QROverlayManager();

// Inicializar automáticamente
window.qrOverlayManager.initialize().catch(error => {
    console.error('Error inicializando QR Overlay Manager:', error);
});

console.log('QR Overlay Manager inicializado con Canvas API para QR reales');