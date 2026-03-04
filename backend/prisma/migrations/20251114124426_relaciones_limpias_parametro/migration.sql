-- DropForeignKey
ALTER TABLE `deudor` DROP FOREIGN KEY `Deudor_estadoGestionId_fkey`;

-- DropForeignKey
ALTER TABLE `deudor` DROP FOREIGN KEY `Deudor_estadoSituacionId_fkey`;

-- AddForeignKey
ALTER TABLE `deudor` ADD CONSTRAINT `deudor_estadoSituacionId_fkey` FOREIGN KEY (`estadoSituacionId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deudor` ADD CONSTRAINT `deudor_estadoGestionId_fkey` FOREIGN KEY (`estadoGestionId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
