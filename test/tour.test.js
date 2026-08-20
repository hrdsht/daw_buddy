'use strict';

const assert = require('assert/strict');
const { TOUR_STEPS } = require('../src/renderer/tour');

function testTourStepsIntegrity() {
  assert.ok(Array.isArray(TOUR_STEPS), 'TOUR_STEPS must be an array');
  assert.ok(TOUR_STEPS.length >= 5, 'Tour must feature at least 5 key walkthrough steps');

  const targets = TOUR_STEPS.map((s) => s.target);
  assert.ok(targets.includes('#search'), 'Search filter step must be included');
  assert.ok(targets.includes('#collections'), 'Collections step must be included');
  assert.ok(targets.includes('#openTools'), 'Audio tools suite step must be included');
  assert.ok(targets.includes('.player'), 'Transport waveform step must be included');
  assert.ok(targets.includes('#view'), 'Drag and drop step must be included');
  assert.ok(targets.includes('#themeToggle'), 'Theme and color priority step must be included');

  TOUR_STEPS.forEach((step, idx) => {
    assert.ok(step.title && step.title.length > 0, `Step ${idx} must have a title`);
    assert.ok(step.description && step.description.length > 0, `Step ${idx} must have an explanation`);
    assert.ok(['top', 'bottom', 'left', 'right'].includes(step.position || 'bottom'), `Step ${idx} has valid position`);
  });
}

testTourStepsIntegrity();
console.log('ok - testTourStepsIntegrity');
