'use strict';

const assert = require('assert/strict');
const { buildPayload, sendWebhook } = require('../src/main/lib/webhook');

function payloadCarriesBothServices() {
  const p = buildPayload({
    label: 'Jump v3',
    project: 'Jump',
    formats: ['wav', 'mp3'],
    detectedAt: '2026-08-16T00:00:00Z'
  });
  // Discord uses `content`, Slack uses `text` — both present, same message.
  assert.ok(p.content.includes('Jump v3'));
  assert.ok(p.content.includes('Jump'));
  assert.ok(p.content.includes('wav + mp3'));
  assert.equal(p.content, p.text);
  assert.deepEqual(p.bounce.formats, ['wav', 'mp3']);
  assert.equal(p.bounce.label, 'Jump v3');
}

function payloadHandlesMissingFormats() {
  const p = buildPayload({ label: 'X', project: 'Y' });
  assert.ok(p.content.includes('X'));
  assert.deepEqual(p.bounce.formats, []);
}

async function skipsEmptyOrInvalidUrl() {
  assert.deepEqual(await sendWebhook('', {}), { sent: false, skipped: true });
  assert.deepEqual(await sendWebhook('not-a-url', {}), { sent: false, skipped: true });
  assert.deepEqual(await sendWebhook(null, {}), { sent: false, skipped: true });
}

async function run() {
  const tests = [payloadCarriesBothServices, payloadHandlesMissingFormats, skipsEmptyOrInvalidUrl];
  for (const test of tests) {
    await test();
    console.log(`ok - ${test.name}`);
  }
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
