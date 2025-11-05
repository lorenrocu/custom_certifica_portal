odoo.define('custom_certifica_portal.qr_card', function (require) {
    'use strict';

    require('web.dom_ready');
    var $ = require('jquery');

    try {
        $('.js-qr-card').each(function () {
            var $img = $(this);
            var qr = $img.data('qr');
            var cm = $img.data('cm') || '1.5';
            if (qr) {
                var url = 'https://ctf-qr.onrender.com/card?qr=' + encodeURIComponent(qr) + '&cm=' + encodeURIComponent(cm);
                $img.attr('src', url);
            }
        });
    } catch (e) {
        console.error('Error configurando QR Card:', e);
    }
});