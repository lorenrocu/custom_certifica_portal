# -*- coding: utf-8 -*-
# Part of CierTech

{
    'name': "Portal de certificados",
    'summary': """
        Portal de certificados
    """,
    'description': """
        Portal de certificados
     """,
    'author': "Piotr Cierkosz",
    'website': "https://www.cier.tech",
    'category': 'Sales',
    'version': '13.0.1.0.1',
    'depends': ['portal'],
    'data': [
        # QR Code templates originales (mantenidos para compatibilidad)
        'report/qrcode.xml',
        'report/qrcode_backend15.xml',
        'report/qrcode_backend35.xml',
        'report/qrcode_backend50.xml',
        'report/qrcode_backend95.xml',
        'report/qrcode_overlay_backend.xml',
        'report/qrcode_overlay_js_backend.xml',
        'report/qrcode_combined.xml',
        
        # QR Code solo - separados por tamaño
        'report/qrcode_only_15cm.xml',
        'report/qrcode_only_35cm.xml',
        'report/qrcode_only_50cm.xml',
        'report/qrcode_only_95cm.xml',
        
        # Certificado + QR (Overlay) - separados por tamaño
        'report/certificate_qr_overlay_15cm.xml',
        'report/certificate_qr_overlay_35cm.xml',
        'report/certificate_qr_overlay_50cm.xml',
        'report/certificate_qr_overlay_95cm.xml',
        
        # Certificado + QR (JavaScript) - separados por tamaño
        'report/certificate_qr_javascript_15cm.xml',
        'report/certificate_qr_javascript_35cm.xml',
        'report/certificate_qr_javascript_50cm.xml',
        'report/certificate_qr_javascript_95cm.xml',
        
        # Certificado + QR Card (Servicio Externo) - separados por tamaño
        'report/certificate_qr_external_15cm.xml',
        'report/certificate_qr_external_35cm.xml',
        'report/certificate_qr_external_50cm.xml',
        'report/certificate_qr_external_95cm.xml',
        
        # Templates de vistas
        'views/templates.xml',
        'views/templates_personas.xml',
        'views/templates_oiso.xml',
             ],
    'installable': True,
    'application': True,
    "price": 15.0,
    "currency": "EUR",
    'license': 'Other proprietary',
    'images': ['images/thumbnail.png'],
}
