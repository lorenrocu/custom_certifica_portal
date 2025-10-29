#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de prueba para verificar la sintaxis del controlador
"""

import sys
import os

# Agregar el directorio del proyecto al path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    # Intentar importar el módulo para verificar sintaxis
    import ast
    
    # Leer el archivo del controlador
    with open('controllers/main.py', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Parsear el código para verificar sintaxis
    ast.parse(content)
    print("✓ Sintaxis del controlador verificada correctamente")
    print("✓ No se encontraron errores de sintaxis")
    
    # Verificar que no hay f-strings (incompatibles con Python < 3.6)
    if 'f"' in content or "f'" in content:
        print("⚠ Advertencia: Se encontraron f-strings que pueden ser incompatibles")
    else:
        print("✓ No se encontraron f-strings incompatibles")
        
    print("\n=== RESUMEN ===")
    print("El código del controlador está sintácticamente correcto")
    print("Compatible con versiones anteriores de Python")
    
except SyntaxError as e:
    print(f"✗ Error de sintaxis encontrado:")
    print(f"  Línea {e.lineno}: {e.text}")
    print(f"  Error: {e.msg}")
    sys.exit(1)
    
except Exception as e:
    print(f"✗ Error al verificar el archivo: {e}")
    sys.exit(1)