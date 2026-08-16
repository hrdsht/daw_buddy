'use strict';

const assert = require('assert/strict');
const { NavigationHistory } = require('../src/renderer/navigation');

function backAndForwardRestorePages() {
  const history = new NavigationHistory();
  const list = { view: 'list', scrollTop: 420 };
  const project = { view: 'project', project: 'Song' };
  const tool = { view: 'disk' };

  history.visit(list);
  history.visit(project);
  assert.deepEqual(history.backFrom(tool), project);
  assert.deepEqual(history.backFrom(project), list);
  assert.deepEqual(history.forwardFrom(list), project);
  assert.deepEqual(history.forwardFrom(project), tool);
}

function newNavigationClearsForwardHistory() {
  const history = new NavigationHistory();
  history.visit({ view: 'list' });
  assert.deepEqual(history.backFrom({ view: 'project' }), { view: 'list' });
  history.visit({ view: 'list' });
  assert.equal(history.forwardFrom({ view: 'disk' }), null);
}

backAndForwardRestorePages();
console.log('ok - backAndForwardRestorePages');
newNavigationClearsForwardHistory();
console.log('ok - newNavigationClearsForwardHistory');
