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
            mapeo_directo = {
                'elementosdeizaje': 'mediciondeequipo',
                'equiposdemedicion': 'mediciondeequipo',
            }
            
            # Verificar mapeo directo primero
            if strurl in mapeo_directo:
                nuevo_tipo = mapeo_directo[strurl]
                _logger.info("_buscar_tipo_documento_dinamico - Usando mapeo directo: '%s' -> '%s'" % (strurl, nuevo_tipo))
                tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', nuevo_tipo)],limit=1)
                if tiposdocumentos:
                    _logger.info("_buscar_tipo_documento_dinamico - Mapeo directo exitoso")
                    return tiposdocumentos, nuevo_tipo
            
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

        urlbase = request.env['ir.config_parameter'].sudo().search([('key','=','web.base.url')])
        
        # Detectar si estamos en entorno de desarrollo
        base_url = str(urlbase.value)
        if 'tienda-desa.certificalatam.com' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
        elif base_url == 'https://tienda.certificalatam.com' and 'desa' in request.httprequest.host:
            base_url = 'https://tienda-desa.certificalatam.com'
            
        if strurlruta=='personas':
            xurldownload = base_url+'/web/certificado_current/download_pdf/'+str(idcertificado)
        else:
            xurldownload = base_url+'/web/ultimocertificado/'+str(strurlruta)+'/'+str(xid)+'/'+str(xuserid)
        if strurl=='print_qr15':
            w=63
            h=63
        if strurl=='print_qr35':
            w=147
            h=147
        if strurl=='print_qr50':
            w=210
            h=210
        if strurl=='print_qr95':
            w=370
            h=370

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

    @http.route('/web/equipos/download_pdf/<id>', type='http', auth="public",website=True)
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
