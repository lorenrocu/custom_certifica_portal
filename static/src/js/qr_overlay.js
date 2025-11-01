odoo.define('custom_certifica_portal.qr_overlay', function (require) {
'use strict';

var core = require('web.core');
var Widget = require('web.Widget');

/**
 * Widget para manejar la funcionalidad de QR Card (Servicio Externo)
 * Utiliza servicios externos para generar códigos QR
 */
var QROverlay = Widget.extend({
    template: 'QROverlayTemplate',
    
    /**
     * Inicializa el widget QR Overlay
     */
    init: function(parent, options) {
        this._super(parent);
        this.options = options || {};
        this.qr_size = this.options.qr_size || '150x150';
        this.qr_data = this.options.qr_data || '';
    },

    /**
     * Genera la URL del QR usando servicio externo
     */
    generateQRUrl: function() {
        var baseUrl = 'https://api.qrserver.com/v1/create-qr-code/';
        var params = {
            size: this.qr_size,
            data: encodeURIComponent(this.qr_data)
        };
        
        var queryString = Object.keys(params).map(function(key) {
            return key + '=' + params[key];
        }).join('&');
        
        return baseUrl + '?' + queryString;
    },

    /**
     * Renderiza el QR en el DOM
     */
    renderQR: function() {
        var qrUrl = this.generateQRUrl();
        var $qrContainer = this.$('.qr-container');
        
        if ($qrContainer.length) {
            var $img = $('<img>').attr({
                'src': qrUrl,
                'alt': 'QR Code',
                'class': 'qr-code-image'
            });
            $qrContainer.html($img);
        }
    },

    /**
     * Método llamado después de que el widget se renderiza
     */
    start: function() {
        this._super();
        this.renderQR();
    }
});

// Funciones de utilidad para QR Card
var QRCardUtils = {
    /**
     * Abre una nueva ventana con el QR Card
     */
    openQRCard: function(url, title) {
        var windowFeatures = 'width=800,height=600,scrollbars=yes,resizable=yes';
        window.open(url, title || 'QR Card', windowFeatures);
    },

    /**
     * Valida si una URL es válida para generar QR
     */
    isValidUrl: function(url) {
        try {
            new URL(url);
            return true;
        } catch (e) {
            return false;
        }
    },

    /**
     * Genera diferentes tamaños de QR
     */
    getSizeOptions: function() {
        return {
            'small': '150x150',
            'medium': '350x350', 
            'large': '500x500',
            'xlarge': '950x950'
        };
    }
};

// Exportar para uso en otros módulos
return {
    QROverlay: QROverlay,
    QRCardUtils: QRCardUtils
};

});