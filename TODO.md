# Modificar reportes QR para eliminar dependencia de bundles

## Información Gathered
- Los reportes "QR Code - 1.5cm" hasta "QR Code - 9.5cm" usan campos qr_code15, qr_code35, etc. generados con bundles/JavaScript.
- El reporte en qrcode.xml usa generación dinámica con /report/barcode/.
- Se necesita mostrar exactamente el mismo resultado pero sin bundles.

## Plan
- Modificar templates en qrcode_backend*.xml para calcular xurldownload dinámicamente en QWeb.
- Cambiar img src para usar /report/barcode/ con parámetros dinámicos.
- Definir constantes w y h según el tamaño del QR.

## Dependent Files to be edited
- report/qrcode_backend15.xml: Cambiar template para usar generación dinámica (w=100, h=100)
- report/qrcode_backend35.xml: Cambiar template para usar generación dinámica (w=234, h=234)
- report/qrcode_backend50.xml: Cambiar template para usar generación dinámica (w=333, h=333)
- report/qrcode_backend95.xml: Cambiar template para usar generación dinámica (w=587, h=587)

## Followup steps
- Probar que los reportes generen QR correctamente sin errores.
- Verificar que el resultado visual sea idéntico al anterior.
