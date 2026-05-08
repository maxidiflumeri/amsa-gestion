import { useContext, useEffect } from 'react';
import { PageMetaContext } from '../context/PageMetaContext';

export function usePageTitle(title: string) {
    const { setPageMeta } = useContext(PageMetaContext);

    useEffect(() => {
        setPageMeta({ title });
        document.title = `${title} — AMSA Gestión`;
    }, [title, setPageMeta]);
}
