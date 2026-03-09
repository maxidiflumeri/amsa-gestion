import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function clean() {
    try {
        console.log('Limpiando base de datos...');
        
        // Tablas dependientes de deudor
        await prisma.transaccion.deleteMany();
        console.log('- Transacciones eliminadas');

        await prisma.comentario.deleteMany();
        console.log('- Comentarios eliminados');

        await prisma.campoextra.deleteMany();
        console.log('- Campos extras eliminados');

        await prisma.pago.deleteMany();
        console.log('- Pagos eliminados');

        await prisma.contacto.deleteMany();
        console.log('- Contactos eliminados');

        await prisma.factura.deleteMany();
        console.log('- Facturas eliminadas');

        // Tabla principal
        await prisma.deudor.deleteMany();
        console.log('- Deudores eliminados');

        // Tablas dependientes de remesas
        await prisma.importerror.deleteMany();
        await prisma.jobimport.deleteMany();
        
        // Remesas
        await prisma.remesa.deleteMany();
        console.log('- Remesas eliminadas');

        console.log('\n¡Base de datos limpia lista para cargar desde 0!');
    } catch (e) {
        console.error('Error al limpiar:', e);
    } finally {
        await prisma.$disconnect();
    }
}

clean();
