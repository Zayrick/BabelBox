#!/usr/bin/env node

// 顺序运行真实站点矩阵。默认只运行 required case，并对每个 case 依次执行
// hover/full；每个子进程仍由 run-site-translation-test.cjs 创建独立 profile。

const path = require('node:path');
const {spawn} = require('node:child_process');
const {
  CASES,
  collectBaseCaseConfigErrors,
  normalizeCaseConfig,
} = require('./site-translation/case-config.cjs');

const CASE_RUNNER = path.join(__dirname, 'run-site-translation-test.cjs');

function parseArgs(argv) {
  const args = {
    background: true,
    allowNetwork: false,
    includeQuarantine: false,
    failOnQuarantine: false,
    list: false,
    mode: 'both',
    cases: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === '--background') continue;
    if (token === '--headed') {
      args.background = false;
      continue;
    }
    if (token === '--allow-network') {
      args.allowNetwork = true;
      continue;
    }
    if (token === '--include-quarantine') {
      args.includeQuarantine = true;
      continue;
    }
    if (token === '--fail-on-quarantine') {
      args.failOnQuarantine = true;
      continue;
    }
    if (token === '--list') {
      args.list = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === 'case' || key === 'cases') {
      args.cases.push(...value.split(',').map((name) => name.trim()).filter(Boolean));
    } else {
      args[key] = value;
    }
    index += 1;
  }

  if (!['hover', 'full', 'both'].includes(args.mode)) throw new Error('--mode 必须是 hover、full 或 both');
  if (args.timeout !== undefined && (!Number.isFinite(Number(args.timeout)) || Number(args.timeout) <= 0)) {
    throw new Error('--timeout 必须为正数');
  }
  if (args.jobTimeout !== undefined && (!Number.isFinite(Number(args.jobTimeout)) || Number(args.jobTimeout) <= 0)) {
    throw new Error('--job-timeout 必须为正数');
  }
  if (!args.list && !args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.list && !args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  if (!args.list && !args.allowNetwork) throw new Error('真实网络矩阵必须显式传入 --allow-network');
  if (!args.list && args.background && !args.focusSafeHelper) {
    throw new Error('后台模式必须传入 --focus-safe-helper，禁止回退到会抢焦点的 Playwright 启动');
  }
  return args;
}

function validateMatrix(caseConfigs = CASES) {
  const entries = Object.entries(caseConfigs);
  const required = entries.filter(([, config]) => (config.tier || 'required') === 'required');
  const quarantine = entries.filter(([, config]) => config.tier === 'quarantine');
  const urls = new Set(entries.map(([, config]) => config.url));
  const requiredHosts = new Set();
  const errors = [];

  for (const [name, config] of entries) {
    const tier = config.tier || 'required';
    if (typeof config.url !== 'string' || !config.url.trim()) {
      errors.push(`${name} 缺少 url`);
    } else {
      try {
        const parsedUrl = new URL(config.url);
        if (tier === 'required') requiredHosts.add(parsedUrl.hostname);
      } catch (error) {
        errors.push(`${name} 的 url 无效：${config.url}（${error.message}）`);
      }
    }

    let normalized;
    try {
      normalized = normalizeCaseConfig(config);
      errors.push(...collectBaseCaseConfigErrors(name, config, normalized));
    } catch (error) {
      errors.push(`${name} 配置规范化失败：${error.message}`);
      continue;
    }

    const requiredForbiddenSelectors = normalized.forbiddenSelectors.filter(
      (selector) => !normalized.optionalForbiddenSelectors.includes(selector),
    );
    if (!config.hoverSelector) errors.push(`${name} 缺少 hoverSelector`);
    if (tier === 'required' && Array.isArray(config.forbiddenMustExistSelectors) &&
        JSON.stringify([...new Set(config.forbiddenMustExistSelectors)]) !==
          JSON.stringify([...new Set(requiredForbiddenSelectors)])) {
      errors.push(`${name} 是 required case，forbiddenMustExistSelectors 如显式配置必须覆盖全部非可选 forbiddenSelectors`);
    }
    const hoverSelectors = new Set(normalized.hoverTargets.map(({selector}) => selector));
    const missingHoverSelectors = normalized.coverageRules
      .map(({selector}) => selector)
      .filter((selector) => !hoverSelectors.has(selector));
    if (tier === 'required' && missingHoverSelectors.length > 0) {
      errors.push(`${name} 的 hoverTargets 未覆盖 coverageRules：${missingHoverSelectors.join(', ')}`);
    }
    if (!normalized.modes.includes('hover') || !normalized.modes.includes('full')) {
      errors.push(`${name} 必须同时支持 hover/full`);
    }
    if (config.tier === 'quarantine' && !config.quarantineReason) errors.push(`${name} 缺少 quarantineReason`);
  }

  if (urls.size !== entries.length) errors.push(`URL 不唯一：${urls.size}/${entries.length}`);

  if (errors.length > 0) throw new Error(`站点矩阵配置无效：\n- ${errors.join('\n- ')}`);
  return {entries, required, quarantine, requiredHosts};
}

function selectedEntries(args, entries) {
  const requested = [...new Set(args.cases)];
  if (requested.length > 0) {
    const unknown = requested.filter((name) => !CASES[name]);
    if (unknown.length > 0) throw new Error(`未知 case：${unknown.join(', ')}`);
    return requested.map((name) => [name, CASES[name]]);
  }
  return entries.filter(([, config]) => args.includeQuarantine || config.tier !== 'quarantine');
}

function childArgs(args, name, mode) {
  const values = [
    CASE_RUNNER,
    '--case', name,
    '--mode', mode,
    '--extension-dir', args.extensionDir,
    '--playwright-root', args.playwrightRoot,
    args.background ? '--background' : '--headed',
  ];
  if (args.browserPath) values.push('--browser-path', args.browserPath);
  if (args.timeout) values.push('--timeout', args.timeout);
  if (args.focusSafeHelper) values.push('--focus-safe-helper', args.focusSafeHelper);
  if (args.allowNetwork) values.push('--allow-network');
  if (args.artifactsDir) values.push('--artifacts-dir', path.join(path.resolve(args.artifactsDir), name, mode));
  return values;
}

function computeJobTimeoutMs(pageTimeout, mode, override) {
  if (override !== undefined) return Number(override);
  const normalizedPageTimeout = Number(pageTimeout) || 60000;
  return mode === 'full'
    ? Math.max(12 * 60 * 1000, normalizedPageTimeout * 3 + 5 * 60 * 1000)
    : Math.max(5 * 60 * 1000, normalizedPageTimeout * 2);
}

function killProcessGroup(child, signal) {
  if (!child?.pid) return false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // The group may already be gone; fall through to the direct child.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function runChildWithWatchdog(command, values, options = {}) {
  const timeoutMs = Number(options.timeoutMs);
  const killGraceMs = options.killGraceMs ?? 5000;
  const spawnImpl = options.spawnImpl || spawn;
  const killGroup = options.killProcessGroupImpl || killProcessGroup;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timeoutTimer;
    let killTimer;
    let finalTimer;
    let killSent = false;
    let deferredClose = null;
    const child = spawnImpl(command, values, {
      stdio: options.stdio || 'inherit',
      detached: process.platform !== 'win32',
    });
    const finish = (exitCode, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(finalTimer);
      resolve({
        ok: !timedOut && !error && exitCode === 0,
        exitCode,
        signal: signal || null,
        timedOut,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        error: error?.message || null,
      });
    };
    const recordExit = (exitCode, signal, error) => {
      if (!timedOut) {
        finish(exitCode, signal, error);
        return;
      }
      // Once the watchdog owns shutdown, a direct runner exit is not enough:
      // detached Edge/renderer descendants may still be alive in its process
      // group. Preserve the exit result, but do not settle or cancel the
      // scheduled group SIGKILL until that signal has actually been sent.
      deferredClose = {exitCode, signal, error};
      if (killSent) finish(exitCode, signal, error);
    };
    child.once('error', (error) => recordExit(null, null, error));
    child.once('close', (exitCode, signal) => recordExit(exitCode, signal, null));
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => {
        killSent = true;
        killGroup(child, 'SIGKILL');
        if (deferredClose) {
          finish(deferredClose.exitCode, deferredClose.signal, deferredClose.error);
          return;
        }
        finalTimer = setTimeout(() => finish(null, 'WATCHDOG', null), killGraceMs);
      }, killGraceMs);
    }, timeoutMs);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = validateMatrix();

  if (args.list) {
    process.stdout.write(`${JSON.stringify({
      total: matrix.entries.length,
      required: matrix.required.length,
      requiredHosts: matrix.requiredHosts.size,
      quarantine: matrix.quarantine.length,
      cases: matrix.entries.map(([name, config]) => ({
        name,
        tier: config.tier || 'required',
        url: config.url,
        modes: config.modes || ['hover', 'full'],
        coverageRules: normalizeCaseConfig(config).coverageRules,
        quarantineReason: config.quarantineReason || null,
      })),
    }, null, 2)}\n`);
    return;
  }

  const entries = selectedEntries(args, matrix.entries);
  const requestedModes = args.mode === 'both' ? ['hover', 'full'] : [args.mode];
  const jobs = entries.flatMap(([name, config]) => requestedModes
    .filter((mode) => (config.modes || ['hover', 'full']).includes(mode))
    .map((mode) => ({name, mode, tier: config.tier || 'required'})));
  const results = [];

  for (const job of jobs) {
    process.stdout.write(`\n=== ${job.name} / ${job.mode} / ${job.tier} ===\n`);
    const timeoutMs = computeJobTimeoutMs(args.timeout, job.mode, args.jobTimeout);
    const child = await runChildWithWatchdog(process.execPath, childArgs(args, job.name, job.mode), {timeoutMs});
    if (child.timedOut) {
      process.stderr.write(`[site-translation-matrix] ${job.name}/${job.mode} 总 watchdog 超时 ` +
        `(${timeoutMs}ms)，已终止隔离浏览器进程组\n`);
    }
    results.push({...job, ...child});
  }

  const requiredFailures = results.filter((result) => !result.ok && result.tier === 'required');
  const quarantineFailures = results.filter((result) => !result.ok && result.tier === 'quarantine');
  process.stdout.write(`${JSON.stringify({
    ok: requiredFailures.length === 0 && (!args.failOnQuarantine || quarantineFailures.length === 0),
    jobs: results.length,
    passed: results.filter((result) => result.ok).length,
    requiredFailures,
    quarantineFailures,
    timeoutFailures: results.filter((result) => result.timedOut),
  }, null, 2)}\n`);
  if (requiredFailures.length > 0 || (args.failOnQuarantine && quarantineFailures.length > 0)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {computeJobTimeoutMs, runChildWithWatchdog, validateMatrix};
