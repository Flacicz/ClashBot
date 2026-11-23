import type { SyncResult } from './syncResult.js';

export interface SyncService {
    getServiceName(): string;
    updateData(clanTag: string, signal?: AbortSignal): Promise<SyncResult>;
}
