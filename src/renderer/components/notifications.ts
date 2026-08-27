'use strict';

import { el } from '../dom';

/**
 * Crash Recovery Modal & Diagnostics Banner Helper
 */
export function showCrashRecoveryModal(report: any) {
  const existingModal = document.getElementById('crashRecoveryOverlay');
  if (existingModal) existingModal.remove();

  const overlay = el('div', 'crash-recovery-overlay');
  overlay.id = 'crashRecoveryOverlay';

  const modal = el('div', 'crash-recovery-modal');

  // Header
  const header = el('div', 'crash-recovery-head');
  const title = el('h3', 'crash-recovery-title', '⚠️ DAW Buddy Crash Recovery');
  const closeBtn = el('button', 'crash-recovery-close', '✕');
  closeBtn.title = 'Dismiss and continue';
  header.append(title, closeBtn);

  // Description
  const desc = el(
    'p',
    'crash-recovery-desc',
    `DAW Buddy caught and safely logged a background crash that occurred during your previous session at ${report.timeString || 'recently'}. Your project files and settings were kept safe.`
  );

  // Error details container
  const errorBox = el('div', 'crash-recovery-error-box');
  const errorName = el('div', 'crash-recovery-error-name', `${report.errorName || 'Error'}: ${report.errorMessage || 'Unknown exception'}`);
  errorBox.append(errorName);

  if (report.errorStack) {
    const stackSnippet = el('pre', 'crash-recovery-error-stack', report.errorStack.slice(0, 450) + (report.errorStack.length > 450 ? '...' : ''));
    errorBox.append(stackSnippet);
  }

  // Draggable Log Pill
  const pill = el('div', 'crash-drag-pill');
  pill.draggable = true;
  pill.title = 'Click and drag this crash log file directly into an email, Discord, or folder';

  const pillIcon = el('span', 'crash-drag-pill__icon', '📋');
  const pillInfo = el('div', 'crash-drag-pill__info');
  const filename = report.logFilePath ? report.logFilePath.split(/[\\/]/).pop() : 'crash-report.log';
  const pillName = el('span', 'crash-drag-pill__name', filename);
  const pillHint = el('span', 'crash-drag-pill__hint', '📦 Drag & Drop file directly into Mail / Discord');
  pillInfo.append(pillName, pillHint);
  pill.append(pillIcon, pillInfo);

  pill.addEventListener('dragstart', (e: DragEvent) => {
    e.preventDefault();
    if (window.api && window.api.dragFiles && report.logFilePath) {
      window.api.dragFiles([report.logFilePath]);
    }
  });

  // Developer Support Email Banner
  const emailBanner = el('div', 'crash-email-banner');
  const emailLeft = el('div', 'crash-email-banner__left');
  const emailIcon = el('span', 'crash-email-banner__icon', '✉️');
  const emailText = el('span', 'crash-email-banner__text');
  emailText.innerHTML = `Send log to: <b class="crash-email-address" title="Click to copy">ba55icklistens@gmail.com</b>`;
  emailLeft.append(emailIcon, emailText);

  const copyEmailBtn = el('button', 'pill pill--sm', '📋 Copy Email');
  copyEmailBtn.title = 'Copy ba55icklistens@gmail.com to clipboard';
  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText('ba55icklistens@gmail.com');
      copyEmailBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyEmailBtn.textContent = '📋 Copy Email'; }, 2000);
    } catch {}
  };
  copyEmailBtn.addEventListener('click', handleCopyEmail);
  emailText.addEventListener('click', handleCopyEmail);
  emailBanner.append(emailLeft, copyEmailBtn);

  // Action Buttons
  const actions = el('div', 'crash-recovery-actions');

  const copyBtn = el('button', 'btn', '📋 Copy Details');
  copyBtn.addEventListener('click', async () => {
    try {
      const textToCopy = `DAW Buddy Crash Report (${report.timeString}):\n${report.errorName}: ${report.errorMessage}\n\nStack:\n${report.errorStack || 'N/A'}\n\nSystem:\n${JSON.stringify(report.systemInfo, null, 2)}`;
      await navigator.clipboard.writeText(textToCopy);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy Details'; }, 2000);
    } catch {}
  });

  const openFolderBtn = el('button', 'btn', '📂 Show in Folder');
  openFolderBtn.addEventListener('click', async () => {
    if (window.api && window.api.crashlogOpenFolder) {
      await window.api.crashlogOpenFolder();
    }
  });

  const dismissBtn = el('button', 'btn btn--primary', 'Skip / Dismiss');

  const dismissModal = async () => {
    try {
      await window.api?.crashlogDismiss?.();
    } catch {}
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  };

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dismissModal();
    }
  };

  closeBtn.addEventListener('click', dismissModal);
  dismissBtn.addEventListener('click', dismissModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismissModal();
  });
  document.addEventListener('keydown', onEsc);

  actions.append(openFolderBtn, copyBtn, dismissBtn);
  modal.append(header, desc, errorBox, pill, emailBanner, actions);
  overlay.append(modal);
  document.body.append(overlay);
}
