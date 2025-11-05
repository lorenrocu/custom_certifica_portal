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
    'version': '13.0.1.0.2',
    'depends': ['portal'],
    'data': [
        'views/assets.xml',
        'report/qrcode.xml',
        'report/qrcode_js_card_backend15.xml',
        'report/disable_legacy_qr.xml',
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
