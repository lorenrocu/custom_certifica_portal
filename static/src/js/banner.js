function printDiv(divName){
			var printContents = document.getElementById(divName).innerHTML;
			var originalContents = document.body.innerHTML;

			document.body.innerHTML = printContents;

			window.print();

			document.body.innerHTML = originalContents;

}

/**
 * Genera un código QR usando el servicio externo ctf-qr.onrender.com
 * @param {string} urlOdoo - URL de Odoo que contiene los datos del certificado
 * @param {number} sizeCm - Tamaño del QR en centímetros (ej: 1.5, 3.5, 5.0, 9.5)
 */
function generateQRCard(urlOdoo, sizeCm) {
    // URL base del servicio externo
    const serviceBaseUrl = 'https://ctf-qr.onrender.com/card';
    
    // Codificar la URL de Odoo para usarla como parámetro
    const encodedUrl = encodeURIComponent(urlOdoo);
    
    // Construir la URL completa
    const qrServiceUrl = serviceBaseUrl + '?qr=' + encodedUrl + '&cm=' + sizeCm;
    
    // Crear un modal para mostrar el QR
    showQRModal(qrServiceUrl, sizeCm);
}

/**
 * Muestra un modal con la imagen del QR generado
 * @param {string} qrImageUrl - URL de la imagen del QR
 * @param {number} sizeCm - Tamaño del QR en centímetros
 */
function showQRModal(qrImageUrl, sizeCm) {
    // Eliminar modal existente si hay uno
    const existingModal = document.getElementById('qr-card-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Crear el modal
    const modal = document.createElement('div');
    modal.id = 'qr-card-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.7); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background-color: white; padding: 20px; border-radius: 8px; max-width: 90%; max-height: 90%; overflow: auto; position: relative;';
    
    // Botón de cerrar
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 30px; cursor: pointer; color: #333;';
    closeBtn.onclick = function() {
        modal.remove();
    };
    
    // Contenedor de la imagen
    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'text-align: center; padding: 20px;';
    
    // Mensaje de carga
    const loadingMsg = document.createElement('div');
    loadingMsg.id = 'qr-loading-msg';
    loadingMsg.innerHTML = '<p>Cargando código QR...</p>';
    loadingMsg.style.cssText = 'text-align: center; padding: 20px;';
    
    // Imagen del QR
    const qrImage = document.createElement('img');
    qrImage.id = 'qr-card-image';
    qrImage.style.cssText = 'max-width: 100%; height: auto;';
    qrImage.alt = 'Código QR ' + sizeCm + 'cm';
    
    // Manejo de errores en la carga de la imagen
    qrImage.onerror = function() {
        loadingMsg.innerHTML = '<p style="color: red;">Error al cargar el código QR. Por favor, intente nuevamente.</p>';
        qrImage.style.display = 'none';
    };
    
    // Cuando la imagen se carga correctamente
    qrImage.onload = function() {
        loadingMsg.style.display = 'none';
        qrImage.style.display = 'block';
    };
    
    // Establecer la fuente de la imagen
    qrImage.src = qrImageUrl;
    
    // Botones de acción
    const actionButtons = document.createElement('div');
    actionButtons.style.cssText = 'text-align: center; margin-top: 15px;';
    
    const printBtn = document.createElement('button');
    printBtn.innerHTML = '<i class="fa fa-print"></i> Imprimir';
    printBtn.className = 'btn btn-primary';
    printBtn.style.cssText = 'margin-right: 10px;';
    printBtn.onclick = function() {
        printQRImage(qrImageUrl);
    };
    
    const downloadBtn = document.createElement('button');
    downloadBtn.innerHTML = '<i class="fa fa-download"></i> Descargar';
    downloadBtn.className = 'btn btn-secondary';
    downloadBtn.onclick = function() {
        downloadQRImage(qrImageUrl, sizeCm);
    };
    
    actionButtons.appendChild(printBtn);
    actionButtons.appendChild(downloadBtn);
    
    // Ensamblar el modal
    imgContainer.appendChild(loadingMsg);
    imgContainer.appendChild(qrImage);
    modalContent.appendChild(closeBtn);
    modalContent.appendChild(imgContainer);
    modalContent.appendChild(actionButtons);
    modal.appendChild(modalContent);
    
    // Cerrar al hacer clic fuera del modal
    modal.onclick = function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    };
    
    // Agregar el modal al body
    document.body.appendChild(modal);
}

/**
 * Imprime la imagen del QR
 * @param {string} imageUrl - URL de la imagen del QR
 */
function printQRImage(imageUrl) {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Imprimir Código QR</title>
                <style>
                    body {
                        margin: 0;
                        padding: 20px;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                    }
                    img {
                        max-width: 100%;
                        height: auto;
                    }
                    @media print {
                        body {
                            margin: 0;
                        }
                    }
                </style>
            </head>
            <body>
                <img src="${imageUrl}" alt="Código QR" />
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.onload = function() {
        printWindow.print();
    };
}

/**
 * Descarga la imagen del QR
 * @param {string} imageUrl - URL de la imagen del QR
 * @param {number} sizeCm - Tamaño del QR en centímetros
 */
function downloadQRImage(imageUrl, sizeCm) {
    // Crear un elemento temporal para la descarga
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = 'QR-' + sizeCm + 'cm.png';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Inicializar event listeners para los botones JS Card cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    // Usar event delegation para manejar clicks en botones JS Card
    document.addEventListener('click', function(e) {
        // Verificar si el click fue en un botón JS Card o en un elemento dentro de él
        const btn = e.target.closest('.js-qr-card-btn');
        if (btn) {
            e.preventDefault();
            const urlOdoo = btn.getAttribute('data-url');
            const sizeCm = parseFloat(btn.getAttribute('data-size'));
            
            if (urlOdoo && sizeCm) {
                generateQRCard(urlOdoo, sizeCm);
            } else {
                console.error('Error: URL o tamaño no encontrado en el botón QR Card');
                alert('Error al generar el código QR. Por favor, recargue la página e intente nuevamente.');
            }
        }
    });
});