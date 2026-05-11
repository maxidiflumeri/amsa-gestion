-- CreateTable
CREATE TABLE `campoextra` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `valor` VARCHAR(191) NOT NULL,

    INDEX `CampoExtra_deudorId_fkey`(`deudorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comentario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `usuarioId` INTEGER NULL,
    `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `texto` VARCHAR(191) NOT NULL,
    `origen` VARCHAR(191) NULL,

    INDEX `Comentario_deudorId_fkey`(`deudorId`),
    INDEX `Comentario_usuarioId_fkey`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contacto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `valor` VARCHAR(191) NOT NULL,
    `prioridad` INTEGER NULL,
    `validado` BOOLEAN NOT NULL DEFAULT false,
    `subtipo` VARCHAR(191) NULL,
    `whatsapp` BOOLEAN NOT NULL DEFAULT false,

    INDEX `Contacto_deudorId_tipo_idx`(`deudorId`, `tipo`),
    UNIQUE INDEX `Contacto_deudorId_tipo_valor_key`(`deudorId`, `tipo`, `valor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deudor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `remesaId` INTEGER NOT NULL,
    `documento` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `apellido` VARCHAR(191) NOT NULL,
    `montoTotal` DOUBLE NULL,
    `fechaVencimiento` DATETIME(3) NULL,
    `estadoSituacionId` INTEGER NULL,
    `estadoGestionId` INTEGER NULL,
    `motivoNoPagoId` INTEGER NULL,
    `camposAdicionales` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Deudor_documento_idx`(`documento`),
    INDEX `Deudor_empresaId_remesaId_idx`(`empresaId`, `remesaId`),
    INDEX `Deudor_estadoGestionId_fkey`(`estadoGestionId`),
    INDEX `Deudor_estadoSituacionId_fkey`(`estadoSituacionId`),
    INDEX `Deudor_motivoNoPagoId_fkey`(`motivoNoPagoId`),
    INDEX `Deudor_remesaId_fkey`(`remesaId`),
    UNIQUE INDEX `Deudor_empresaId_documento_remesaId_key`(`empresaId`, `documento`, `remesaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `empresa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `cuit` VARCHAR(191) NULL,
    `configuracion` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Empresa_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `factura` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `nroFactura` VARCHAR(191) NOT NULL,
    `importe` DOUBLE NOT NULL,
    `fechaEmision` DATETIME(3) NOT NULL,
    `vencimiento` DATETIME(3) NOT NULL,
    `estado` VARCHAR(191) NULL,
    `externalId` VARCHAR(191) NULL,

    UNIQUE INDEX `Factura_deudorId_nroFactura_key`(`deudorId`, `nroFactura`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `importerror` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remesaId` INTEGER NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `rawRow` JSON NOT NULL,
    `errorMsg` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ImportError_remesaId_rowNumber_idx`(`remesaId`, `rowNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobimport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remesaId` INTEGER NOT NULL,
    `estado` ENUM('PENDIENTE', 'VALIDANDO', 'PROCESANDO', 'FINALIZADA', 'FALLIDA') NOT NULL DEFAULT 'PENDIENTE',
    `progreso` INTEGER NOT NULL DEFAULT 0,
    `log` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `JobImport_remesaId_fkey`(`remesaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pago` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `fecha` DATETIME(3) NOT NULL,
    `importe` DOUBLE NOT NULL,
    `origenArchivo` VARCHAR(191) NULL,
    `observacion` VARCHAR(191) NULL,

    INDEX `Pago_deudorId_fkey`(`deudorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `parametro` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grupo` VARCHAR(191) NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `descripcion` VARCHAR(191) NOT NULL,
    `padreId` INTEGER NULL,
    `categoria` VARCHAR(191) NULL,
    `esGlobal` BOOLEAN NOT NULL DEFAULT true,
    `activo` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Parametro_clave_key`(`clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `empresa_parametro` (
    `empresaId` INTEGER NOT NULL,
    `parametroId` INTEGER NOT NULL,
    `nombreOverride` VARCHAR(191) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,

    INDEX `empresa_parametro_empresaId_idx`(`empresaId`),
    INDEX `empresa_parametro_parametroId_idx`(`parametroId`),
    PRIMARY KEY (`empresaId`, `parametroId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plantillaimport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `categoria` ENUM('DEUDORES', 'FACTURAS', 'ENRIQUECIMIENTO', 'PAGOS', 'CONTACTOS', 'DEUDORES_Y_FACTURAS', 'ACTUALIZACIONES') NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `separador` VARCHAR(191) NOT NULL DEFAULT '|',
    `tieneHeader` BOOLEAN NOT NULL DEFAULT false,
    `mappingJson` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlantillaImport_empresaId_categoria_idx`(`empresaId`, `categoria`),
    UNIQUE INDEX `unique_empresa_nombre_version`(`empresaId`, `nombre`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remesa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `archivo` VARCHAR(191) NULL,
    `estadoCarga` VARCHAR(191) NULL,
    `cantidadDeudores` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `numeroRemesa` VARCHAR(191) NOT NULL,
    `archivoHash` VARCHAR(191) NULL,
    `categoria` ENUM('DEUDORES', 'FACTURAS', 'ENRIQUECIMIENTO', 'PAGOS', 'CONTACTOS', 'DEUDORES_Y_FACTURAS', 'ACTUALIZACIONES') NULL,
    `errFilas` INTEGER NOT NULL DEFAULT 0,
    `estadoProceso` ENUM('PENDIENTE', 'VALIDANDO', 'PROCESANDO', 'FINALIZADA', 'FALLIDA') NOT NULL DEFAULT 'PENDIENTE',
    `okFilas` INTEGER NOT NULL DEFAULT 0,
    `plantillaId` INTEGER NULL,
    `totalFilas` INTEGER NOT NULL DEFAULT 0,
    `hoja` VARCHAR(191) NULL,
    `fechaVencimiento` DATETIME(3) NULL,
    `politicaId` INTEGER NULL,

    INDEX `Remesa_empresaId_categoria_idx`(`empresaId`, `categoria`),
    INDEX `Remesa_plantillaId_fkey`(`plantillaId`),
    INDEX `remesa_politicaId_idx`(`politicaId`),
    UNIQUE INDEX `Remesa_empresaId_numeroRemesa_key`(`empresaId`, `numeroRemesa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transaccion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usuarioId` INTEGER NOT NULL,
    `deudorId` INTEGER NULL,
    `entidad` VARCHAR(191) NOT NULL,
    `entidadId` VARCHAR(191) NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `resumen` VARCHAR(191) NULL,
    `data` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,

    INDEX `Transaccion_deudorId_createdAt_idx`(`deudorId`, `createdAt`),
    INDEX `Transaccion_entidad_entidadId_idx`(`entidad`, `entidadId`),
    INDEX `Transaccion_tipo_createdAt_idx`(`tipo`, `createdAt`),
    INDEX `Transaccion_usuarioId_createdAt_idx`(`usuarioId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rol` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `permisos` JSON NOT NULL,
    `creadoAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rol_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usuario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `googleId` VARCHAR(191) NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `avatarUrl` VARCHAR(191) NULL,
    `rol` VARCHAR(191) NOT NULL DEFAULT 'usuario',
    `rolId` INTEGER NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Usuario_googleId_key`(`googleId`),
    UNIQUE INDEX `Usuario_email_key`(`email`),
    INDEX `usuario_rolId_idx`(`rolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `politica` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `formasDePago` TEXT NULL,
    `tipoAtencion` TEXT NULL,
    `datosExtra` JSON NULL,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `politica_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `convenio` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `usuarioId` INTEGER NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'ACTIVO',
    `montoTotal` DOUBLE NOT NULL,
    `cantCuotas` INTEGER NOT NULL,
    `montoCuota` DOUBLE NOT NULL,
    `fechaInicio` DATETIME(3) NOT NULL,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `convenio_deudorId_idx`(`deudorId`),
    INDEX `convenio_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cuota_convenio` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `convenioId` INTEGER NOT NULL,
    `nroCuota` INTEGER NOT NULL,
    `fechaVencimiento` DATETIME(3) NOT NULL,
    `importe` DOUBLE NOT NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'PENDIENTE',
    `fechaPago` DATETIME(3) NULL,

    INDEX `cuota_convenio_convenioId_idx`(`convenioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plantilla_reporte` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `fuente` VARCHAR(191) NOT NULL,
    `filtrosFijos` JSON NOT NULL,
    `filtrosVars` JSON NOT NULL,
    `columnas` JSON NOT NULL,
    `formatoSalida` VARCHAR(191) NOT NULL,
    `opcionesExcel` JSON NULL,
    `opcionesPdf` JSON NULL,
    `empresaId` INTEGER NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `plantilla_reporte_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ejecucion_reporte` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `plantillaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `filtrosUsados` JSON NOT NULL,
    `totalFilas` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ejecucion_reporte_plantillaId_idx`(`plantillaId`),
    INDEX `ejecucion_reporte_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `formato_telefono` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` VARCHAR(191) NULL,
    `patron` VARCHAR(191) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `formato_telefono_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plantilla_reporte_v2` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `raiz` VARCHAR(191) NOT NULL DEFAULT 'deudor',
    `empresaId` INTEGER NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `definicion` JSON NOT NULL,
    `formatoSalida` VARCHAR(191) NOT NULL,
    `opcionesFormato` JSON NULL,
    `creadoPorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `plantilla_reporte_v2_empresaId_idx`(`empresaId`),
    INDEX `plantilla_reporte_v2_activo_idx`(`activo`),
    INDEX `plantilla_reporte_v2_creadoPorId_idx`(`creadoPorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ejecucion_reporte_v2` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `plantillaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `empresaId` INTEGER NULL,
    `filtrosUsados` JSON NOT NULL,
    `totalFilas` INTEGER NULL,
    `filasProcesadas` INTEGER NOT NULL DEFAULT 0,
    `progreso` INTEGER NOT NULL DEFAULT 0,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'PENDIENTE',
    `modo` VARCHAR(191) NOT NULL DEFAULT 'SYNC',
    `formato` VARCHAR(191) NULL,
    `archivoPath` VARCHAR(191) NULL,
    `archivoTamano` INTEGER NULL,
    `errorMsg` TEXT NULL,
    `cancelado` BOOLEAN NOT NULL DEFAULT false,
    `duracionMs` INTEGER NULL,
    `jobId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `iniciadoEn` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `ejecucion_reporte_v2_plantillaId_idx`(`plantillaId`),
    INDEX `ejecucion_reporte_v2_usuarioId_createdAt_idx`(`usuarioId`, `createdAt`),
    INDEX `ejecucion_reporte_v2_estado_idx`(`estado`),
    INDEX `ejecucion_reporte_v2_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `campoextra` ADD CONSTRAINT `CampoExtra_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comentario` ADD CONSTRAINT `Comentario_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comentario` ADD CONSTRAINT `Comentario_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contacto` ADD CONSTRAINT `Contacto_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deudor` ADD CONSTRAINT `Deudor_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deudor` ADD CONSTRAINT `Deudor_remesaId_fkey` FOREIGN KEY (`remesaId`) REFERENCES `remesa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deudor` ADD CONSTRAINT `deudor_estadoGestionId_fkey` FOREIGN KEY (`estadoGestionId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deudor` ADD CONSTRAINT `deudor_estadoSituacionId_fkey` FOREIGN KEY (`estadoSituacionId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deudor` ADD CONSTRAINT `deudor_motivoNoPagoId_fkey` FOREIGN KEY (`motivoNoPagoId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `factura` ADD CONSTRAINT `Factura_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `importerror` ADD CONSTRAINT `ImportError_remesaId_fkey` FOREIGN KEY (`remesaId`) REFERENCES `remesa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobimport` ADD CONSTRAINT `JobImport_remesaId_fkey` FOREIGN KEY (`remesaId`) REFERENCES `remesa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pago` ADD CONSTRAINT `Pago_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `parametro` ADD CONSTRAINT `parametro_padreId_fkey` FOREIGN KEY (`padreId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `empresa_parametro` ADD CONSTRAINT `empresa_parametro_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `empresa_parametro` ADD CONSTRAINT `empresa_parametro_parametroId_fkey` FOREIGN KEY (`parametroId`) REFERENCES `parametro`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantillaimport` ADD CONSTRAINT `PlantillaImport_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remesa` ADD CONSTRAINT `Remesa_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remesa` ADD CONSTRAINT `Remesa_plantillaId_fkey` FOREIGN KEY (`plantillaId`) REFERENCES `plantillaimport`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remesa` ADD CONSTRAINT `remesa_politicaId_fkey` FOREIGN KEY (`politicaId`) REFERENCES `politica`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaccion` ADD CONSTRAINT `Transaccion_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `deudor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaccion` ADD CONSTRAINT `Transaccion_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usuario` ADD CONSTRAINT `usuario_rolId_fkey` FOREIGN KEY (`rolId`) REFERENCES `rol`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `politica` ADD CONSTRAINT `politica_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `convenio` ADD CONSTRAINT `convenio_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `convenio` ADD CONSTRAINT `convenio_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuota_convenio` ADD CONSTRAINT `cuota_convenio_convenioId_fkey` FOREIGN KEY (`convenioId`) REFERENCES `convenio`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantilla_reporte` ADD CONSTRAINT `plantilla_reporte_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresa`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ejecucion_reporte` ADD CONSTRAINT `ejecucion_reporte_plantillaId_fkey` FOREIGN KEY (`plantillaId`) REFERENCES `plantilla_reporte`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ejecucion_reporte` ADD CONSTRAINT `ejecucion_reporte_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantilla_reporte_v2` ADD CONSTRAINT `plantilla_reporte_v2_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresa`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantilla_reporte_v2` ADD CONSTRAINT `plantilla_reporte_v2_creadoPorId_fkey` FOREIGN KEY (`creadoPorId`) REFERENCES `usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ejecucion_reporte_v2` ADD CONSTRAINT `ejecucion_reporte_v2_plantillaId_fkey` FOREIGN KEY (`plantillaId`) REFERENCES `plantilla_reporte_v2`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ejecucion_reporte_v2` ADD CONSTRAINT `ejecucion_reporte_v2_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

