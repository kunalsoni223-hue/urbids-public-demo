import { config } from '../config.js';

export function formatCurrency(amount) {
    return new Intl.NumberFormat(config.locale, {
        style: 'currency',
        currency: config.currency,
        maximumFractionDigits: 0
    }).format(amount);
}

export function localDateValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatTimeRemaining(endsAt, now = Date.now()) {
    const endTime = Date.parse(endsAt);
    if (!Number.isFinite(endTime)) return 'Time unavailable';

    const remainingSeconds = Math.max(0, Math.floor((endTime - now) / 1000));
    if (remainingSeconds === 0) return 'Ended';
    const days = Math.floor(remainingSeconds / 86400);
    const hours = Math.floor((remainingSeconds % 86400) / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    if (remainingSeconds > 86400) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}