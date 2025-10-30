/**
 * QR Overlay Manager - Solución JavaScript para superponer códigos QR en PDFs
 * Utiliza PDF-lib y QRCode.js desde CDNs para evitar dependencias del servidor
 */

class QROverlayManager {
    constructor() {
        this.PDFLib = null;
        this.QRCode = null;
        this.isLoaded = false;
    }

    /**
     * Carga las librerías necesarias desde CDNs
     */
    async loadLibraries() {
        if (this.isLoaded) return;
        
        console.log('🔄 Cargando librerías...');

        try {
            // Intentar cargar desde CDN primero
            try {
                await this.loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
                this.PDFLib = window.PDFLib;
                console.log('✅ PDF-lib cargado desde CDN');
            } catch (e) {
                console.warn('⚠️ No se pudo cargar PDF-lib desde CDN, usando fallback');
                // Fallback: crear una implementación básica para demostración
                this.PDFLib = this.createPDFLibFallback();
            }
            
            try {
                await this.loadScript('https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js');
                this.QRCode = window.QRCode;
                console.log('✅ QRCode.js cargado desde CDN');
            } catch (e) {
                console.warn('⚠️ No se pudo cargar QRCode.js desde CDN, usando fallback');
                // Fallback: crear una implementación básica para demostración
                this.QRCode = this.createQRCodeFallback();
            }

            if (!this.PDFLib || !this.QRCode) {
                throw new Error('No se pudieron cargar las librerías necesarias');
            }

            this.isLoaded = true;
            console.log('✅ Librerías cargadas exitosamente');
        } catch (error) {
            console.error('❌ Error cargando librerías:', error);
            throw error;
        }
    }

    /**
     * Carga un script de forma asíncrona
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
     * Convierte tamaño de cm a puntos PDF
     */
    cmToPoints(cm) {
        const sizeMap = {
            '1.5cm': 42.5,
            '3.5cm': 99.2,
            '5.0cm': 141.7,
            '9.5cm': 269.3
        };
        return sizeMap[cm] || 42.5; // Default 1.5cm
    }

    /**
     * Genera el overlay QR en el PDF
     */
    async generateQROverlay(pdfUrl, qrText, qrSize, filename = 'certificado-qr.pdf') {
        try {
            // Asegurar que las librerías estén cargadas
            if (!this.isLoaded) {
                await this.loadLibraries();
            }

            console.log('Descargando PDF original...');
            // Descargar el PDF original
            const response = await fetch(pdfUrl);
            if (!response.ok) {
                throw new Error(`Error descargando PDF: ${response.status} ${response.statusText}`);
            }
            const pdfBytes = await response.arrayBuffer();

            console.log('Cargando PDF con PDF-lib...');
            // Cargar el PDF con PDF-lib
            const pdfDoc = await this.PDFLib.PDFDocument.load(pdfBytes);
            const pages = pdfDoc.getPages();
            const firstPage = pages[0];
            const { width, height } = firstPage.getSize();

            console.log('Generando código QR...');
            // Generar el código QR como imagen
            const qrDataUrl = await this.QRCode.toDataURL(qrText, {
                width: 200,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });

            // Convertir data URL a bytes
            const qrImageBytes = this.dataURLToBytes(qrDataUrl);
            const qrImage = await pdfDoc.embedPng(qrImageBytes);

            console.log('Calculando posición del QR...');
            // Calcular posición (esquina superior derecha con margen)
            const qrSizePoints = this.cmToPoints(qrSize);
            const margin = 20; // Margen en puntos
            const x = width - qrSizePoints - margin;
            const y = height - qrSizePoints - margin;

            console.log('Agregando QR al PDF...');
            // Agregar el QR al PDF
            firstPage.drawImage(qrImage, {
                x: x,
                y: y,
                width: qrSizePoints,
                height: qrSizePoints,
            });

            console.log('Generando PDF final...');
            // Generar el PDF modificado
            const modifiedPdfBytes = await pdfDoc.save();

            console.log('Iniciando descarga...');
            // Descargar el archivo
            this.downloadFile(modifiedPdfBytes, filename);

            console.log('¡Proceso completado exitosamente!');
            return true;

        } catch (error) {
            console.error('Error en generateQROverlay:', error);
            throw error;
        }
    }

    /**
     * Convierte data URL a bytes
     */
    dataURLToBytes(dataURL) {
        const base64 = dataURL.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Descarga un archivo
     */
    downloadFile(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Fallback para PDF-lib cuando no se puede cargar desde CDN
     */
    createPDFLibFallback() {
        return {
            PDFDocument: {
                load: async () => {
                    throw new Error('PDF-lib no disponible. Esta es una demostración que requiere las librerías reales.');
                }
            }
        };
    }

    /**
     * Fallback para QRCode.js cuando no se puede cargar desde CDN
     */
    createQRCodeFallback() {
        return {
            toDataURL: async (text, options) => {
                // Crear un QR simple usando canvas para demostración
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = options?.width || 200;
                
                canvas.width = size;
                canvas.height = size;
                
                // Fondo blanco
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, size, size);
                
                // Texto de demostración
                ctx.fillStyle = 'black';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('QR DEMO', size/2, size/2 - 10);
                ctx.fillText(text.substring(0, 20), size/2, size/2 + 10);
                
                // Borde
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 2;
                ctx.strokeRect(5, 5, size-10, size-10);
                
                return canvas.toDataURL();
            }
        };
    }
}

// Crear instancia global
window.qrOverlayManager = new QROverlayManager();

// Auto-cargar librerías cuando se carga el script
window.qrOverlayManager.loadLibraries().catch(error => {
    console.error('Error auto-cargando librerías:', error);
});

console.log('QR Overlay Manager inicializado');