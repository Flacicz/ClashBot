export interface AppErrorOptions {
    readonly cause?: unknown;
    readonly context?: Readonly<Record<string, unknown>>;
}

export class AppError extends Error {
    readonly code: string;
    readonly context?: Readonly<Record<string, unknown>>;

    constructor(code: string, message: string, options?: AppErrorOptions) {
        super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = new.target.name;
        this.code = code;
        if (options?.context !== undefined) {
            this.context = options.context;
        }
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class ConfigError extends AppError {
    constructor(message: string, options?: AppErrorOptions) {
        super('CONFIG_ERROR', message, options);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, options?: AppErrorOptions) {
        super('VALIDATION_ERROR', message, options);
    }
}

export class AbortError extends AppError {
    constructor(message = 'Operation was aborted', options?: AppErrorOptions) {
        super('ABORT_ERROR', message, options);
    }
}

export interface DatabaseErrorOptions extends AppErrorOptions {
    readonly sqliteCode?: string;
}

export class DatabaseError extends AppError {
    readonly sqliteCode?: string;

    constructor(message: string, options?: DatabaseErrorOptions) {
        super('DATABASE_ERROR', message, options);
        if (options?.sqliteCode !== undefined) {
            this.sqliteCode = options.sqliteCode;
        }
    }

    isBusy(): boolean {
        return (
            this.sqliteCode === 'SQLITE_BUSY' ||
            (this.sqliteCode?.startsWith('SQLITE_BUSY_') ?? false)
        );
    }
}

export class DomainError extends AppError {
    constructor(message: string, options?: AppErrorOptions) {
        super('DOMAIN_ERROR', message, options);
    }
}

export interface ExternalApiErrorOptions extends AppErrorOptions {
    readonly statusCode?: number;
    readonly retryable?: boolean;
}

export class ExternalApiError extends AppError {
    readonly statusCode?: number;
    readonly retryable: boolean;

    constructor(message: string, options?: ExternalApiErrorOptions) {
        super('EXTERNAL_API_ERROR', message, options);
        if (options?.statusCode !== undefined) {
            this.statusCode = options.statusCode;
        }
        this.retryable = options?.retryable ?? false;
    }
}

export function isAbortError(error: unknown): boolean {
    if (error instanceof AbortError) {
        return true;
    }
    if (error instanceof Error && error.name === 'AbortError') {
        return true;
    }
    return false;
}
