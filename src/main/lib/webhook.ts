'use strict';

/**
 * Posts a new-bounce notification to a webhook URL — Discord, Slack, Zapier,
 * whatever. A revocable URL in settings is safer than storing an email
 * password (see docs/proposals/0004). Never throws: a failed post must not take
 * the app down or interrupt the watcher.
 */

/**
 * The payload carries both `content` (Discord) and `text` (Slack) so the same
 * URL works with either service, plus the raw fields for custom endpoints.
 */
function buildPayload(bounce: any) {
  const formats = (bounce.formats || []).join(' + ');
  const message = `🎵 New bounce: ${bounce.label} in "${bounce.project}"${
    formats ? ` (${formats})` : ''
  }`;
  return {
    content: message, // Discord
    text: message, // Slack
    bounce: {
      project: bounce.project,
      label: bounce.label,
      formats: bounce.formats || [],
      detectedAt: bounce.detectedAt || null
    }
  };
}

async function sendWebhook(url: string, bounce: any) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { sent: false, skipped: true };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(bounce))
    });
    return { sent: res.ok, status: res.status };
  } catch (err: any) {
    return { sent: false, error: err && err.message };
  }
}

module.exports = { buildPayload, sendWebhook };
