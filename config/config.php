<?php
// ══════════════════════════════════════════════
// config/config.php  –  Configuración general
// ══════════════════════════════════════════════

// Clave de administrador (para registrar sensores)
define('ADMIN_KEY', 'CAMBIA_ESTO_POR_UNA_CLAVE_SEGURA');

// Orígenes permitidos (CORS)
// En producción pon tu dominio: 'https://miltonguerrero.rf.gd'
define('ALLOWED_ORIGIN', '*');

// Zona horaria
date_default_timezone_set('America/Bogota');
