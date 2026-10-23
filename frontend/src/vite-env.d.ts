/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string
    // podés agregar más variables si usás otras
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}  