import { describe, expect, it } from 'vitest';

import {
    AbortError,
    AppError,
    ConfigError,
    DatabaseError,
    DomainError,
    ExternalApiError,
    ValidationError,
    isAbortError,
} from '../../src/common/errors.js';

describe('Application error hierarchy', () => {
    it('constructs AppError subclasses with code, message, cause, and context', () => {
        const rootCause = new Error('root cause');
        const err = new ConfigError('Invalid configuration', {
            cause: rootCause,
            context: { path: 'config.json' },
        });

        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.name).toBe('ConfigError');
        expect(err.code).toBe('CONFIG_ERROR');
        expect(err.message).toBe('Invalid configuration');
        expect(err.cause).toBe(rootCause);
        expect(err.context).toEqual({ path: 'config.json' });
    });

    it('sets distinct codes and names for all specialized error types', () => {
        expect(new ValidationError('bad input').code).toBe('VALIDATION_ERROR');
        expect(new DatabaseError('sqlite busy').code).toBe('DATABASE_ERROR');
        expect(new DomainError('invalid transition').code).toBe('DOMAIN_ERROR');

        const apiError = new ExternalApiError('rate limited', {
            statusCode: 429,
            retryable: true,
        });
        expect(apiError).toBeInstanceOf(AppError);
        expect(apiError.code).toBe('EXTERNAL_API_ERROR');
        expect(apiError.statusCode).toBe(429);
        expect(apiError.retryable).toBe(true);
    });

    it('defaults ExternalApiError.retryable to false', () => {
        const apiError = new ExternalApiError('not found', { statusCode: 404 });
        expect(apiError.retryable).toBe(false);
    });

    it('detects AbortError instances and native DOMException AbortError', () => {
        expect(isAbortError(new AbortError())).toBe(true);
        expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
        expect(isAbortError(new ConfigError('not abort'))).toBe(false);
        expect(isAbortError(new Error('generic'))).toBe(false);
        expect(isAbortError('AbortError')).toBe(false);
        expect(isAbortError(null)).toBe(false);
    });
});
