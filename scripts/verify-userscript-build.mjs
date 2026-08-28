import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifactPath = path.join(root, '.output/userscript/fluent-read.user.js');
const source = fs.readFileSync(artifactPath, 'utf8');

const assertions = [
  [source.startsWith('// ==UserScript==\n'), 'metadata header must be the first bytes'],
  [source.includes(`// @version      ${packageJson.userscriptVersion}`), 'metadata must use userscriptVersion'],
  [source.includes(`FluentRead V${packageJson.version} · Userscript V${packageJson.userscriptVersion}`), 'settings must distinguish the FluentRead and userscript versions'],
  [source.includes('// @grant        GM_xmlhttpRequest'), 'GM_xmlhttpRequest grant is required'],
  [source.includes('// @connect      *'), 'provider requests require @connect'],
  [!source.includes('// @require'), 'the artifact must be self-contained'],
  [!/(^|[^\w])import\s*\(/u.test(source), 'the artifact must not contain runtime dynamic imports'],
  [!/\bglobalThis\s*(?:\.\s*(?:browser|chrome)\b|\[\s*['"](?:browser|chrome)['"]\s*\])/u.test(source), 'privileged browser shims must stay lexical'],
  [source.split('// ==UserScript==').length === 2, 'metadata header must occur exactly once'],
  [source.length > 10_000, 'artifact is unexpectedly small'],
];

const failure = assertions.find(([passed]) => !passed);
if (failure) throw new Error(`Userscript verification failed: ${failure[1]}`);

console.log(`Verified ${path.relative(root, artifactPath)} (${Buffer.byteLength(source).toLocaleString()} bytes)`);
