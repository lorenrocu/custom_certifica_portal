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

    def render_qweb_html(self, docids, data=None):
        if self.report_name == 'custom_certifica_portal.report_qrcode_card15_backend':
            docs = self.env[self.model].browse(docids)
            doc = docs[0]
            content = doc.xurldownload
            return (content, 'text/plain')
        return super(ProductPlannerPortal, self).render_qweb_html(docids, data)

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
        if strurlruta=='personas':
            xurldownload = str(urlbase.value)+'/web/certificado_current/download_pdf/'+str(idcertificado)
        else:
            xurldownload = str(urlbase.value)+'/web/ultimocertificado/'+str(strurlruta)+'/'+str(xid)+'/'+str(xuserid)
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
        if strurlruta=='personas':
            certificado = request.env['informes.encuestas.merge'].sudo().search(
                [('personas_id', '=', int(xid))], order='fecha_vigencia desc',limit=1)
        else:
            certificado = request.env['informes.encuestas.merge'].sudo().search(
                [('xmaquinaria', '=', int(xid))], order='fecha_vigencia desc',limit=1)

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
        tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', strurl)],limit=1)
        userid = kwargs.get('userid')
        if strurl=='personas':
            slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(
                [('xtipodocumento', '=', tiposdocumentos.id),
                 ('personas_id', '=', int(strmaquinara_id)),
                 ('cliente_id', '=', int(userid))], order='fecha_vigencia desc',limit=1)
        else:
            slide_slide_obj = request.env['informes.encuestas.merge'].sudo().search(
                [('xtipodocumento', '=', tiposdocumentos.id),
                 ('xmaquinaria', '=', int(strmaquinara_id)),
                 ('cliente_id', '=', int(userid))], order='fecha_vigencia desc',limit=1)

        if slide_slide_obj.file_name_certificado:
            filename = slide_slide_obj.file_name_certificado
        else:
            if slide_slide_obj.codigocliente:
                filename = slide_slide_obj.codigocliente+'.pdf'
            else:
                filename = 'CERTIFICADO_SIN_CODIGO.pdf'

        headers=[('Content-Type', 'application/pdf'),('Content-Disposition', 'filename='+filename)]
        response = werkzeug.wrappers.Response(headers=headers)

        r = slide_slide_obj.x_certificado_publicado_file
        if r:
            response.data = base64.b64decode(r)
        else:
            response.data = ''
        response.mimetype = 'application/pdf'
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
                # Evitar IndexError cuando no hay certificados
                sedecliente = listcertificados[0].sedecliente if len(listcertificados) > 0 else ''
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
        tiposdocumentos = request.env['informes.encuestas.tipo.encuesta.portal'].sudo().search([('active', '=', True),('code', '=', strurl)],limit=1)
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
        xurldownload = str(urlbase.value)+'/web/ultimocertificado/'+str(strurl)+'/'+str(strmaquinara_id)+'/'+str(partner_id.id)

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

            # Evitar errores si el campo code no es una cadena válida
            code = x.code if isinstance(x.code, str) and x.code.strip() else None
            if not code:
                _logger.warning('Tipo de encuesta portal con code inválido: id=%s, code=%s. Se omite en el menú del portal.', x.id, x.code)
                continue

            listtipos.append({
                'title': x.title,
                'strurl': '/my/' + code,
                'delivery_dates_count': delivery_dates_count,
            })

        values.update({
            'lst':listtipos,
        })

        return values
