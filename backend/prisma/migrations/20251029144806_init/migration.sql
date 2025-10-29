-- CreateTable
CREATE TABLE `Empresa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `cuit` VARCHAR(191) NULL,
    `configuracion` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Remesa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `archivo` VARCHAR(191) NULL,
    `estadoCarga` VARCHAR(191) NULL,
    `cantidadDeudores` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Deudor` (
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
    `camposAdicionales` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Comentario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `usuarioId` INTEGER NULL,
    `fecha` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `texto` VARCHAR(191) NOT NULL,
    `origen` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Factura` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `nroFactura` VARCHAR(191) NOT NULL,
    `importe` DOUBLE NOT NULL,
    `fechaEmision` DATETIME(3) NOT NULL,
    `vencimiento` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Pago` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `fecha` DATETIME(3) NOT NULL,
    `importe` DOUBLE NOT NULL,
    `origenArchivo` VARCHAR(191) NULL,
    `observacion` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contacto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `valor` VARCHAR(191) NOT NULL,
    `prioridad` INTEGER NULL,
    `validado` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CampoExtra` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deudorId` INTEGER NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `valor` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Parametro` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NULL,
    `grupo` VARCHAR(191) NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `descripcion` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Remesa` ADD CONSTRAINT `Remesa_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `Empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deudor` ADD CONSTRAINT `Deudor_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `Empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deudor` ADD CONSTRAINT `Deudor_remesaId_fkey` FOREIGN KEY (`remesaId`) REFERENCES `Remesa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deudor` ADD CONSTRAINT `Deudor_estadoSituacionId_fkey` FOREIGN KEY (`estadoSituacionId`) REFERENCES `Parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deudor` ADD CONSTRAINT `Deudor_estadoGestionId_fkey` FOREIGN KEY (`estadoGestionId`) REFERENCES `Parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comentario` ADD CONSTRAINT `Comentario_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `Deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Factura` ADD CONSTRAINT `Factura_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `Deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pago` ADD CONSTRAINT `Pago_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `Deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contacto` ADD CONSTRAINT `Contacto_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `Deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CampoExtra` ADD CONSTRAINT `CampoExtra_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `Deudor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Parametro` ADD CONSTRAINT `Parametro_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `Empresa`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
