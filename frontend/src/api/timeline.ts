import api from './axios';
import type { TimelineQuery, TimelineResponse } from '../types/timeline';

export const timelineApi = {
    porDeudor(deudorId: number, query: TimelineQuery = {}): Promise<TimelineResponse> {
        return api.get(`/timeline/deudores/${deudorId}`, { params: query }).then((r) => r.data);
    },
};
