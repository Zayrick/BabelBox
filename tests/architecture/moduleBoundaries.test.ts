import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';
import {describe, expect, it} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '../..');

function projectPath(...parts: string[]): string {
    return resolve(PROJECT_ROOT, ...parts);
}

function relativePath(path: string): string {
    return relative(PROJECT_ROOT, path).split(sep).join('/');
}

function listSourceFiles(directory: string): string[] {
    const files: string[] = [];
    const visit = (current: string) => {
        for (const name of readdirSync(current)) {
            const absolute = resolve(current, name);
            if (statSync(absolute).isDirectory()) visit(absolute);
            else if (/\.(?:ts|vue)$/u.test(name) && !name.endsWith('.d.ts')) files.push(absolute);
        }
    };
    visit(projectPath(directory));
    return files.sort();
}

function importSpecifiers(path: string): string[] {
    const source = readFileSync(path, 'utf8');
    const imports = new Set<string>();
    const pattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/gu;
    let match = pattern.exec(source);
    while (match) {
        imports.add(match[1]);
        match = pattern.exec(source);
    }
    return [...imports];
}

function resolveProjectImport(fromFile: string, specifier: string): string | null {
    const unresolved = specifier.startsWith('@/')
        ? projectPath(specifier.slice(2))
        : specifier.startsWith('.')
            ? resolve(dirname(fromFile), specifier)
            : null;
    if (!unresolved) return null;

    for (const candidate of [
        unresolved,
        `${unresolved}.ts`,
        `${unresolved}.vue`,
        resolve(unresolved, 'index.ts'),
        resolve(unresolved, 'index.vue'),
    ]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
}

function forbiddenImports(directory: string, pattern: RegExp): string[] {
    return listSourceFiles(directory).flatMap((file) =>
        importSpecifiers(file)
            .filter((specifier) => pattern.test(specifier))
            .map((specifier) => `${relativePath(file)} -> ${specifier}`),
    );
}

describe('module boundaries', () => {
    it('WXT entrypoints delegate product code to app composition roots', () => {
        const violations = listSourceFiles('entrypoints').flatMap((file) =>
            importSpecifiers(file)
                .filter((specifier) => specifier.startsWith('@/src/') && !specifier.startsWith('@/src/app/'))
                .map((specifier) => `${relativePath(file)} -> ${specifier}`),
        );

        expect(violations).toEqual([]);
    });

    it('internal modules do not depend on WXT entrypoint implementations', () => {
        expect([
            ...forbiddenImports('src', /^@\/entrypoints\//u),
            ...forbiddenImports('userscript', /^@\/entrypoints\//u),
        ]).toEqual([]);
    });

    it('the src dependency graph has no cross-file cycles', () => {
        const files = listSourceFiles('src');
        const sourceSet = new Set(files);
        const graph = new Map(files.map((file) => [
            file,
            importSpecifiers(file)
                .map((specifier) => resolveProjectImport(file, specifier))
                .filter((target): target is string => Boolean(target) && sourceSet.has(target as string)),
        ]));
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const stack: string[] = [];
        const cycles: string[] = [];

        const visit = (file: string) => {
            if (visited.has(file)) return;
            if (visiting.has(file)) {
                cycles.push([...stack.slice(stack.indexOf(file)), file].map(relativePath).join(' -> '));
                return;
            }
            visiting.add(file);
            stack.push(file);
            for (const dependency of graph.get(file) ?? []) visit(dependency);
            stack.pop();
            visiting.delete(file);
            visited.add(file);
        };

        for (const file of files) visit(file);
        expect(cycles).toEqual([]);
    });

    it('low-level modules do not reach into product and application layers', () => {
        expect(forbiddenImports(
            'src/core',
            /^@\/src\/(?:app|features|services|providers|platform|ui)(?:\/|$)/u,
        )).toEqual([]);
        expect(forbiddenImports(
            'src/shared',
            /^@\/src\/(?:app|features|services|providers|platform|ui)(?:\/|$)/u,
        )).toEqual([]);
        expect(forbiddenImports(
            'src/platform',
            /^@\/src\/(?:app|features|services|providers|ui)(?:\/|$)/u,
        )).toEqual([]);
        expect(forbiddenImports(
            'src/services',
            /^@\/src\/(?:app|features|ui)(?:\/|$)/u,
        )).toEqual([]);
        expect(forbiddenImports(
            'src/providers',
            /^@\/src\/(?:app|features|ui)(?:\/|$)/u,
        )).toEqual([]);
    });

    it('features collaborate through public or protocol modules', () => {
        const violations = listSourceFiles('src/features').flatMap((file) => {
            const owner = relativePath(file).split('/')[2];
            return importSpecifiers(file).flatMap((specifier) => {
                const target = resolveProjectImport(file, specifier);
                const targetPath = target ? relativePath(target) : '';
                const feature = targetPath.match(/^src\/features\/([^/]+)\//u)?.[1];
                return feature && feature !== owner && !/(?:public|protocol)\.ts$/u.test(targetPath)
                    ? [`${relativePath(file)} -> ${specifier}`]
                    : [];
            });
        });

        expect(violations).toEqual([]);
    });
});
