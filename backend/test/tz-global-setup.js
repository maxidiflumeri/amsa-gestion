// Los tests de fechas (días calendario, bordes de medianoche) asumen la zona del contenedor de prod
// (Dockerfile.backend: TZ=America/Argentina/Buenos_Aires). globalSetup corre antes de crear los workers de jest, que
// heredan el entorno: un `process.env.TZ` puesto adentro de un spec llega tarde.
module.exports = async () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
};
