-- Migración de permisos en rol.permisos:
--   1) Eliminar permisos reportes.v1.* (módulo v1 removido).
--   2) Renombrar reportes.v2.X → reportes.X (v2 es ahora la versión oficial).

UPDATE rol
SET permisos = CAST(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(
                        REPLACE(
                          REPLACE(
                            REPLACE(
                              REPLACE(
                                REPLACE(
                                  REPLACE(
                                    REPLACE(
                                      REPLACE(
                                        REPLACE(
                                          REPLACE(
                                            REPLACE(
                                              REPLACE(
                                                REPLACE(
                                                  REPLACE(
                                                    CAST(permisos AS CHAR),
                                                    '"reportes.v1.ver", ', ''
                                                  ),
                                                  ', "reportes.v1.ver"', ''
                                                ),
                                                '"reportes.v1.ver"', ''
                                              ),
                                              '"reportes.v1.crear", ', ''
                                            ),
                                            ', "reportes.v1.crear"', ''
                                          ),
                                          '"reportes.v1.crear"', ''
                                        ),
                                        '"reportes.v1.editar", ', ''
                                      ),
                                      ', "reportes.v1.editar"', ''
                                    ),
                                    '"reportes.v1.editar"', ''
                                  ),
                                  '"reportes.v1.eliminar", ', ''
                                ),
                                ', "reportes.v1.eliminar"', ''
                              ),
                              '"reportes.v1.eliminar"', ''
                            ),
                            '"reportes.v1.ejecutar", ', ''
                          ),
                          ', "reportes.v1.ejecutar"', ''
                        ),
                        '"reportes.v1.ejecutar"', ''
                      ),
                      'reportes.v2.ver_ejecuciones', 'reportes.ver_ejecuciones'
                    ),
                    'reportes.v2.gestionar_formatos', 'reportes.gestionar_formatos'
                  ),
                  'reportes.v2.ejecutar', 'reportes.ejecutar'
                ),
                'reportes.v2.eliminar', 'reportes.eliminar'
              ),
              'reportes.v2.editar', 'reportes.editar'
            ),
            'reportes.v2.crear', 'reportes.crear'
          ),
          'reportes.v2.ver', 'reportes.ver'
        ),
        ', ,', ','
      ),
      '[, ', '['
    ),
    ', ]', ']'
  ) AS JSON
)
WHERE JSON_SEARCH(permisos, 'one', 'reportes.v1.%', NULL, '$[*]') IS NOT NULL
   OR JSON_SEARCH(permisos, 'one', 'reportes.v2.%', NULL, '$[*]') IS NOT NULL;

SELECT id, nombre, permisos FROM rol;
