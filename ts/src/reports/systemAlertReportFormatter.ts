import { escapeHtml } from '../common/formatUtils.js';
import type { SyncFailureEvent, SyncRecoveryEvent } from '../events/applicationEvents.js';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SystemAlertReportFormatter {
    static formatFailureAlert(event: SyncFailureEvent): string {
        return (
            '🚨 <b>ОШИБКА СИНХРОНИЗАЦИИ</b>\n\n' +
            `Клан: <code>${escapeHtml(event.clanTag)}</code>\n` +
            `Сервис: <code>${escapeHtml(event.serviceName)}</code>\n` +
            `Попытка: ${String(event.attempts)}\n` +
            `Ошибка: <code>${escapeHtml(event.errorMsg)}</code>`
        );
    }

    static formatRecoveryAlert(event: SyncRecoveryEvent): string {
        return (
            '✅ <b>СИНХРОНИЗАЦИЯ ВОССТАНОВЛЕНА</b>\n\n' +
            `Клан: <code>${escapeHtml(event.clanTag)}</code>\n` +
            `Сервис: <code>${escapeHtml(event.serviceName)}</code>`
        );
    }
}
