#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCALES_DIR = path.join(__dirname, '..', 'public', 'locales');
const EN_DIR = path.join(LOCALES_DIR, 'en');
const ZH_DIR = path.join(LOCALES_DIR, 'zh');

const namespaces = fs
  .readdirSync(EN_DIR)
  .filter(file => file.endsWith('.json'))
  .map(file => file.replace(/\.json$/, ''))
  .sort();

const technicalTokens = [
  'HealthBox', 'MediKeep', 'Paperless-ngx', 'Paperless', 'Papra', 'FastAPI', 'PostgreSQL',
  'Docker', 'React', 'GitHub', 'Google', 'Apple', 'Discord', 'Telegram',
  'Pushover', 'ntfy', 'Gmail', 'SMTP', 'IMAP', 'OAuth', 'OIDC', 'SSO', 'JWT',
  'TOTP', 'API', 'URL', 'HTTP', 'HTTPS', 'JSON', 'CSV', 'PDF', 'HTML', 'XML',
  'FHIR', 'DICOM', 'LOINC', 'UCUM', 'ICD-10', 'BMI', 'WHO', 'NPI', 'ID',
  'MB', 'GB', 'KB', 'mg/dL', 'mmol/L', 'mmHg', 'bpm', 'kg', 'cm', 'mm',
  'mL', 'dL', 'L', 'lbs', 'lb', 'ft', 'in', '°C', '°F', 'WebSocket',
  'Webhook', 'PWA', 'AES-256', 'UTF-8', 'QR', '2FA', 'Git', 'OpenAPI',
  'SQL', 'ZIP', 'CPU', 'RSS', 'IP',
  'Service Worker',
  'Excel', 'Google Sheets', 'Wiki', 'ISO', 'DD', 'MM', 'YYYY', 'ngx',
  'BioNTech', 'mRNA',
  'Gotify', 'Bearer', 'Authorization', 'tk', 'my-alerts', 'token',
  'ResMed', 'Philips', 'AirSense', 'Flublok',
  'cmH₂O',
];

function flatten(value, prefix = '', out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, fullKey, out);
    } else {
      out[fullKey] = child;
    }
  }
  return out;
}

function placeholders(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map(match => match[1])
    .sort();
}

function stripApprovedLatin(value) {
  let result = value
    .replace(/{{[^}]+}}/g, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g, '')
    .replace(/\b[\w-]+\.(?:json|csv|zip|sql|pdf|xml)\b/gi, '')
    .replace(/(?<![A-Za-z0-9])[A-Z][A-Z0-9_-]{1,}(?![A-Za-z0-9])/g, '')
    .replace(/\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|mL|dL|L|mm|cm|m|bpm|mmHg|MB|GB|KB)\b/gi, '')
    .replace(/\b[A-Fa-f0-9]{8,}\b/g, '');

  for (const token of technicalTokens.sort((a, b) => b.length - a.length)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi'), '');
  }

  return result;
}

function hasActionableEnglish(value) {
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return false;
    } catch {
      // Not a JSON example; continue with the normal prose check.
    }
  }
  return typeof value === 'string' && /[A-Za-z]{2,}/.test(stripApprovedLatin(value));
}

const report = {
  summary: {
    namespaces: namespaces.length,
    missing: 0,
    extra: 0,
    empty: 0,
    placeholderMismatch: 0,
    actionableEnglish: 0,
  },
  namespaces: {},
};

for (const namespace of namespaces) {
  const en = flatten(JSON.parse(fs.readFileSync(path.join(EN_DIR, `${namespace}.json`), 'utf8')));
  const zh = flatten(JSON.parse(fs.readFileSync(path.join(ZH_DIR, `${namespace}.json`), 'utf8')));
  const missing = Object.keys(en).filter(key => !(key in zh));
  const extra = Object.keys(zh).filter(key => !(key in en));
  const empty = Object.entries(zh)
    .filter(([, value]) => typeof value === 'string' && value.trim() === '')
    .map(([key]) => key);
  const placeholderMismatch = Object.keys(en)
    .filter(key => key in zh)
    .filter(key => JSON.stringify(placeholders(en[key])) !== JSON.stringify(placeholders(zh[key])))
    .map(key => ({ key, en: placeholders(en[key]), zh: placeholders(zh[key]) }));
  const actionableEnglish = Object.entries(zh)
    .filter(([, value]) => hasActionableEnglish(value))
    .map(([key, value]) => ({ key, value }));

  report.namespaces[namespace] = {
    missing,
    extra,
    empty,
    placeholderMismatch,
    actionableEnglish,
  };
  report.summary.missing += missing.length;
  report.summary.extra += extra.length;
  report.summary.empty += empty.length;
  report.summary.placeholderMismatch += placeholderMismatch.length;
  report.summary.actionableEnglish += actionableEnglish.length;
}

console.log(JSON.stringify(report, null, 2));

const failed = Object.entries(report.summary)
  .filter(([key]) => key !== 'namespaces')
  .some(([, value]) => value > 0);
process.exit(failed ? 1 : 0);
