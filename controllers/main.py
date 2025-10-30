from logging import getLogger

from odoo import http, fields, _
from odoo.http import request
from odoo.addons.portal.controllers.portal import CustomerPortal, pager as portal_pager
from collections import OrderedDict
from odoo.osv.expression import OR
from odoo.exceptions import AccessError, MissingError
import base64
import logging
import werkzeug
import io

_logger = getLogger(__name__)

class ProductPlannerPortal(CustomerPortal):
    _inherit = 'ir.actions.report'

    def _buscar_tipo_documento_dinamico(self, strurl):
        """
        Busca un tipo de documento de forma dinámica.
        Si no encuentra el tipo exacto, busca similitudes inteligentes.
        """
        _logger.info("_buscar_tipo_documento_dinamico - Buscando tipo: '%s'" % strurl)
        
        # Buscar tipo exacto primero
        tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', strurl)],limit=1)
        
        if tiposdocumentos:
            _logger.info("_buscar_tipo_documento_dinamico - Tipo exacto encontrado: '%s'" % strurl)
            return tiposdocumentos, strurl
        
        # COMPATIBILIDAD DINÁMICA CON QR ANTIGUOS
        _logger.info("_buscar_tipo_documento_dinamico - Tipo '%s' no encontrado, buscando coincidencias dinámicas..." % strurl)
        
        try:
            # Obtener todos los tipos disponibles
            todos_tipos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True)])
            tipos_disponibles = [tipo.code for tipo in todos_tipos]
            
            _logger.info("_buscar_tipo_documento_dinamico - Tipos disponibles: %s" % tipos_disponibles)
            
            # Mapeo simple y directo para casos conocidos
            # Ajustado: 'elementosdeizaje' debe redirigir a 'equiposdemedicion'
            # porque es el tipo activo que actualmente funciona en producción.
            mapeo_directo = {
                'elementosdeizaje': 'equiposdemedicion',
            }
            
            # Verificar mapeo directo primero
            if strurl in mapeo_directo:
                nuevo_tipo = mapeo_directo[strurl]
                _logger.info("_buscar_tipo_documento_dinamico - Usando mapeo directo: '%s' -> '%s'" % (strurl, nuevo_tipo))
                tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', nuevo_tipo)],limit=1)
                if tiposdocumentos:
                    _logger.info("_buscar_tipo_documento_dinamico - Mapeo directo exitoso")
                    return tiposdocumentos, nuevo_tipo
                else:
                    # Fallback adicional: intentar 'mediciondeequipo' si 'equiposdemedicion' no está activo
                    _logger.warning("_buscar_tipo_documento_dinamico - Mapeo directo falló para '%s'. Intentando fallback 'mediciondeequipo'" % nuevo_tipo)
                    tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', 'mediciondeequipo')],limit=1)
                    if tiposdocumentos:
                        _logger.info("_buscar_tipo_documento_dinamico - Fallback exitoso: 'elementosdeizaje' -> 'mediciondeequipo'")
                        return tiposdocumentos, 'mediciondeequipo'
            
            # Función para calcular similitud entre strings
            def calcular_similitud(str1, str2):
                # Convertir a minúsculas para comparación
                s1, s2 = str1.lower(), str2.lower()
                
                # Coincidencia exacta
                if s1 == s2:
                    return 100
                
                # Uno contiene al otro
                if s1 in s2 or s2 in s1:
                    return 80
                
                # Buscar palabras clave comunes
                palabras_clave = {
                    'medicion': ['medicion', 'equipo', 'equipos', 'izaje', 'elementos'],
                    'personas': ['persona', 'personal', 'trabajador'],
                    'fisicos': ['fisico', 'physical'],
                    'quimicos': ['quimico', 'chemical'],
                    'biologicos': ['biologico', 'biological'],
                    'ergonomico': ['ergonomico', 'psicosocial']
                }
                
                for categoria, keywords in palabras_clave.items():
                    if any(kw in s1 for kw in keywords) and categoria in s2:
                        return 70
                    if any(kw in s2 for kw in keywords) and categoria in s1:
                        return 70
                
                # Similitud por caracteres comunes
                chars_comunes = len(set(s1) & set(s2))
                max_chars = max(len(s1), len(s2))
                if max_chars > 0:
                    return (chars_comunes / max_chars) * 50
                
                return 0
            
            # Buscar el mejor match
            mejor_match = None
            mejor_score = 0
            
            for tipo_disponible in tipos_disponibles:
                score = calcular_similitud(strurl, tipo_disponible)
                _logger.info("_buscar_tipo_documento_dinamico - Similitud '%s' vs '%s': %d%%" % (strurl, tipo_disponible, score))
                
                if score > mejor_score and score >= 60:  # Umbral mínimo de similitud
                    mejor_score = score
                    mejor_match = tipo_disponible
            
            # Si encontramos un match válido, usarlo
            if mejor_match:
                _logger.info("_buscar_tipo_documento_dinamico - MATCH ENCONTRADO: '%s' -> '%s' (similitud: %d%%)" % (strurl, mejor_match, mejor_score))
                tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', mejor_match)],limit=1)
                if tiposdocumentos:
                    _logger.info("_buscar_tipo_documento_dinamico - Mapeo dinámico exitoso: '%s' -> '%s'" % (strurl, mejor_match))
                    return tiposdocumentos, mejor_match
            
            _logger.warning("_buscar_tipo_documento_dinamico - No se encontró ningún tipo similar a '%s'" % strurl)
            return None, strurl
            
        except Exception as e:
            _logger.error("_buscar_tipo_documento_dinamico - Error en búsqueda dinámica: %s" % str(e))
            return None, strurl

    @http.route(['/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>',
                 '/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>/<string:idcertificado>'], type='http', auth="user",website=True)
    def print_qrcode(self,**kwargs):
        strurlruta = kwargs.get('ruta_url')
        strurl = kwargs.get('ruta_urlqr')
        idcertificado = kwargs.get('idcertificado')
        xid = kwargs.get('id')
        xuserid = kwargs.get('userid')
        report_name = 'custom_certifica_portal.print_qr'

        _logger.info("print_qrcode - Generando QR para tipo: '%s'" % strurlruta)

        # APLICAR BÚSQUEDA DINÁMICA PARA QR ANTIGUOS Y NUEVOS
        tiposdocumentos, strurlruta_final = self._buscar_tipo_documento_dinamico(strurlruta)
        
        if not tiposdocumentos:
            _logger.error("print_qrcode - Tipo de documento no encontrado para: '%s'" % strurlruta)
            return self._return_error_response("No se puede generar QR: Tipo de documento '%s' no encontrado" % strurlruta)
        
        if strurlruta != strurlruta_final:
            _logger.info("print_qrcode - Tipo mapeado: '%s' -> '%s'" % (strurlruta, strurlruta_final))

        urlbase = request.env['ir.config_parameter'].sudo().search([('key','=','web.base.url')])
        
        # Detectar si estamos en entorno de desarrollo
        base_url = str(urlbase.value)
        if 'tienda-desa.certificalatam.com' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
        elif base_url == 'https://tienda.certificalatam.com' and 'desa' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
            
        # Usar el tipo final (mapeado si es necesario) para generar la URL
        if strurlruta_final=='personas':
            xurldownload = base_url+'/web/certificado_current/download_pdf/'+str(idcertificado)
        else:
            xurldownload = base_url+'/web/ultimocertificado/'+str(strurlruta_final)+'/'+str(xid)+'/'+str(xuserid)
        # Mapeo calibrado para igualar el tamaño que "ya se tenía"
        if strurl=='print_qr15':
            w=100
            h=100
        if strurl=='print_qr35':
            w=234
            h=234
        if strurl=='print_qr50':
            w=333
            h=333
        if strurl=='print_qr95':
            w=587
            h=587

        docargs = {
            'xurldownload': xurldownload,
            'h': h,
            'w': w,
        }

        response = werkzeug.wrappers.Response()
        # Manejo seguro de conversiones a entero para evitar ValueError cuando el parámetro es 'False' u otro valor no numérico
        xid_int = int(xid) if xid and str(xid).isdigit() else False
        if strurlruta=='personas':
            certificado = request.env['informes.encuestas.merge'].sudo().search(
                [('personas_id', '=', xid_int)], order='fecha_vigencia desc',limit=1)
        else:
            certificado = request.env['informes.encuestas.merge'].sudo().search(
                [('xmaquinaria', '=', xid_int)], order='fecha_vigencia desc',limit=1)

        r = certificado
        if r:
            r = request.env.ref(report_name).sudo().render_qweb_pdf([r.id],docargs)[0]
            response.data = r
        else:
            response.data = ''
        response.mimetype = 'application/pdf'
        return response

    @http.route(['/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>/combined',
                 '/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>/<string:idcertificado>/combined'], type='http', auth="user",website=True)
    def print_certificate_with_qr_combined(self,**kwargs):
        """
        Descarga el certificado completo original y le agrega un QR en una página adicional
        """
        strurlruta = kwargs.get('ruta_url')
        strurl = kwargs.get('ruta_urlqr')
        idcertificado = kwargs.get('idcertificado')
        xid = kwargs.get('id')
        xuserid = kwargs.get('userid')

        _logger.info("print_certificate_with_qr_combined - Generando certificado completo con QR para tipo: '%s'" % strurlruta)

        # Validación de parámetros obligatorios
        if not strurlruta:
            _logger.error("print_certificate_with_qr_combined - Parámetro ruta_url faltante")
            return self._return_error_response("Parámetro ruta_url requerido")
            
        if not xid or xid == 'False':
            _logger.error("print_certificate_with_qr_combined - Parámetro id inválido: %s" % xid)
            return self._return_error_response("ID de registro inválido")
            
        if not xuserid or xuserid == 'False':
            _logger.error("print_certificate_with_qr_combined - Parámetro userid inválido: %s" % xuserid)
            return self._return_error_response("ID de usuario inválido")

        # APLICAR BÚSQUEDA DINÁMICA PARA QR ANTIGUOS Y NUEVOS
        tiposdocumentos, strurlruta_final = self._buscar_tipo_documento_dinamico(strurlruta)
        
        if not tiposdocumentos:
            _logger.error("print_certificate_with_qr_combined - Tipo de documento no encontrado para: '%s'" % strurlruta)
            return self._return_error_response("No se puede generar certificado: Tipo de documento '%s' no encontrado" % strurlruta)
        
        if strurlruta != strurlruta_final:
            _logger.info("print_certificate_with_qr_combined - Tipo mapeado: '%s' -> '%s'" % (strurlruta, strurlruta_final))

        # Conversión segura para evitar excepciones cuando los parámetros no son numéricos
        registro_id = int(xid) if xid and str(xid).isdigit() else False
        cliente_id = int(xuserid) if xuserid and str(xuserid).isdigit() else False
        
        _logger.info("print_certificate_with_qr_combined - IDs convertidos: registro_id=%s, cliente_id=%s, tipo_doc_id=%s" % (registro_id, cliente_id, tiposdocumentos.id))
        
        # Búsqueda del certificado usando la misma lógica que download_certificado_ultimo_pdf
        if strurlruta_final=='personas':
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                     ('personas_id', '=', registro_id),
                     ('cliente_id', '=', cliente_id)]
        else:
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                     ('xmaquinaria', '=', registro_id),
                     ('cliente_id', '=', cliente_id)]
        
        _logger.info("print_certificate_with_qr_combined - Dominio de búsqueda: %s" % domain)
        
        slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain, order='fecha_vigencia desc',limit=1)
        
        # Fallback: intentar con el parent_id del partner si no se encuentra
        if not slide_slide_obj and cliente_id:
            try:
                partner = request.env['res.partner'].sudo().browse(cliente_id)
                if partner and partner.parent_id:
                    domain_parent = [(d[0], d[1], d[2]) for d in domain]
                    for i, d in enumerate(domain_parent):
                        if d[0] == 'cliente_id':
                            domain_parent[i] = ('cliente_id', '=', partner.parent_id.id)
                    _logger.warning("print_certificate_with_qr_combined - Fallback usando parent_id=%s con dominio: %s" % (partner.parent_id.id, domain_parent))
                    slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain_parent, order='fecha_vigencia desc',limit=1)
            except Exception as e:
                _logger.error("print_certificate_with_qr_combined - Error en fallback parent_id: %s" % str(e))
        
        if not slide_slide_obj:
            _logger.error("print_certificate_with_qr_combined - No se encontró certificado con dominio: %s" % domain)
            return self._return_error_response("Certificado no encontrado")
        
        _logger.info("print_certificate_with_qr_combined - Certificado encontrado: ID=%s" % slide_slide_obj.id)

        # Verificar si existe el archivo PDF original
        original_pdf = slide_slide_obj.x_certificado_publicado_file
        if not original_pdf:
            _logger.error("print_certificate_with_qr_combined - Certificado ID=%s no tiene archivo PDF" % slide_slide_obj.id)
            return self._return_error_response("El certificado no tiene archivo PDF asociado")

        # Generar URL para el QR
        urlbase = request.env['ir.config_parameter'].sudo().search([('key','=','web.base.url')])
        base_url = str(urlbase.value)
        if 'tienda-desa.certificalatam.com' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
        elif base_url == 'https://tienda.certificalatam.com' and 'desa' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
            
        # Usar el tipo final (mapeado si es necesario) para generar la URL
        if strurlruta_final=='personas':
            xurldownload = base_url+'/web/certificado_current/download_pdf/'+str(idcertificado if idcertificado else slide_slide_obj.id)
        else:
            xurldownload = base_url+'/web/ultimocertificado/'+str(strurlruta_final)+'/'+str(xid)+'/'+str(xuserid)
        
        # Configurar tamaño del QR según el parámetro (calibrado)
        qr_width = 150
        qr_height = 150
        if strurl=='print_qr15':
            qr_width = 100
            qr_height = 100
        elif strurl=='print_qr35':
            qr_width = 234
            qr_height = 234
        elif strurl=='print_qr50':
            qr_width = 333
            qr_height = 333
        elif strurl=='print_qr95':
            qr_width = 587
            qr_height = 587

        try:
            # Generar el QR como PDF separado
            # El reporte print_qr espera las claves 'h' y 'w' (alto y ancho)
            # para mapearlas en la URL del barcode como width y height.
            # Ajustamos los argumentos para que el tamaño del QR se respete.
            docargs = {
                'xurldownload': xurldownload,
                'h': qr_width,   # width
                'w': qr_height,  # height
            }
            
            qr_pdf_data = request.env.ref('custom_certifica_portal.print_qr').sudo().render_qweb_pdf([slide_slide_obj.id], docargs)[0]
            
            # Combinar PDFs: certificado original + página con QR
            try:
                from PyPDF2 import PdfReader, PdfWriter
                import io
                
                # Leer PDF original
                original_pdf_bytes = base64.b64decode(original_pdf)
                original_reader = PdfReader(io.BytesIO(original_pdf_bytes))
                
                # Leer PDF del QR
                qr_reader = PdfReader(io.BytesIO(qr_pdf_data))
                
                # Crear PDF combinado
                writer = PdfWriter()
                
                # Agregar todas las páginas del certificado original
                for page in original_reader.pages:
                    writer.add_page(page)
                
                # Agregar página del QR
                for page in qr_reader.pages:
                    writer.add_page(page)
                
                # Generar PDF final
                output_buffer = io.BytesIO()
                writer.write(output_buffer)
                combined_pdf_data = output_buffer.getvalue()
                output_buffer.close()
                
            except ImportError:
                _logger.warning("print_certificate_with_qr_combined - PyPDF2 no disponible, devolviendo solo certificado original")
                combined_pdf_data = original_pdf_bytes
            except Exception as e:
                _logger.error("print_certificate_with_qr_combined - Error combinando PDFs: %s" % str(e))
                combined_pdf_data = original_pdf_bytes

            # Determinar nombre del archivo
            if slide_slide_obj.file_name_certificado:
                filename = slide_slide_obj.file_name_certificado.replace('.pdf', '-QR.pdf')
            else:
                if slide_slide_obj.codigocliente:
                    filename = slide_slide_obj.codigocliente+'-QR.pdf'
                else:
                    filename = 'CERTIFICADO_QR_SIN_CODIGO.pdf'

            # Generar respuesta
            response = werkzeug.wrappers.Response()
            response.data = combined_pdf_data
            response.headers['Content-Type'] = 'application/pdf'
            response.headers['Content-Disposition'] = 'attachment; filename="%s"' % filename
            response.mimetype = 'application/pdf'
            
            _logger.info("print_certificate_with_qr_combined - PDF combinado generado exitosamente: %s" % filename)
            return response
            
        except Exception as e:
            _logger.error("print_certificate_with_qr_combined - Error generando PDF combinado: %s" % str(e))
            return self._return_error_response("Error generando el certificado con QR: %s" % str(e))

    @http.route([
        '/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>/overlay',
        '/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>/<string:idcertificado>/overlay'
    ], type='http', auth="user", website=True)
    def print_certificate_with_qr_overlay(self, **kwargs):
        """
        Genera un PDF del certificado original con el QR incrustado (superpuesto) en la primera página.
        No reemplaza el flujo actual; expone una nueva ruta '/overlay' para pruebas.
        """
        strurlruta = kwargs.get('ruta_url')
        strurl = kwargs.get('ruta_urlqr')
        idcertificado = kwargs.get('idcertificado')
        xid = kwargs.get('id')
        xuserid = kwargs.get('userid')

        _logger.info("print_certificate_with_qr_overlay - Generando certificado con QR incrustado para tipo: '%s'" % strurlruta)

        # Validación de parámetros obligatorios
        if not strurlruta:
            _logger.error("print_certificate_with_qr_overlay - Parámetro ruta_url faltante")
            return self._return_error_response("Parámetro ruta_url requerido")
        if not xid or xid == 'False':
            _logger.error("print_certificate_with_qr_overlay - Parámetro id inválido: %s" % xid)
            return self._return_error_response("ID de registro inválido")
        if not xuserid or xuserid == 'False':
            _logger.error("print_certificate_with_qr_overlay - Parámetro userid inválido: %s" % xuserid)
            return self._return_error_response("ID de usuario inválido")

        # Búsqueda dinámica del tipo de documento
        tiposdocumentos, strurlruta_final = self._buscar_tipo_documento_dinamico(strurlruta)
        if not tiposdocumentos:
            _logger.error("print_certificate_with_qr_overlay - Tipo de documento no encontrado para: '%s'" % strurlruta)
            return self._return_error_response("No se puede generar certificado: Tipo de documento '%s' no encontrado" % strurlruta)
        if strurlruta != strurlruta_final:
            _logger.info("print_certificate_with_qr_overlay - Tipo mapeado: '%s' -> '%s'" % (strurlruta, strurlruta_final))

        # Conversión segura
        registro_id = int(xid) if xid and str(xid).isdigit() else False
        cliente_id = int(xuserid) if xuserid and str(xuserid).isdigit() else False

        # Búsqueda del certificado
        if strurlruta_final == 'personas':
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                      ('personas_id', '=', registro_id),
                      ('cliente_id', '=', cliente_id)]
        else:
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                      ('xmaquinaria', '=', registro_id),
                      ('cliente_id', '=', cliente_id)]
        _logger.info("print_certificate_with_qr_overlay - Dominio de búsqueda: %s" % domain)

        slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain, order='fecha_vigencia desc', limit=1)

        # Fallback con parent_id
        if not slide_slide_obj and cliente_id:
            try:
                partner = request.env['res.partner'].sudo().browse(cliente_id)
                if partner and partner.parent_id:
                    domain_parent = [(d[0], d[1], d[2]) for d in domain]
                    for i, d in enumerate(domain_parent):
                        if d[0] == 'cliente_id':
                            domain_parent[i] = ('cliente_id', '=', partner.parent_id.id)
                    _logger.warning("print_certificate_with_qr_overlay - Fallback usando parent_id=%s con dominio: %s" % (partner.parent_id.id, domain_parent))
                    slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain_parent, order='fecha_vigencia desc', limit=1)
            except Exception as e:
                _logger.error("print_certificate_with_qr_overlay - Error en fallback parent_id: %s" % str(e))

        if not slide_slide_obj:
            _logger.error("print_certificate_with_qr_overlay - No se encontró certificado con dominio: %s" % domain)
            return self._return_error_response("Certificado no encontrado")

        _logger.info("print_certificate_with_qr_overlay - Certificado encontrado: ID=%s" % slide_slide_obj.id)

        # PDF original
        original_pdf = slide_slide_obj.x_certificado_publicado_file
        if not original_pdf:
            _logger.error("print_certificate_with_qr_overlay - Certificado ID=%s no tiene archivo PDF" % slide_slide_obj.id)
            return self._return_error_response("El certificado no tiene archivo PDF asociado")

        # Base URL
        urlbase = request.env['ir.config_parameter'].sudo().search([('key', '=', 'web.base.url')])
        base_url = str(urlbase.value)
        if 'tienda-desa.certificalatam.com' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
        elif base_url == 'https://tienda.certificalatam.com' and 'desa' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'

        # URL de verificación para el QR
        if strurlruta_final == 'personas':
            xurldownload = base_url + '/web/certificado_current/download_pdf/' + str(idcertificado if idcertificado else slide_slide_obj.id)
        else:
            xurldownload = base_url + '/web/ultimocertificado/' + str(strurlruta_final) + '/' + str(xid) + '/' + str(xuserid)

        # Tamaño del QR (en puntos)
        # Tamaño del QR (en puntos) - mapeo calibrado
        qr_width = 150
        qr_height = 150
        if strurl == 'print_qr15':
            qr_width = 100
            qr_height = 100
        elif strurl == 'print_qr35':
            qr_width = 234
            qr_height = 234
        elif strurl == 'print_qr50':
            qr_width = 333
            qr_height = 333
        elif strurl == 'print_qr95':
            qr_width = 587
            qr_height = 587

        try:
            import io
            import base64
            from PyPDF2 import PdfReader, PdfWriter
            import urllib.parse
            import requests
            from reportlab.pdfgen import canvas
            from reportlab.lib.utils import ImageReader

            # Leer PDF original
            original_pdf_bytes = base64.b64decode(original_pdf)
            original_reader = PdfReader(io.BytesIO(original_pdf_bytes))
            first_page = original_reader.pages[0]
            page_width = float(first_page.mediabox.width)
            page_height = float(first_page.mediabox.height)

            # Generar imagen PNG del QR usando el endpoint de barcode
            # Para mejorar la nitidez del QR en el PDF, solicitar imagen con sobre-muestreo
            qr_fetch_width = max(100, int(qr_width * 4))
            qr_fetch_height = max(100, int(qr_height * 4))
            qr_url = base_url + '/report/barcode/?type=QR&value=' + urllib.parse.quote(xurldownload) + '&width=' + str(qr_fetch_width) + '&height=' + str(qr_fetch_height)
            _logger.info("print_certificate_with_qr_overlay - Generando QR desde URL: %s" % qr_url)
            resp = requests.get(qr_url, timeout=10)
            if resp.status_code != 200:
                _logger.error("print_certificate_with_qr_overlay - Error obteniendo imagen QR: status=%s" % resp.status_code)
                return self._return_error_response("No se pudo generar la imagen del QR")

            # Crear PDF de overlay con el QR posicionado en la esquina superior derecha
            overlay_buffer = io.BytesIO()
            c = canvas.Canvas(overlay_buffer, pagesize=(page_width, page_height))
            margin = 30  # margen desde el borde
            x_pos = page_width - qr_width - margin
            y_pos = page_height - qr_height - margin
            img_reader = ImageReader(io.BytesIO(resp.content))
            c.drawImage(img_reader, x_pos, y_pos, width=qr_width, height=qr_height, preserveAspectRatio=True, mask='auto')
            c.save()
            overlay_pdf_bytes = overlay_buffer.getvalue()
            overlay_buffer.close()

            overlay_reader = PdfReader(io.BytesIO(overlay_pdf_bytes))
            overlay_page = overlay_reader.pages[0]

            # Fusionar overlay en la primera página
            try:
                first_page.merge_page(overlay_page)
            except Exception:
                # Compatibilidad con versiones antiguas de PyPDF2
                if hasattr(first_page, 'mergePage'):
                    first_page.mergePage(overlay_page)

            # Crear writer y añadir páginas
            writer = PdfWriter()
            writer.add_page(first_page)
            for i in range(1, len(original_reader.pages)):
                writer.add_page(original_reader.pages[i])

            output_buffer = io.BytesIO()
            writer.write(output_buffer)
            final_pdf_data = output_buffer.getvalue()
            output_buffer.close()

            # Nombre del archivo
            if slide_slide_obj.file_name_certificado:
                filename = slide_slide_obj.file_name_certificado.replace('.pdf', '-QR-OVERLAY.pdf')
            else:
                filename = (slide_slide_obj.codigocliente + '-QR-OVERLAY.pdf') if slide_slide_obj.codigocliente else 'CERTIFICADO_QR_OVERLAY.pdf'

            # Respuesta
            response = werkzeug.wrappers.Response()
            response.data = final_pdf_data
            response.headers['Content-Type'] = 'application/pdf'
            response.headers['Content-Disposition'] = 'attachment; filename="%s"' % filename
            response.mimetype = 'application/pdf'
            _logger.info("print_certificate_with_qr_overlay - PDF generado exitosamente: %s" % filename)
            return response

        except ImportError as e:
            _logger.error("print_certificate_with_qr_overlay - Dependencia faltante: %s" % str(e))
            return self._return_error_response("Dependencias faltantes para overlay (PyPDF2 y reportlab)")
        except Exception as e:
            _logger.error("print_certificate_with_qr_overlay - Error generando PDF overlay: %s" % str(e))
            return self._return_error_response("Error generando el certificado con QR incrustado: %s" % str(e))

    @http.route([
        '/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>/overlay_js',
        '/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>/<string:ruta_urlqr>/<string:idcertificado>/overlay_js'
    ], type='http', auth="user", website=True)
    def print_certificate_with_qr_overlay_js(self, **kwargs):
        """
        Endpoint para la solución JavaScript de overlay QR.
        Proporciona una página HTML que usa JavaScript para superponer el QR.
        """
        strurlruta = kwargs.get('ruta_url')
        strurl = kwargs.get('ruta_urlqr')
        idcertificado = kwargs.get('idcertificado')
        xid = kwargs.get('id')
        xuserid = kwargs.get('userid')

        _logger.info("print_certificate_with_qr_overlay_js - Generando página JS para tipo: '%s'" % strurlruta)

        # Validación de parámetros obligatorios
        if not strurlruta:
            return self._return_error_response("Parámetro ruta_url requerido")
        if not xid or xid == 'False':
            return self._return_error_response("ID de registro inválido")
        if not xuserid or xuserid == 'False':
            return self._return_error_response("ID de usuario inválido")

        # Búsqueda dinámica del tipo de documento
        tiposdocumentos, strurlruta_final = self._buscar_tipo_documento_dinamico(strurlruta)
        if not tiposdocumentos:
            return self._return_error_response("Tipo de documento '%s' no encontrado" % strurlruta)

        # Conversión segura
        registro_id = int(xid) if xid and str(xid).isdigit() else False
        cliente_id = int(xuserid) if xuserid and str(xuserid).isdigit() else False

        # Búsqueda del certificado
        if strurlruta_final == 'personas':
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                      ('personas_id', '=', registro_id),
                      ('cliente_id', '=', cliente_id)]
        else:
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                      ('xmaquinaria', '=', registro_id),
                      ('cliente_id', '=', cliente_id)]

        slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain, order='fecha_vigencia desc', limit=1)

        # Fallback con parent_id
        if not slide_slide_obj and cliente_id:
            try:
                partner = request.env['res.partner'].sudo().browse(cliente_id)
                if partner and partner.parent_id:
                    domain_parent = [(d[0], d[1], d[2]) for d in domain]
                    for i, d in enumerate(domain_parent):
                        if d[0] == 'cliente_id':
                            domain_parent[i] = ('cliente_id', '=', partner.parent_id.id)
                    slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain_parent, order='fecha_vigencia desc', limit=1)
            except Exception as e:
                _logger.error("print_certificate_with_qr_overlay_js - Error en fallback parent_id: %s" % str(e))

        if not slide_slide_obj:
            return self._return_error_response("Certificado no encontrado")

        # PDF original
        original_pdf = slide_slide_obj.x_certificado_publicado_file
        if not original_pdf:
            return self._return_error_response("El certificado no tiene archivo PDF asociado")

        # Base URL
        urlbase = request.env['ir.config_parameter'].sudo().search([('key', '=', 'web.base.url')])
        base_url = str(urlbase.value)
        if 'tienda-desa.certificalatam.com' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
        elif base_url == 'https://tienda.certificalatam.com' and 'desa' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'

        # URL de verificación para el QR
        if strurlruta_final == 'personas':
            xurldownload = base_url + '/web/certificado_current/download_pdf/' + str(idcertificado if idcertificado else slide_slide_obj.id)
        else:
            xurldownload = base_url + '/web/ultimocertificado/' + str(strurlruta_final) + '/' + str(xid) + '/' + str(xuserid)

        # URL del PDF original
        pdf_url = base_url + '/web/content/informes.encuestas.merge/' + str(slide_slide_obj.id) + '/x_certificado_publicado_file'

        # Tamaño del QR
        qr_size_map = {
            'print_qr15': '1.5cm',
            'print_qr35': '3.5cm',
            'print_qr50': '5.0cm',
            'print_qr95': '9.5cm'
        }
        qr_size = qr_size_map.get(strurl, '1.5cm')

        # Dimensiones del QR (px) – mapeo calibrado para igualar lo que "ya se tenía"
        qr_width = 100
        qr_height = 100
        if strurl == 'print_qr35':
            qr_width = 234
            qr_height = 234
        elif strurl == 'print_qr50':
            qr_width = 333
            qr_height = 333
        elif strurl == 'print_qr95':
            qr_width = 587
            qr_height = 587

        # Nombre del archivo
        if slide_slide_obj.file_name_certificado:
            filename = slide_slide_obj.file_name_certificado.replace('.pdf', '-QR-OVERLAY-JS.pdf')
        else:
            filename = (slide_slide_obj.codigocliente + '-QR-OVERLAY-JS.pdf') if slide_slide_obj.codigocliente else 'CERTIFICADO_QR_OVERLAY_JS.pdf'

        # Construir URLs auxiliares
        import urllib.parse
        qr_url = base_url + '/report/barcode/?type=QR&value=' + urllib.parse.quote(xurldownload) + '&width=' + str(qr_width) + '&height=' + str(qr_height)
        overlay_url = base_url + '/web/ultimocertificado/' + str(strurlruta_final) + '/' + str(xid) + '/' + str(xuserid) + '/' + str(strurl) + '/overlay'

        # Preparar logo en base64 para mostrar sobre el QR (igual que QWeb)
        logo_b64 = None
        try:
            logo_b64 = slide_slide_obj.company_id.logo
            if isinstance(logo_b64, bytes):
                logo_b64 = logo_b64.decode('utf-8')
        except Exception:
            logo_b64 = None

        logo_src = 'data:image/png;base64,' + logo_b64 if logo_b64 else ''

        # Página HTML sin QWeb: diseño 2 columnas con QR (idéntico al original) y visor de certificado
        html_content = """
<!DOCTYPE html>
<html>
<head>
    <title>Certificado + QR (Vista)</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
        :root {
            --bg: #f6f8fa; --card: #fff; --text: #1f2937; --muted: #6b7280; --primary: #2563eb; --border: #e5e7eb;
        }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, "Helvetica Neue", sans-serif; background: var(--bg); color: var(--text); margin: 0; }
        .wrapper { max-width: 1200px; margin: 0 auto; padding: 24px; }
        .header { margin-bottom: 16px; }
        .grid { display: grid; grid-template-columns: 1fr 1.5fr; gap: 24px; }
        @media (max-width: 992px) { .grid { grid-template-columns: 1fr; } }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,.03); }
        .title { font-size: 18px; margin: 0 0 12px 0; }
        .muted { color: var(--muted); font-size: 13px; }
        .qr-box { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; }
        .logo-img { max-height: 30px; margin-bottom: 6px; object-fit: contain; }
        .qr-img { width: %spx; height: %spx; image-rendering: pixelated; border: 1px solid var(--border); background: #fff; }
        .actions { display:flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
        .btn { background: var(--primary); color:#fff; border:none; border-radius:8px; padding:10px 16px; cursor:pointer; font-weight:600; }
        .btn.secondary { background:#111827; }
        .btn.outline { background:#fff; color:#111827; border:1px solid var(--border); }
        .pdf-viewer { width: 100%%; height: 75vh; border: 1px solid var(--border); border-radius: 8px; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="header">
            <h2 style="margin:0">Certificado + QR (JavaScript)</h2>
            <p class="muted">Tamaño del QR: <strong>%s</strong> • El QR mostrado es el MISMO que se usa para la verificación.</p>
        </div>

        <div class="grid">
            <!-- Columna izquierda: QR idéntico al original -->
            <div class="card">
                <h3 class="title">Código QR</h3>
                <div class="qr-box">
                    <img class="logo-img" src="%s" alt="Logo" />
                    <img class="qr-img" src="%s" alt="QR de verificación" />
                    <p class="muted" style="margin-top:8px; word-break:break-all; text-align:center">%s</p>
                    <div class="actions">
                        <a class="btn outline" href="%s" target="_blank" rel="noopener">Descargar PDF con QR integrado (Servidor)</a>
                        <button class="btn" id="btn-js">Descargar PDF con QR (JavaScript)</button>
                    </div>
                </div>
            </div>

            <!-- Columna derecha: visor del certificado normal -->
            <div class="card">
                <h3 class="title">Certificado</h3>
                <object class="pdf-viewer" data="%s" type="application/pdf">
                    <p>No se pudo incrustar el PDF en el navegador. <a href="%s" target="_blank">Descargar certificado</a></p>
                </object>
            </div>
        </div>
    </div>

    <script src="/custom_certifica_portal/static/src/js/qr_overlay.js?v=20251030"></script>
    <script>
        const config = {
            pdfUrl: '%s',
            qrText: '%s',
            qrSize: '%s',
            filename: '%s',
            logoSrc: '%s'
        };
        document.getElementById('btn-js').addEventListener('click', async () => {
            try {
                if (!window.qrOverlayManager) throw new Error('qrOverlayManager no inicializado');
                await window.qrOverlayManager.generateQROverlay(config.pdfUrl, config.qrText, config.qrSize, config.filename, config.logoSrc);
            } catch (e) {
                alert('Error generando por JavaScript: ' + e.message);
            }
        });
        </script>
</body>
</html>
        """ % (qr_width, qr_height, qr_size, logo_src, qr_url, xurldownload, overlay_url, pdf_url, pdf_url, pdf_url, xurldownload, qr_size, filename, logo_src)

        return werkzeug.wrappers.Response(
            html_content,
            headers={'Content-Type': 'text/html; charset=utf-8'}
        )
    def download_equipos_patrones_pdf(self,id,**kwargs):
        equipo = request.env['informes.encuestas.equipos'].sudo().search([('id','=',id)],limit=1)
        filename=''
        if equipo.certificado_calibracion:
            if equipo.equipotipo_id.name:
                filename += equipo.equipotipo_id.name+'-'
            if equipo.marca_id.name:
                filename += equipo.marca_id.name+'-'
            if equipo.name:
                filename += equipo.name+'-'
            filename += '.pdf'
        else:
            filename = 'PATRON_SIN_NOMBRE.pdf'

        headers=[('Content-Type', 'application/pdf'),('Content-Disposition', 'filename='+filename)]
        response = werkzeug.wrappers.Response(headers=headers)

        r = equipo.certificado_calibracion
        if r:
            response.data = base64.b64decode(r)
        else:
            response.data = ''
        response.mimetype = 'application/pdf'

        return response

    @http.route('/web/certificado_current/download_pdf/<id>', type='http', auth="public",website=True)
    def download_certificado_current_pdf(self,id,**kwargs):
        certificado = request.env['informes.encuestas.merge'].sudo().search([('id','=',id)],limit=1)

        if certificado.file_name_certificado:
            filename = certificado.file_name_certificado
        else:
            if certificado.codigocliente:
                filename = certificado.codigocliente+'.pdf'
            else:
                filename = 'CERTIFICADO_SIN_CODIGO.pdf'

        r = certificado.x_certificado_publicado_file

        headers=[('Content-Type', 'application/pdf'),('Content-Disposition', 'filename='+filename)]
        response = werkzeug.wrappers.Response(headers=headers)


        if r:
            response.data = base64.b64decode(r)
        else:
            response.data = ''
        response.mimetype = 'application/pdf'

        return response

    @http.route('/web/ultimocertificado/<string:ruta_url>/<string:id>/<string:userid>', type='http', auth="public",website=True)
    def download_certificado_ultimo_pdf(self,**kwargs):

        strurl = kwargs.get('ruta_url')
        strmaquinara_id = kwargs.get('id')
        userid = kwargs.get('userid')
        
        # Logging para diagnóstico
        _logger.info("download_certificado_ultimo_pdf - Parámetros recibidos: ruta_url=%s, id=%s, userid=%s" % (strurl, strmaquinara_id, userid))
        
        # Validación de parámetros obligatorios
        if not strurl:
            _logger.error("download_certificado_ultimo_pdf - Parámetro ruta_url faltante")
            return self._return_error_response("Parámetro ruta_url requerido")
            
        if not strmaquinara_id or strmaquinara_id == 'False':
            _logger.error("download_certificado_ultimo_pdf - Parámetro id inválido: %s" % strmaquinara_id)
            return self._return_error_response("ID de registro inválido")
            
        if not userid or userid == 'False':
            _logger.error("download_certificado_ultimo_pdf - Parámetro userid inválido: %s" % userid)
            return self._return_error_response("ID de usuario inválido")

        # Buscar tipo de documento dinámicamente
        tiposdocumentos, strurl = self._buscar_tipo_documento_dinamico(strurl)
        
        if not tiposdocumentos:
            _logger.error("download_certificado_ultimo_pdf - Tipo de documento no encontrado para ruta: %s" % strurl)
            return self._return_error_response("Tipo de documento no encontrado")
        
        # Conversión segura para evitar excepciones cuando los parámetros no son numéricos
        registro_id = int(strmaquinara_id) if strmaquinara_id and str(strmaquinara_id).isdigit() else False
        cliente_id = int(userid) if userid and str(userid).isdigit() else False
        
        _logger.info("download_certificado_ultimo_pdf - IDs convertidos: registro_id=%s, cliente_id=%s, tipo_doc_id=%s" % (registro_id, cliente_id, tiposdocumentos.id))
        
        # Búsqueda del certificado
        if strurl=='personas':
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                     ('personas_id', '=', registro_id),
                     ('cliente_id', '=', cliente_id)]
        else:
            domain = [('xtipodocumento', '=', tiposdocumentos.id),
                     ('xmaquinaria', '=', registro_id),
                     ('cliente_id', '=', cliente_id)]
        
        _logger.info("download_certificado_ultimo_pdf - Dominio de búsqueda: %s" % domain)
        
        slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain, order='fecha_vigencia desc',limit=1)
        
        # Fallback: intentar con el parent_id del partner si no se encuentra
        if not slide_slide_obj and cliente_id:
            try:
                partner = request.env['res.partner'].sudo().browse(cliente_id)
                if partner and partner.parent_id:
                    domain_parent = [(d[0], d[1], d[2]) for d in domain]
                    for i, d in enumerate(domain_parent):
                        if d[0] == 'cliente_id':
                            domain_parent[i] = ('cliente_id', '=', partner.parent_id.id)
                    _logger.warning("download_certificado_ultimo_pdf - Fallback usando parent_id=%s con dominio: %s" % (partner.parent_id.id, domain_parent))
                    slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(domain_parent, order='fecha_vigencia desc',limit=1)
            except Exception as e:
                _logger.error("download_certificado_ultimo_pdf - Error en fallback parent_id: %s" % str(e))
        
        if not slide_slide_obj:
            _logger.error("download_certificado_ultimo_pdf - No se encontró certificado con dominio: %s" % domain)
            return self._return_error_response("Certificado no encontrado")
        
        _logger.info("download_certificado_ultimo_pdf - Certificado encontrado: ID=%s" % slide_slide_obj.id)

        # Determinar nombre del archivo
        if slide_slide_obj.file_name_certificado:
            filename = slide_slide_obj.file_name_certificado
        else:
            if slide_slide_obj.codigocliente:
                filename = slide_slide_obj.codigocliente+'.pdf'
            else:
                filename = 'CERTIFICADO_SIN_CODIGO.pdf'

        # Verificar si existe el archivo PDF
        r = slide_slide_obj.x_certificado_publicado_file
        if not r:
            _logger.error("download_certificado_ultimo_pdf - Certificado ID=%s no tiene archivo PDF" % slide_slide_obj.id)
            return self._return_error_response("El certificado no tiene archivo PDF asociado")

        # Generar respuesta exitosa
        headers=[('Content-Type', 'application/pdf'),('Content-Disposition', 'filename='+filename)]
        response = werkzeug.wrappers.Response(headers=headers)
        response.data = base64.b64decode(r)
        response.mimetype = 'application/pdf'
        
        _logger.info("download_certificado_ultimo_pdf - PDF generado exitosamente: %s" % filename)
        return response
    
    def _return_error_response(self, error_message):
        """Retorna una respuesta de error HTML en lugar de PDF vacío"""
        html_content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Error</title>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 50px; text-align: center; }
                .error { color: #d32f2f; background: #ffebee; padding: 20px; border-radius: 5px; }
            </style>
        </head>
        <body>
            <div class="error">
                <h2>Error al cargar el certificado</h2>
                <p>%s</p>
                <button onclick="history.back()">Volver</button>
            </div>
        </body>
        </html>
        """ % error_message
        response = werkzeug.wrappers.Response(html_content)
        response.mimetype = 'text/html'
        response.status_code = 400
        return response

    @http.route(['/my/<string:ruta_url>','/my/<string:ruta_url>/page/<int:page>'], type='http', auth="user", methods=['GET'], website=True)
    def preference(self,page=1, date_begin=None, date_end=None, sortby=None, filterby=None,search=None, search_in='all', **kwargs):
        values = self._prepare_portal_layout_values()
        partner_id = request.env.user.partner_id
        _logger.info("ENTRO POR AQUI ..... X2")
        if request.env.user.partner_id.parent_id:
            partner_id = request.env.user.partner_id.parent_id

        strurl = kwargs.get('ruta_url')
        tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', strurl)],limit=1)
        listaids = []
        sedecliente=''
        stridpage=''
        listcertificados = request.env['informes.encuestas.merge'].sudo().search([('xtipodocumento', '=', tiposdocumentos.id),('cliente_id', '=', partner_id.id)])
        if strurl=='personas':
            #Personas de Certifica
            stridpage='custom_certifica_portal.page_personas'
            documentos_ids = listcertificados.mapped('personas_id.id')
            listaids = request.env['res.partner'].sudo().search([('company_type', '=', 'person')])
            domain = [('active', '=', (True)),('id', 'in', documentos_ids)]

            searchbar_inputs = {
                'all': {'input': 'all', 'label': _('Búsqueda en todo')},
                'vat': {'input': 'vat', 'label': _('Búsqueda en DNI')},
                'name': {'input': 'name', 'label': _('Búsqueda en nombre')},
            }

            if search and search_in:
                search_domain = []
                #if search_in in ('name', 'all'):
                if search_in=='vat':
                    search_domain = OR([search_domain, [('vat', 'ilike', search)]])
                if search_in=='name': #Serie
                    search_domain = OR([search_domain, [('name', 'ilike', search)]])
                else:
                    search_domain = OR([search_domain, [('name', 'ilike', search)]])
                    search_domain = OR([search_domain, [('vat', 'ilike', search)]])


                domain += search_domain

            searchbar_sortings = {
                'name': {'label': _('Nombre'), 'order': 'name desc'},
                'dni': {'label': _('DNI'), 'order': 'l10n_latam_identification_type_id desc'},
                #'phone': {'label': _('Telefono'), 'order': 'phone desc'},
                #'email': {'label': _('Email'), 'order': 'email'},
            }

            # default sort by order
            if not sortby:
                sortby = 'name'
            order = searchbar_sortings[sortby]['order']

        else:
            #Certifica y OISO
            documentos_ids = listcertificados.mapped('xmaquinaria.id')
            listaids = request.env['informes.encuestas.maquinarias'].sudo().search([])
            domain = [('active', '=', (True)),('id', 'in', documentos_ids)]

            searchbar_sortings = {
                'equipotipo': {'label': _('Tipo'), 'order': 'equipotipo_id desc'},
                'marca': {'label': _('Marca'), 'order': 'marca_id desc'},
                'modelo': {'label': _('Modelo'), 'order': 'modelo desc'},
                'serie': {'label': _('Serie'), 'order': 'name'},
            }

            # default sort by order
            if not sortby:
                sortby = 'equipotipo'
            order = searchbar_sortings[sortby]['order']

            if strurl in ('fisicos','quimicos','biologicos','ergonomicoypsicosocial'): #CERTIFICA - MAQUINARIA
                stridpage='custom_certifica_portal.page_oiso'
                sedecliente = listcertificados[0].sedecliente
                searchbar_inputs = {
                    'all': {'input': 'all', 'label': _('Búsqueda en todo')},
                    'serie': {'input': 'serie', 'label': _('Búsqueda en serie')},
                    'marca': {'input': 'marca', 'label': _('Búsqueda en marca')},
                }

                if search and search_in:
                    search_domain = []
                    #if search_in in ('name', 'all'):
                    if search_in=='serie':
                        search_domain = OR([search_domain, [('name', 'ilike', search)]])
                    else:
                        search_domain = OR([search_domain, [('name', 'ilike', search)]])
                        search_domain = OR([search_domain, [('equipotipo_id', 'ilike', search)]])
                        search_domain = OR([search_domain, [('marca_id', 'ilike', search)]])
                        search_domain = OR([search_domain, [('modelo', 'ilike', search)]])


                    domain += search_domain

            else: #CERTIFICA - MAQUINARIA
                stridpage='custom_certifica_portal.page'
                searchbar_inputs = {
                    'all': {'input': 'all', 'label': _('Búsqueda en todo')},
                    'serie': {'input': 'serie', 'label': _('Búsqueda en serie')},
                    'marca': {'input': 'marca', 'label': _('Búsqueda en marca')},
                }

                if search and search_in:
                    search_domain = []
                    #if search_in in ('name', 'all'):
                    if search_in=='marca':
                        search_domain = OR([search_domain, [('marca_id', 'ilike', search)]])
                    if search_in=='serie': #Serie
                        search_domain = OR([search_domain, [('name', 'ilike', search)]])
                    else:
                        search_domain = OR([search_domain, [('name', 'ilike', search)]])
                        search_domain = OR([search_domain, [('equipotipo_id', 'ilike', search)]])
                        search_domain = OR([search_domain, [('marca_id', 'ilike', search)]])
                        search_domain = OR([search_domain, [('modelo', 'ilike', search)]])
                        search_domain = OR([search_domain, [('sku', 'ilike', search)]])
                        search_domain = OR([search_domain, [('kit', 'ilike', search)]])
                        search_domain = OR([search_domain, [('observacion', 'ilike', search)]])

                    domain += search_domain


        searchbar_filters = {
            'all': {'label': _('Todo'), 'domain': []},
            'activos': {'label': _('Activos'), 'domain': [('active', 'in', (True))]},
            'inactivos': {'label': _('Inactivos'), 'domain': [('active', 'in', (False))]},
        }

        # default filter by value
        if not filterby:
            filterby = 'all'
        domain += searchbar_filters[filterby]['domain']

        if date_begin and date_end:
            domain += [('create_date', '>', date_begin), ('create_date', '<=', date_end)]

        # count for pager
        maquinas_count = listaids.search_count(domain)
        # pager
        pager = portal_pager(
            url="/my/"+str(strurl),
            url_args={'date_begin': date_begin, 'date_end': date_end, 'sortby': sortby},
            total=maquinas_count,
            page=page,
            step=self._items_per_page
        )

        ''''''''''''''''''


        # content according to pager and archive selected
        listaids = listaids.search(domain, order=order, limit=self._items_per_page, offset=pager['offset'])
        request.session['my_listaids_history'] = listaids.ids[:30]

        values = {
          'date': date_begin,
          'page_name': tiposdocumentos.title,
          'pager': pager,
          'default_url': '/my/'+str(strurl),
          'strurl':str(strurl),
          'searchbar_sortings': searchbar_sortings,
          'sortby': sortby,
          'search': search,
          'search_in': search_in,
          'searchbar_inputs': searchbar_inputs,
          'searchbar_filters': OrderedDict(sorted(searchbar_filters.items())),
          'filterby':filterby,
          'partner_id': partner_id,
          'listmaquinarias_ids': listaids,
          'listpersonas_ids': listaids,
          'sedecliente':sedecliente,
          'tiposdocumentos' : strurl,
          'xtiposdocumentos' : tiposdocumentos,
        }
        _logger.info('ENTRO D3.....>>' + str(strurl))
        


        return request.render(stridpage, values)


    @http.route(['/my/<string:ruta_url>/<int:maquinara_id>','/my/<string:ruta_url>/page/<string:ruta_url_2>/<int:maquinara_id>'], type='http', auth="user",methods=['GET'], website=True)
    def portal_my_maquinarias_detail(self, **kwargs):
        _logger.info('ENTRO T4 .... ')
        partner_id = request.env.user.partner_id
        if request.env.user.partner_id.parent_id:
            partner_id = request.env.user.partner_id.parent_id
        strurl = kwargs.get('ruta_url')
        strmaquinara_id = kwargs.get('maquinara_id')
        
        # Buscar tipo de documento dinámicamente
        tiposdocumentos, strurl = self._buscar_tipo_documento_dinamico(strurl)
        stridpage=''
        persona=''
        maquinaria=''
        if strurl=='personas':
            stridpage='custom_certifica_portal.portal_certificados_page_personas'
            persona = request.env['res.partner'].sudo().search([('id', '=', strmaquinara_id)],limit=1)
            list_certificado_documento_id = request.env['informes.encuestas.merge'].sudo().search([('xtipodocumento', '=', tiposdocumentos.id),('personas_id', '=', strmaquinara_id),('cliente_id', '=', partner_id.id)], order='fecha_vigencia desc')

        else:
            if strurl in ('fisicos','quimicos','biologicos','ergonomicoypsicosocial'):
                stridpage='custom_certifica_portal.portal_certificados_page_oiso'
            else:
                stridpage='custom_certifica_portal.portal_certificados_page'
            list_certificado_documento_id = request.env['informes.encuestas.merge'].sudo().search([('xtipodocumento', '=', tiposdocumentos.id),('xmaquinaria', '=', strmaquinara_id),('cliente_id', '=', partner_id.id)], order='fecha_vigencia desc')
            maquinaria = request.env['informes.encuestas.maquinarias'].sudo().search([('id', '=', strmaquinara_id)],limit=1)

        values={}

        xfecvigencia=''
        xfecmonitoreo=''
        xultimcertificado=''
        idultimocert=0
        xidultimocert=0
        if len(list_certificado_documento_id)>0:
            xidultimocert = list_certificado_documento_id[0]
            idultimocert = list_certificado_documento_id[0].id
            xfecvigencia = list_certificado_documento_id[0].fecha_vigencia
            xfecmonitoreo = list_certificado_documento_id[0].fecha_monitoreo
            xultimcertificado=list_certificado_documento_id[0].codigocliente

        urlbase = request.env['ir.config_parameter'].sudo().search([('key','=','web.base.url')])
        
        # Detectar si estamos en entorno de desarrollo
        base_url = str(urlbase.value)
        if 'tienda-desa.certificalatam.com' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
        elif base_url == 'https://tienda.certificalatam.com' and 'desa' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
            
        xurldownload = base_url+'/web/ultimocertificado/'+str(strurl)+'/'+str(strmaquinara_id)+'/'+str(partner_id.id)

        ultimocert = {
            'fecha_vigencia' :  xfecvigencia,
            'ultima_certificacion' :  xultimcertificado,
            'fecha_certificacion' :  xfecmonitoreo,
        }

        values = {
            'xidultimocert':xidultimocert,
            'tiposdocumentos':strurl,
            'page_name': tiposdocumentos.title,
            'per':persona,
            'maq':maquinaria,
            'urldownload': xurldownload,
            'partner_id': partner_id,
            'ultimocert' :  ultimocert,
            'listcertificados_ids': list_certificado_documento_id,
            'strurl':'/my/'+str(strurl),
            'xtiposdocumentos' : tiposdocumentos,
        }

        return request.render(stridpage, values)


class WebsiteAccount(CustomerPortal):

    def _prepare_portal_layout_values(self):
        partner_id = request.env.user.partner_id

        if request.env.user.partner_id.parent_id:
            partner_id = request.env.user.partner_id.parent_id

        values = super(WebsiteAccount, self)._prepare_portal_layout_values()
        listtipos=[]

        tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo() \
            .search([
            ('active', '=', True),
        ])


        for x in tiposdocumentos:

            listcertificados = request.env['informes.encuestas.merge'].sudo() \
                .search([
                ('xtipodocumento', '=', x.id),
                ('cliente_id', '=', partner_id.id),

            ])

            if x.code=='personas':
                documentos_ids = listcertificados.mapped('personas_id.id')
                delivery_dates_count = len(documentos_ids)
            else:
                documentos_ids = listcertificados.mapped('xmaquinaria.id')
                delivery_dates_count = len(documentos_ids)

            listtipos.append({
                'title':x.title,
                'strurl':'/my/' + x.code,
                'delivery_dates_count': delivery_dates_count,
            })

        values.update({
            'lst':listtipos,
        })

        return values
