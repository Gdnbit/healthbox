#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { ESLint } from 'eslint';
import { parse } from '@babel/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.join(__dirname, '..');
const quickMode = process.argv.includes('--quick');

const findSourceFiles = async directory => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async entry => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findSourceFiles(fullPath);
      return /\.[jt]sx?$/.test(entry.name) ? [fullPath] : [];
    })
  );
  return nested.flat();
};

const results = quickMode
  ? (await findSourceFiles(path.join(frontendRoot, 'src'))).map(filePath => ({
      filePath,
      messages: [],
      suppressedMessages: [],
    }))
  : await new ESLint({ cwd: frontendRoot }).lintFiles([
      'src/**/*.{js,jsx,ts,tsx}',
    ]);

const actionable = [];
const suppressed = [];
const literalAttributes = [];
const userFacingAttributes = new Set([
  'aria-label',
  'label',
  'title',
  'placeholder',
  'subtitle',
  'description',
  'message',
  'submessage',
]);
const technicalLiteralAllowlist = new Set(['CLEANUP', 'DELETE', 'GitHub']);
const englishValueToKeys = new Map();

const indexTranslationValues = (namespace, value, keyPath = []) => {
  if (typeof value === 'string') {
    const keys = englishValueToKeys.get(value) ?? [];
    keys.push(`${namespace}:${keyPath.join('.')}`);
    englishValueToKeys.set(value, keys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    indexTranslationValues(namespace, child, [...keyPath, key]);
  }
};

for (const localeFile of await fs.readdir(
  path.join(frontendRoot, 'public', 'locales', 'en')
)) {
  if (!localeFile.endsWith('.json')) continue;
  const namespace = path.basename(localeFile, '.json');
  const resource = JSON.parse(
    await fs.readFile(
      path.join(frontendRoot, 'public', 'locales', 'en', localeFile),
      'utf8'
    )
  );
  indexTranslationValues(namespace, resource);
}

const shouldScanFile = file => {
  const normalized = file.replace(/\\/g, '/');
  return !(
    normalized.includes('/__tests__/') ||
    normalized.includes('/test/') ||
    /\.(test|spec|stories)\.[jt]sx?$/.test(normalized) ||
    /\/(Debug|Test)[^/]*\.[jt]sx?$/.test(normalized)
  );
};

for (const result of results) {
  const file = path.relative(frontendRoot, result.filePath).replace(/\\/g, '/');
  for (const message of result.messages) {
    if (message.ruleId === 'i18next/no-literal-string') {
      actionable.push({ file, line: message.line, message: message.message });
    }
  }
  for (const message of result.suppressedMessages ?? []) {
    if (message.ruleId === 'i18next/no-literal-string') {
      suppressed.push({
        file,
        line: message.line,
        message: message.message,
        justification: message.suppressions?.[0]?.justification ?? null,
      });
    }
  }
}

for (const result of results) {
  const file = path.relative(frontendRoot, result.filePath).replace(/\\/g, '/');
  if (!shouldScanFile(file)) continue;

  const source = await fs.readFile(result.filePath, 'utf8');
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  });

  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (
      node.type === 'JSXAttribute' &&
      node.name?.type === 'JSXIdentifier' &&
      userFacingAttributes.has(node.name.name) &&
      node.value?.type === 'StringLiteral'
    ) {
      const attribute = node.name.name;
      const value = node.value.value;
      if (/[A-Za-z]/.test(value) && !technicalLiteralAllowlist.has(value)) {
        literalAttributes.push({
          file,
          line: node.loc?.start.line ?? null,
          attribute,
          value,
          existingKeys: englishValueToKeys.get(value) ?? [],
        });
      }
    }

    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.object?.type === 'Identifier' &&
      node.callee.object.name === 'notifications' &&
      node.callee.property?.type === 'Identifier' &&
      node.callee.property.name === 'show' &&
      node.arguments?.[0]?.type === 'ObjectExpression'
    ) {
      for (const property of node.arguments[0].properties) {
        if (
          property.type !== 'ObjectProperty' ||
          property.key?.type !== 'Identifier' ||
          !['title', 'message'].includes(property.key.name)
        ) {
          continue;
        }

        let value = null;
        if (property.value?.type === 'StringLiteral') {
          value = property.value.value;
        } else if (property.value?.type === 'TemplateLiteral') {
          value = property.value.quasis
            .map(quasi => quasi.value.cooked ?? quasi.value.raw)
            .join('{{expression}}');
        }

        const visibleLiteral = value?.replaceAll('{{expression}}', '') ?? '';
        if (visibleLiteral && /[A-Za-z]/.test(visibleLiteral)) {
          literalAttributes.push({
            file,
            line: property.loc?.start.line ?? null,
            attribute: `notifications.${property.key.name}`,
            value,
            existingKeys: englishValueToKeys.get(value) ?? [],
          });
        }
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object' && child.type) visit(child);
    }
  };
  visit(ast.program);
}

console.log(
  JSON.stringify(
    {
      summary: {
        filesScanned: results.length,
        quickMode,
        actionable: actionable.length,
        explicitlySuppressed: suppressed.length,
        literalAttributes: literalAttributes.length,
      },
      actionable,
      literalAttributes,
      suppressed,
    },
    null,
    2
  )
);

process.exit(actionable.length + literalAttributes.length > 0 ? 1 : 0);
