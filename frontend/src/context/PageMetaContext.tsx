import React, { createContext, useContext, useState, useCallback } from 'react';

export interface BreadcrumbItem {
    label: string;
    href?: string;
}

export interface PageAction {
    label: string;
    onClick: () => void;
    variant?: 'contained' | 'outlined' | 'text';
    startIcon?: React.ReactNode;
    disabled?: boolean;
}

export interface PageMetaState {
    title: string;
    breadcrumbs: BreadcrumbItem[];
    actions: PageAction[];
}

interface PageMetaContextType extends PageMetaState {
    setPageMeta: (meta: Partial<PageMetaState>) => void;
    clearPageMeta: () => void;
}

const defaultMeta: PageMetaState = {
    title: '',
    breadcrumbs: [],
    actions: [],
};

export const PageMetaContext = createContext<PageMetaContextType>({
    ...defaultMeta,
    setPageMeta: () => {},
    clearPageMeta: () => {},
});

export const usePageMeta = (meta?: Partial<PageMetaState>) => {
    const context = useContext(PageMetaContext);
    React.useEffect(() => {
        if (meta) {
            context.setPageMeta(meta);
            if (meta.title) {
                document.title = `${meta.title} — AMSA Gestión`;
            }
            return () => {
                context.clearPageMeta();
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return context;
};

export const PageMetaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [meta, setMetaState] = useState<PageMetaState>(defaultMeta);

    const setPageMeta = useCallback((newMeta: Partial<PageMetaState>) => {
        setMetaState((prev) => ({ ...prev, ...newMeta }));
    }, []);

    const clearPageMeta = useCallback(() => {
        setMetaState(defaultMeta);
    }, []);

    return (
        <PageMetaContext.Provider value={{ ...meta, setPageMeta, clearPageMeta }}>
            {children}
        </PageMetaContext.Provider>
    );
};
