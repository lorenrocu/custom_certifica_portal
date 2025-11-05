odoo.define('custom_certifica_portal.qr_card', function (require) {
    'use strict';

    var publicWidget = require('web.public.widget');

    publicWidget.registry.QRCardWidget = publicWidget.Widget.extend({
        selector: '.js-qr-card',
        start: function () {
            var $img = this.$el;
            try {
                var qr = $img.data('qr');
                var cm = $img.data('cm') || '1.5';
                if (qr) {
                    var url = 'https://ctf-qr.onrender.com/card?qr=' + encodeURIComponent(qr) + '&cm=' + encodeURIComponent(cm);
                    $img.attr('src', url);
                }
            } catch (e) {
                console.error('Error configurando QR Card:', e);
            }
            return this._super.apply(this, arguments);
        },
    });

});