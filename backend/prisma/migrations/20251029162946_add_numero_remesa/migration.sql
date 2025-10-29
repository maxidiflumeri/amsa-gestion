/*
  Warnings:

  - A unique constraint covering the columns `[numeroRemesa]` on the table `Remesa` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `numeroRemesa` to the `Remesa` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `remesa` ADD COLUMN `numeroRemesa` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Remesa_numeroRemesa_key` ON `Remesa`(`numeroRemesa`);
