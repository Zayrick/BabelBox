import {resolve} from 'node:path';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, '.'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        allowOnly: false,
        coverage: {
            provider: 'v8',
            enabled: true,
            all: true,
            clean: true,
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts'],
            reportsDirectory: 'coverage',
            reporter: ['text', 'json-summary', 'html'],
        },
    },
});
