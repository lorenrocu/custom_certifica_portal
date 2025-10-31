/**
 * QR Overlay Manager - Gestiona la superposición de códigos QR en PDFs
 * Versión calibrada para replicar EXACTAMENTE el QWeb 1.5 (logo 30px, gap 5px, QR 100×100)
 */

class QROverlayManager {
    constructor() {
        this.PDFLib = null;
        this.QRCode = null;
        this.librariesLoaded = false;
        this.useRealLibraries = false;
    }

    // =========================
    // Unidades / Helpers
    // =========================
    // 1 pt = 1/72 in, 1 px ≈ 1/96 in → px * 0.75 = pt
    static CSS_DPI = 96;
    static PX_TO_PT = 72 / QROverlayManager.CSS_DPI; // 0.75
    pxToPt(px) { return px * QROverlayManager.PX_TO_PT; }

    cmToPoints(cm) {
        return cm * 28.35; // 1 cm = 28.35 pt
    }

    // =========================
    // Init & carga de librerías
    // =========================
    async initialize() {
        console.log('🚀 Inicializando QR Overlay Manager...');
        try {
            await this.loadLibraries();
            if (this.PDFLib) {
                this.useRealLibraries = true;
                console.log('✅ PDFLib disponible. Se usará PNG del backend (/report/barcode)');
            } else {
                this.useRealLibraries = false;
                console.log('⚠️ Librerías no disponibles. Fallback al servidor (/overlay)');
            }
        } catch (error) {
            console.warn('⚠️ Error cargando librerías. Fallback al servidor (/overlay):', error);
            this.useRealLibraries = false;
        }
    }

    async loadLibraries() {
        try {
            if (typeof PDFLib === 'undefined') {
                await this.loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
                this.PDFLib = window.PDFLib;
            } else {
                this.PDFLib = window.PDFLib;
            }

            // QRCode no es imprescindible (pedimos PNG al backend)
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

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    // =========================
    // Tamaños
    // =========================
    convertSizeToPixels(size) {
        // Mapeo calibrado (idéntico al “tamaño que ya tenían”)
        const sizeMap = {
            '1.5cm': 100,
            '3.5cm': 234,
            '5.0cm': 333,
            '9.5cm': 587
        };
        if (sizeMap[size]) return sizeMap[size];

        if (typeof size === 'number') return size;

        if (typeof size === 'string') {
            const m = size.match(/^(\d+(?:\.\d+)?)cm$/);
            if (m) {
                const cm = parseFloat(m[1]);
                // px ≈ cm * 28.35(pt) / 0.75(pt/px) → cm * 37.8 px
                return Math.round(cm * 37.8);
            }
        }
        return 42;
    }

    // =========================
    // Networking
    // =========================
    async downloadPDF(url) {
        console.log('📥 Descargando PDF desde:', url);
        const resp = await fetch(url, { method: 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/pdf' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const buf = await resp.arrayBuffer();
        console.log('✅ PDF descargado. Bytes:', buf.byteLength);
        return buf;
    }

    // =========================
    // API principal
    // =========================
    async generateQROverlay(pdfUrl, qrText, qrSize, filename = 'certificado-qr.pdf', logoSrc = null, layoutSpec = null) {
        console.log('🎯 Generando overlay QR…', { pdfUrl, qrText, qrSize, filename });
        try {
            if (this.useRealLibraries && this.PDFLib?.PDFDocument) {
                return await this.generateRealOverlay(pdfUrl, qrText, qrSize, filename, logoSrc, layoutSpec);
            }
            console.log('↪️ Fallback al servidor: /overlay');
            this.redirectToServerOverlay();
            return true;
        } catch (error) {
            console.error('❌ Error en generateQROverlay:', error);
            const demo = this.createDemoPDF(qrText, qrSize, filename);
            this.downloadFile(demo, filename);
            return true;
        }
    }

    // =========================
    // Overlay REAL (PDFLib + PNG backend)
    // =========================
    async generateRealOverlay(pdfUrl, qrText, qrSize, filename, logoSrc, layoutSpec = null) {
        console.log('🔧 Overlay REAL (PDFLib + PNG backend)…');

        // 1) Cargar PDF original
        const pdfBytes = await this.downloadPDF(pdfUrl);
        const pdfDoc = await this.PDFLib.PDFDocument.load(pdfBytes);

        // 2) ¿Es 1.5cm? (calcar QWeb exacto)
        const is15 = (typeof qrSize === 'string' && qrSize.startsWith('1.5')) ||
                     (layoutSpec && Number(layoutSpec.qrSizePx) === 100);

        // Tamaño interno del QR en px
        const qrPx = is15 ? 100 : this.convertSizeToPixels(qrSize);

        // 3) Descargar imagen del QR desde backend
        const fetchW  = is15 ? 100 : Math.max(100, Math.round(qrPx * 4));
        const fetchH  = is15 ? 100 : Math.max(100, Math.round(qrPx * 4));
        const qrUrl   = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${fetchW}&height=${fetchH}`;
        const qrResp  = await fetch(qrUrl, { credentials: 'same-origin' });
        if (!qrResp.ok) throw new Error(`No se pudo obtener QR: HTTP ${qrResp.status}`);
        const qrBlob  = await qrResp.blob();
        const qrObj   = URL.createObjectURL(qrBlob);
        const qrImg   = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = qrObj; });

        // 4) Logo (opcional)
        let logoImg = null;
        if (logoSrc) {
            try {
                logoImg = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = logoSrc; });
            } catch { logoImg = null; }
        }

        // 5) Layout exacto para 1.5cm (QWeb):
        //    - logo 30px alto (max-height)
        //    - gap 5px
        //    - QR 100×100
        //    - ancho contenedor = max(logo_w, 100)
        //    Para otros tamaños, si llega layoutSpec se respeta; si no, se aproxima al patrón previo.
        let containerW, containerH, logoH, spacing, qrInnerPx, qrX;
        if (is15) {
            logoH    = logoImg ? 30 : 0;
            spacing  = logoImg ? 5  : 0;
            qrInnerPx = 100;
            const logoW = logoImg ? Math.round(logoImg.naturalWidth * (logoH / logoImg.naturalHeight)) : 0;
            containerW = Math.max(qrInnerPx, logoW);
            containerH = logoH + spacing + qrInnerPx;
            qrX = Math.round((containerW - qrInnerPx) / 2);
        } else {
            const useCustom = !!layoutSpec;
            logoH    = useCustom ? (layoutSpec.logoHeight || 0) : (logoImg ? Math.round(qrPx * 0.48) : 0);
            spacing  = useCustom ? (layoutSpec.spacing    || 6) : (logoImg ? 6 : 0);
            qrInnerPx = useCustom ? (layoutSpec.qrSizePx || qrPx) : qrPx;
            containerW = useCustom ? (layoutSpec.containerWidth  || qrInnerPx) : qrInnerPx;
            containerH = useCustom ? (layoutSpec.containerHeight || (logoH + spacing + qrInnerPx)) : (logoH + spacing + qrInnerPx);
            qrX = useCustom ? (layoutSpec.qrMarginX || 0) : 0;
        }

        // 6) Componer una sola imagen (logo arriba, QR abajo)
        const canvas = document.createElement('canvas');
        canvas.width = containerW;
        canvas.height = containerH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, containerW, containerH);

        // Logo centrado
        if (logoImg && logoH) {
            const logoWdraw = Math.round(logoImg.naturalWidth * (logoH / logoImg.naturalHeight));
            const logoX = Math.max(0, Math.round((containerW - logoWdraw) / 2));
            ctx.drawImage(logoImg, logoX, 0, logoWdraw, logoH);
        }

        // QR centrado
        const qrY = logoH ? (logoH + spacing) : 0;
        ctx.drawImage(
            qrImg,
            0, 0, qrImg.naturalWidth, qrImg.naturalHeight, // src
            qrX, qrY, qrInnerPx, qrInnerPx                 // dst
        );

        // 7) Embeber en PDF (px→pt) y colocar a 30pt del borde superior/derecho
        const dataUrl = canvas.toDataURL('image/png');
        const imgBytes = this.dataURLToUint8Array(dataUrl);
        const pdfImage = await pdfDoc.embedPng(imgBytes);

        URL.revokeObjectURL(qrObj);

        const pages = pdfDoc.getPages();
        const first = pages[0];
        const { width: pageW, height: pageH } = first.getSize();

        const drawW = this.pxToPt(containerW);
        const drawH = this.pxToPt(containerH);
        const marginPt = 30; // equivalente al overlay backend

        const x = pageW - drawW - marginPt;
        const y = pageH - drawH - marginPt;

        first.drawImage(pdfImage, { x, y, width: drawW, height: drawH });

        const out = await pdfDoc.save();
        this.downloadFile(out, filename);
        console.log('✅ Overlay JS 1.5 clonado del QWeb con precisión');
        return true;
    }

    // =========================
    // Vista previa del QR (HTML)
    // =========================
    async updateQRPreview(imgSelector, qrText, targetPx, logoSrc = null, layoutSpec = null) {
        try {
            const imgEl = document.querySelector(imgSelector);
            if (!imgEl) return;

            const is15 = (Number(targetPx) === 100) ||
                         (typeof targetPx === 'string' && targetPx.startsWith('1.5')) ||
                         (layoutSpec && Number(layoutSpec.qrSizePx) === 100);

            const qrInnerPx = is15 ? 100 : (layoutSpec?.qrSizePx || targetPx);
            const fetchW = is15 ? 100 : Math.max(100, Math.round(qrInnerPx * 4));
            const fetchH = is15 ? 100 : Math.max(100, Math.round(qrInnerPx * 4));
            const qrUrl = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${fetchW}&height=${fetchH}`;

            const resp = await fetch(qrUrl, { credentials: 'same-origin' });
            if (!resp.ok) { imgEl.src = qrUrl; return; }

            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);

            const qrImg = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = objUrl; });

            let logoImg = null;
            if (logoSrc) {
                try { logoImg = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = logoSrc; }); }
                catch { logoImg = null; }
            }

            // Layout QWeb 1.5
            const logoH = logoImg ? 30 : 0;
            const spacing = logoImg ? 5 : 0;
            const logoWdraw = logoImg ? Math.round(logoImg.naturalWidth * (logoH / logoImg.naturalHeight)) : 0;
            const containerW = Math.max(qrInnerPx, logoWdraw);
            const containerH = logoH + spacing + qrInnerPx;

            const canvas = document.createElement('canvas');
            canvas.width = containerW;
            canvas.height = containerH;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, containerW, containerH);

            if (logoImg && logoH) {
                const logoX = Math.max(0, Math.round((containerW - logoWdraw) / 2));
                ctx.drawImage(logoImg, logoX, 0, logoWdraw, logoH);
            }

            const qrX = Math.round((containerW - qrInnerPx) / 2);
            const qrY = logoH ? (logoH + spacing) : 0;
            ctx.drawImage(qrImg, 0, 0, qrImg.naturalWidth, qrImg.naturalHeight, qrX, qrY, qrInnerPx, qrInnerPx);

            imgEl.src = canvas.toDataURL('image/png');
            imgEl.style.imageRendering = 'pixelated';
            URL.revokeObjectURL(objUrl);
        } catch (e) {
            console.warn('No se pudo actualizar la vista previa. Usando imagen directa del backend. Error:', e);
            try {
                const imgEl = document.querySelector(imgSelector);
                if (!imgEl) return;
                imgEl.src = `/report/barcode/?type=QR&value=${encodeURIComponent(qrText)}&width=${targetPx}&height=${targetPx}`;
            } catch (err) {
                console.error('Error total generando QR:', err);
            }
        }
    }

    // =========================
    // Utilidades PDF/Descarga
    // =========================
    dataURLToUint8Array(dataURL) {
        const parts = dataURL.split(',');
        const base64 = parts[1] || '';
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        return bytes;
    }

    redirectToServerOverlay() {
        try {
            const current = window.location.pathname;
            const target = current.replace('/overlay_js', '/overlay');
            const finalUrl = `${window.location.origin}${target}${window.location.search}`;
            console.log('➡️ Redirigiendo al overlay del servidor:', finalUrl);
            window.location.href = finalUrl;
        } catch (e) {
            console.warn('No se pudo redirigir automáticamente al overlay del servidor:', e);
        }
    }

    // =========================
    // Modo demo / backups
    // =========================
    async generateDemoOverlay(pdfUrl, qrText, qrSize, filename) {
        console.log('🎯 Generando QR real con Canvas API (demo)…');
        try {
            const qrCanvas = await this.generateQRWithCanvas(qrText);
            await new Promise(res => setTimeout(res, 800));
            const pdfContent = this.createRealQRPDF(qrText, qrSize, filename, qrCanvas);
            this.downloadFile(pdfContent, filename);
            return true;
        } catch (error) {
            console.error('Error Canvas demo:', error);
            const demoContent = this.createDemoPDF(qrText, qrSize, filename);
            this.downloadFile(demoContent, filename);
            return true;
        }
    }

    async generateQRWithCanvas(text, size = 200) {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFF'; ctx.fillRect(0, 0, size, size);

        const qrMatrix = this.generateSimpleQRMatrix(text, 25);
        const cell = size / qrMatrix.length;
        ctx.fillStyle = '#000';
        for (let r = 0; r < qrMatrix.length; r++) {
            for (let c = 0; c < qrMatrix[r].length; c++) {
                if (qrMatrix[r][c]) ctx.fillRect(c * cell, r * cell, cell, cell);
            }
        }
        ctx.fillStyle = '#000'; ctx.font = '8px Arial'; ctx.textAlign = 'center';
        const shortUrl = text.length > 30 ? text.substring(0, 30) + '…' : text;
        ctx.fillText(shortUrl, size / 2, size - 5);
        return canvas;
    }

    generateSimpleQRMatrix(text, size) {
        const m = []; for (let i = 0; i < size; i++) m[i] = new Array(size).fill(false);
        this.addFinderPattern(m, 0, 0);
        this.addFinderPattern(m, 0, size - 7);
        this.addFinderPattern(m, size - 7, 0);
        const hash = this.simpleHash(text); let hi = 0;
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
            if (this.isInFinderPattern(r, c, size)) continue;
            const bit = (hash >> (hi % 32)) & 1;
            m[r][c] = bit === 1; hi++;
        }
        return m;
    }

    addFinderPattern(m, sr, sc) {
        const p = [
            [1,1,1,1,1,1,1],[1,0,0,0,0,0,1],[1,0,1,1,1,0,1],
            [1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,0,0,0,0,1],[1,1,1,1,1,1,1]
        ];
        for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
            if (sr + i < m.length && sc + j < m[0].length) m[sr + i][sc + j] = p[i][j] === 1;
        }
    }

    isInFinderPattern(r, c, size) {
        return (r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9);
    }

    simpleHash(str) {
        let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
        return Math.abs(h);
    }

    createRealQRPDF(qrText, qrSize, filename, qrCanvas) {
        const qrImageData = qrCanvas.toDataURL('image/png');
        const qrBase64 = qrImageData.split(',')[1];
        const sizePixels = this.convertSizeToPixels(qrSize);
        const currentDate = new Date().toISOString();

        const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /QRImage 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>
endobj
4 0 obj
<< /Type /XObject /Subtype /Image /Width ${qrCanvas.width} /Height ${qrCanvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${qrBase64.length} >>
stream
${qrBase64}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
6 0 obj
<< /Length 400 >>
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
(Tamaño QR: ${qrSize} = ${sizePixels}px) Tj
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
<< /Size 7 /Root 1 0 R >>
startxref
1000
%%EOF`;
        return content;
    }

    createDemoPDF(qrText, qrSize, filename) {
        const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 200 >>
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
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
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
<< /Size 6 /Root 1 0 R >>
startxref
650
%%EOF`;
        return content;
    }

    downloadFile(content, filename) {
        const blob = (typeof content === 'string')
            ? new Blob([content], { type: 'application/pdf' })
            : new Blob([content], { type: 'application/pdf' });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Exponer global e inicializar
window.qrOverlayManager = new QROverlayManager();
window.qrOverlayManager.initialize().catch(err => console.error('Error inicializando QR Overlay Manager:', err));
console.log('QR Overlay Manager listo (calibrado para QWeb 1.5).');