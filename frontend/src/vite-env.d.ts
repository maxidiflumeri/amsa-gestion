/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string
    // podés agregar más variables si usás otras
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}  