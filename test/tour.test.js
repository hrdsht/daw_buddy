'use strict';

const assert = require('assert/strict');
const { TOUR_STEPS, PROJECT_TOUR_STEPS, TOOL_TOUR_STEPS } = require('../src/renderer/tour');

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

function testProjectTourStepsIntegrity() {
  assert.ok(Array.isArray(PROJECT_TOUR_STEPS), 'PROJECT_TOUR_STEPS must be an array');
  assert.ok(PROJECT_TOUR_STEPS.length >= 6, 'Project tour must feature at least 6 key walkthrough steps');

  PROJECT_TOUR_STEPS.forEach((step, idx) => {
    assert.ok(step.title && step.title.length > 0, `Project step ${idx} must have a title`);
    assert.ok(step.description && step.description.length > 0, `Project step ${idx} must have an explanation`);
    assert.ok(['top', 'bottom', 'left', 'right'].includes(step.position || 'bottom'), `Project step ${idx} has valid position`);
  });
}

function testToolTourStepsIntegrity() {
  assert.ok(TOOL_TOUR_STEPS && typeof TOOL_TOUR_STEPS === 'object', 'TOOL_TOUR_STEPS must be an object map');
  assert.ok(TOOL_TOUR_STEPS.randomizer && TOOL_TOUR_STEPS.randomizer.length >= 4, 'Randomizer tool must have comprehensive walkthrough steps');
  assert.ok(TOOL_TOUR_STEPS['scale-tool'] && TOOL_TOUR_STEPS['scale-tool'].length >= 3, 'Scale tool must have walkthrough steps');
  assert.ok(TOOL_TOUR_STEPS['smart-rename'] && TOOL_TOUR_STEPS['smart-rename'].length >= 3, 'Smart rename tool must have walkthrough steps');
  assert.ok(TOOL_TOUR_STEPS.silence && TOOL_TOUR_STEPS.silence.length >= 2, 'Silence tool must have walkthrough steps');

  Object.entries(TOOL_TOUR_STEPS).forEach(([toolKey, steps]) => {
    steps.forEach((step, idx) => {
      assert.ok(step.title && step.title.length > 0, `Tool ${toolKey} step ${idx} must have a title`);
      assert.ok(step.description && step.description.length > 0, `Tool ${toolKey} step ${idx} must have an explanation`);
    });
  });
}

testTourStepsIntegrity();
testProjectTourStepsIntegrity();
testToolTourStepsIntegrity();
console.log('ok - testTourStepsIntegrity');
