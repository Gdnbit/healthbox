"""Ensure unknown authenticated responses cannot enter the offline cache."""
from pathlib import Path
import subprocess


def test_worker_ignores_private_download_and_does_not_cache_navigation():
    import shutil
    import pytest

    if not shutil.which("node"):
        pytest.skip("Node required for Service Worker event verification")
    source = Path(__file__).resolve().parents[2] / "frontend/public/service-worker.js"
    harness = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const events = {};
let opened = 0;
const worker = {
  self: {addEventListener: (name, cb) => events[name] = cb, skipWaiting() {}, clients: {claim() {}}},
  location: {origin: 'https://healthbox.example'},
  URL, console,
  caches: {open() {opened++; throw new Error('private response cached');}},
  fetch: async () => ({ok: true, type: 'basic', clone() {throw new Error('private response cloned');}})
};
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), worker);
let handled = false;
events.fetch({request: {url:'https://healthbox.example/private-download/1', method:'GET', mode:'cors'}, respondWith() {handled = true;}});
assert.equal(handled, false);
let navigation;
events.fetch({request: {url:'https://healthbox.example/family-health',method:'GET',mode:'navigate'}, respondWith(value) {navigation = value;}});
Promise.resolve(navigation).then(() => assert.equal(opened, 0)).catch(e => {console.error(e); process.exitCode = 1;});
"""
    result = subprocess.run(["node", "-e", harness, str(source)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
