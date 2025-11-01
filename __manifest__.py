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
        'security/ir.model.access.csv',
        'views/views.xml',
        'views/templates.xml',
        'views/templates_personas.xml',
        'views/templates_oiso.xml',
        'report/qrcode.xml',
        'report/qrcode_backend15.xml',
        'report/qrcode_backend50.xml',
        'report/qrcode_combined.xml',
        'report/qrcode_overlay_js_backend.xml',
    ],
    'installable': True,
    'application': True,
    "price": 15.0,
    "currency": "EUR",
    'license': 'Other proprietary',
    'images': ['images/thumbnail.png'],
}
