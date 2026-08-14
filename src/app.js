'use strict';

/**
 * Runs inside the window. No file access — everything goes through
 * window.api, defined in preload.js.
 *
 * Three views share the main pane: the project list, one project's page, and
 * the sample cleanup screen.
 */

const $ = (id) => document.getElementById(id);

const viewEl = $('view');
const collectionsEl = $('collections');
const searchEl = $('search');
const toastsEl = $('toasts');
const favFilterEl = $('favFilter');
const backBtn = $('backBtn');
const sheetEl = $('sheet');
const scrimEl = $('scrim');

/* ============================== state ============================== */

let settings = null;
let records = {};
let entries = [];
let browsing = null;
let view = 'list';
let openProject = null;
let projectTab = 'renders';
let selected = null;
let filterRoot = null;
let favOnly = false;
let sortBy = 'modified';
let sortDir = -1;
let noteTimer = null;
let dedupeState = { groups: [], scanned: 0, folders: 0, chosen: new Set() };

/* ============================= startup ============================= */

async function boot() {
  settings = await window.api.getSettings();
  records = await window.api.getRecords();
  applySettings();
  await refresh();
}

function applySettings() {
  $('alwaysOnTop').checked = settings.alwaysOnTop;
  $('pollWatching').checked = settings.pollWatching;
  if ($('followLinks')) $('followLinks').checked = Boolean(settings.followLinks);
  if ($('outputPath')) {
    $('outputPath').textContent = settings.outputFolder || 'Created on first scan';
  }
  $('ignoreInput').value = settings.ignore.join(', ');
  $('dataDir').textContent = settings.dataDir;
  document.body.classList.toggle('is-mac', Boolean(settings.isMac));
  renderRootList();
}

async function refresh() {
  if (view === 'list') showSpinner('Scanning', 'Reading your folders.');

  const result = browsing
    ? await window.api.browse(browsing)
    : await window.api.scan();

  entries = result.entries || [];

  // How many sessions share each folder, so a row can show "8 in folder".
  const perFolder = new Map();
  entries.forEach((e) => perFolder.set(e.folder, (perFolder.get(e.folder) || 0) + 1));
  entries.forEach((e) => {
    e.siblingCount = perFolder.get(e.folder) || 1;
  });

  if (result.cache) {
    console.log(
      `[scan] ${entries.length} sessions · ${result.foldersRead} folders read · ` +
        `cache ${result.cache.hits} hit / ${result.cache.misses} parsed`
    );
  }

  (result.errors || []).forEach((error) =>
    toast('Folder unreadable', `${basename(error.root)} — ${error.message}`, true)
  );
  if (result.truncated) {
    toast(
      'Scan stopped early',
      'That tree is unusually large. Add folders you do not need to the skip list.',
      true
    );
  }

  renderCollections();
  render();
}

/* ============================ navigation =========================== */

function render() {
  backBtn.hidden = view === 'list' && !browsing;

  if (view === 'project') return renderProjectPage();
  if (view === 'dedupe') return renderDedupe();
  return renderList();
}

function goList(folder) {
  view = 'list';
  browsing = folder || null;
  openProject = null;
  viewEl.scrollTop = 0;
  refresh();
}

function goProject(entry) {
  view = 'project';
  openProject = entry;
  projectTab = 'renders';
  viewEl.scrollTop = 0;
  render();
}

backBtn.addEventListener('click', () => {
  if (view !== 'list') {
    view = 'list';
    openProject = null;
    render();
    return;
  }
  // Walking back out of a folder: drop the last segment.
  const parent = browsing ? browsing.split(/[\\/]/).slice(0, -1).join(sep()) : null;
  const stillInside = settings.roots.some(
    (root) => parent && (parent === root || parent.startsWith(root))
  );
  goList(stillInside ? parent : null);
});

/* ============================== sidebar ============================ */

function renderCollections() {
  collectionsEl.innerHTML = '';

  const all = collButton('All projects', entries.length);
  if (!filterRoot && !favOnly) all.classList.add('is-on');
  all.addEventListener('click', () => {
    filterRoot = null;
    favOnly = false;
    goList(null);
  });
  collectionsEl.append(all);

  const favCount = entries.filter((e) => record(e.path).favourite).length;
  const favs = collButton('Favourites', favCount);
  if (favOnly) favs.classList.add('is-on');
  favs.addEventListener('click', () => {
    favOnly = !favOnly;
    favFilterEl.classList.toggle('is-on', favOnly);
    view = 'list';
    render();
    renderCollections();
  });
  collectionsEl.append(favs);

  if (settings.roots.length > 0) {
    collectionsEl.append(el('div', 'coll__label', 'Folders'));
    settings.roots.forEach((root) => {
      const count = entries.filter((e) => e.root === root).length;
      const item = collButton(basename(root), count);
      if (filterRoot === root) item.classList.add('is-on');
      item.addEventListener('click', () => {
        filterRoot = filterRoot === root ? null : root;
        view = 'list';
        render();
        renderCollections();
      });
      collectionsEl.append(item);
    });
  }
}

function collButton(name, count) {
  const node = el('button', 'coll');
  node.append(el('span', 'coll__name', name));
  node.append(el('span', 'coll__count', String(count)));
  return node;
}

/* ============================== the list =========================== */

function visible() {
  const query = searchEl.value.trim().toLowerCase();

  let list = entries.filter((entry) => {
    if (filterRoot && entry.root !== filterRoot) return false;
    if (favOnly && !record(entry.path).favourite) return false;
    if (!query) return true;

    const rec = record(entry.path);
    return [entry.name, entry.location, entry.daw, rec.note, rec.key, rec.camelot, entry.bpm]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  return list.slice().sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name) * sortDir;
    if (sortBy === 'key') {
      return (
        (record(a.path).camelot || '~').localeCompare(record(b.path).camelot || '~') *
        sortDir
      );
    }
    if (sortBy === 'bpm') return ((a.bpm || 0) - (b.bpm || 0)) * sortDir;
    return (a.modified - b.modified) * sortDir;
  });
}

function renderList() {
  viewEl.innerHTML = '';

  if (settings.roots.length === 0) {
    return renderEmpty(
      'Add your projects folder',
      'Open Settings and point it at the folder your sessions live in.'
    );
  }

  const list = visible();

  if (browsing) {
    const trail = el('div', 'page__kicker', browsing);
    trail.style.padding = '10px 12px 4px';
    viewEl.append(trail);
  }

  const head = el('div', 'thead');
  [
    ['Name', 'name', 'th--name'],
    ['BPM', 'bpm', ''],
    ['Key', 'key', ''],
    ['Audio', null, ''],
    ['Saves', null, 'th--health'],
    ['Modified', 'modified', '']
  ].forEach(([label, key, extra]) => {
    const th = el('span', `th ${extra}`.trim(), label);
    if (key) {
      th.dataset.sort = key;
      if (sortBy === key) th.classList.add('is-sorted');
      th.addEventListener('click', () => {
        if (sortBy === key) sortDir *= -1;
        else {
          sortBy = key;
          sortDir = key === 'name' ? 1 : -1;
        }
        render();
      });
    }
    head.append(th);
  });
  viewEl.append(head);

  if (list.length === 0) {
    return renderEmpty(
      'Nothing matches',
      searchEl.value
        ? 'No project matches that search.'
        : 'No sessions turned up in these folders.'
    );
  }

  list.forEach((entry) => viewEl.append(buildRow(entry)));
}

function buildRow(entry) {
  const rec = record(entry.path);
  const row = el('article', 'row');
  if (selected === entry.path) row.classList.add('is-selected');

  /* name */
  const main = el('div', 'row__main');
  const line = el('div', 'row__nameline');
  line.append(el('span', 'row__name', entry.name));

  if (rec.favourite) line.append(el('span', 'badge badge--fav', 'Fav'));
  if (entry.packaged) {
    const badge = el('span', 'badge badge--packaged', 'Packaged');
    badge.title = 'A zip of the same name sits alongside — exported as a loop package';
    line.append(badge);
  }
  if (entry.siblingCount > 1) {
    const mates = el('button', 'badge badge--inside', `${entry.siblingCount} in folder`);
    mates.title = 'Other sessions in the same folder';
    mates.addEventListener('click', (event) => {
      event.stopPropagation();
      searchEl.value = entry.location.split(' / ').pop() || '';
      render();
    });
    line.append(mates);
  }
  main.append(line);
  main.append(
    el(
      'div',
      'row__sub',
      [entry.location, entry.daw].filter(Boolean).join('  ·  ') || basename(entry.root)
    )
  );
  row.append(main);

  /* bpm */
  const bpm = el('div', 'cell cell--bpm', entry.bpm !== null ? formatBpm(entry.bpm) : '—');
  if (entry.bpm === null) bpm.classList.add('cell--empty');
  row.append(bpm);

  /* key */
  if (rec.key) {
    const keyCell = el('div');
    keyCell.append(el('div', 'keycell__key', rec.key));
    if (rec.camelot) keyCell.append(el('div', 'keycell__camelot', rec.camelot));
    row.append(keyCell);
  } else {
    row.append(el('div', 'cell cell--empty', '—'));
  }

  /* play — disabled when the scan found no audio, rather than finding out
     after you've clicked */
  const playCell = el('div');
  const play = el('button', 'rowbtn', '▶ Play');
  play.disabled = !entry.audioCount;
  play.title = entry.audioCount
    ? `${entry.audioCount} audio file(s)`
    : 'No audio in this project';
  play.addEventListener('click', async (event) => {
    event.stopPropagation();
    await playNewest(entry);
  });
  playCell.append(play);
  row.append(playCell);

  /* saves */
  const health = el('div', 'cell--health');
  const meter = el('div', 'meter');
  const fill = el('div', 'meter__fill');
  fill.style.width = `${Math.round((entry.health || 0) * 100)}%`;
  meter.append(fill);
  health.append(meter);
  health.append(el('div', 'meter__caption', `${entry.backupCount}`));
  row.append(health);

  row.append(el('div', 'cell', timeAgo(entry.modified)));

  row.addEventListener('click', () => {
    selected = entry.path;
    render();
  });
  row.addEventListener('dblclick', () => goProject(entry));
  row.title = entry.sessionPath;
  return row;
}

async function playNewest(entry) {
  const result = await window.api.findRenders(
    entry.sessionPath,
    entry.root,
    stemsFolderFor(entry),
    siblingsOf(entry)
  );
  if (!result.renders.length) {
    toast('No audio', `No render found for ${entry.name}`, true);
    return;
  }
  Player.load(result.renders[0].primary);
}

/** Other session files sitting in the same folder. */
function siblingsOf(entry) {
  return entries
    .filter((other) => other.folder === entry.folder && other.path !== entry.path)
    .map((other) => other.name);
}

function stemsFolderFor(entry) {
  const rec = record(entry.path);
  return rec.stemsPath ? [rec.stemsPath] : [];
}

/* =========================== project page ========================== */

function renderProjectPage() {
  const entry = openProject;
  const rec = record(entry.path);
  viewEl.innerHTML = '';

  /* header */
  const head = el('div', 'page__head');
  const art = el('div', 'page__art', entry.bpm !== null ? formatBpm(entry.bpm) : '♪');
  head.append(art);

  const titles = el('div', 'page__titles');
  titles.append(el('div', 'page__kicker', entry.daw || 'Project'));
  titles.append(el('h1', 'page__title', entry.name));

  const facts = el('div', 'page__facts');
  if (entry.bpm !== null) facts.append(fact('BPM', formatBpm(entry.bpm)));
  else if (entry.bpmError) facts.append(fact('BPM', 'not readable'));
  if (rec.key) facts.append(fact('Key', `${rec.key}${rec.camelot ? ` (${rec.camelot})` : ''}`));
  facts.append(fact('Saves', String(entry.backupCount)));
  facts.append(fact('Audio', String(entry.audioCount)));
  facts.append(fact('Modified', timeAgo(entry.modified)));
  if (entry.packaged) facts.append(fact('Exported', timeAgo(entry.packagedAt)));
  titles.append(facts);
  head.append(titles);
  viewEl.append(head);

  /* actions */
  const actions = el('div', 'page__actions');

  const open = el('button', 'pill pill--solid', 'Open project');
  open.disabled = !entry.projectFile;
  open.addEventListener('click', () => openWithGuard(entry));
  actions.append(open);

  const reveal = el('button', 'pill', `Show in ${settings.fileManager}`);
  reveal.addEventListener('click', () =>
    window.api.reveal(entry.projectFile || entry.path)
  );
  actions.append(reveal);

  const fav = el('button', 'pill', rec.favourite ? '♥ Favourite' : '♡ Favourite');
  if (rec.favourite) fav.classList.add('is-on');
  fav.addEventListener('click', async () => {
    await saveRecord(entry.path, { favourite: !rec.favourite });
    render();
    renderCollections();
  });
  actions.append(fav);

  const stems = el('button', 'pill', rec.stemsPath ? 'Open stems' : 'Set stems folder');
  stems.addEventListener('click', async () => {
    if (rec.stemsPath) return window.api.reveal(rec.stemsPath);
    const updated = await window.api.chooseStems(entry.path);
    if (updated) {
      records[entry.path] = updated;
      render();
    }
  });
  actions.append(stems);

  if (rec.stemsPath) {
    const clear = el('button', 'pill pill--sm', 'Change stems');
    clear.addEventListener('click', async () => {
      const updated = await window.api.chooseStems(entry.path);
      if (updated) {
        records[entry.path] = updated;
        render();
      }
    });
    actions.append(clear);
  }

  viewEl.append(actions);

  /* tabs */
  const tabs = el('div', 'tabs');
  tabs.style.padding = '0 12px 18px';
  [
    ['renders', 'Renders'],
    ['notes', 'Notes & versions'],
    ['rename', 'Rename files'],
    ['tags', 'Strip ID3 tags']
  ].forEach(([key, label]) => {
    const tab = el('button', 'pill', label);
    if (projectTab === key) tab.classList.add('is-on');
    tab.addEventListener('click', () => {
      projectTab = key;
      render();
    });
    tabs.append(tab);
  });
  viewEl.append(tabs);

  if (projectTab === 'renders') return renderRendersTab(entry);
  if (projectTab === 'notes') return renderNotesTab(entry);
  if (projectTab === 'rename') return renderRenameTab(entry);
  return renderTagsTab(entry);
}

function fact(label, value) {
  const node = el('span');
  node.append(document.createTextNode(`${label} `));
  node.append(el('b', null, value));
  return node;
}

async function openWithGuard(entry) {
  const result = await window.api.openProject(entry.projectFile, entry.name);
  if (result.cancelled) return;
  if (result.error) toast('Could not open', result.error, true);
}

/* ------------------------------ renders --------------------------- */

function renderRendersTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Renders'));
  const list = el('div');
  section.append(list);
  viewEl.append(section);

  loadRenders(entry, list);
}

async function loadRenders(entry, container) {
  container.append(el('p', 'muted', 'Looking for audio…'));

  const result = await window.api.findRenders(
    entry.sessionPath,
    entry.root,
    stemsFolderFor(entry),
    siblingsOf(entry)
  );

  container.innerHTML = '';

  if (!result.renders.length) {
    container.append(
      el(
        'p',
        'muted',
        `No render found matching "${entry.name}". Looked in this folder and in Renders, Bounces and Stems folders up to the root.`
      )
    );
    return;
  }

  // Grouped by where they were found, so Renders, Bounces and loose files
  // stay visually separate instead of merging into one long list.
  const byPlace = new Map();
  result.renders.forEach((render) => {
    const where = render.where || 'Elsewhere';
    if (!byPlace.has(where)) byPlace.set(where, []);
    byPlace.get(where).push(render);
  });

  for (const [where, list] of byPlace) {
    const heading = el('div', 'page__kicker', where);
    heading.style.margin = '14px 0 6px';
    container.append(heading);
    list.forEach((render) => container.append(buildRenderRow(entry, render)));
  }
}

function buildRenderRow(entry, render) {
  const row = el('div', 'filerow');

  const play = el('button', 'filerow__play', '▶');
  play.addEventListener('click', (event) => {
    event.stopPropagation();
    Player.load(render.primary);
  });
  row.append(play);

  const middle = el('div');
  middle.append(el('div', 'filerow__name', render.label));
  middle.append(
    el(
      'div',
      'filerow__meta',
      [
        render.formats.join(' + ').toUpperCase(),
        render.part,
        formatBytes(render.size),
        timeAgo(render.modified)
      ]
        .filter(Boolean)
        .join('  ·  ')
    )
  );
  row.append(middle);

  row.append(
    render.version !== null
      ? el('span', 'badge badge--packaged', `v${render.version}`)
      : el('span')
  );

  const analyse = el('button', 'pill pill--sm', 'Analyse');
  analyse.addEventListener('click', async (event) => {
    event.stopPropagation();
    await analyseRender(entry, render, analyse);
  });
  row.append(analyse);

  row.dataset.path = render.primary.path;
  row.addEventListener('click', () => Player.load(render.primary));
  return row;
}

async function analyseRender(entry, render, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.textContent = 'Reading…';

  const decoded = await Player.load(render.primary, { autoplay: false });
  if (!decoded) {
    buttonEl.disabled = false;
    buttonEl.textContent = 'Analyse';
    toast('Analysis failed', 'That file could not be decoded.', true);
    return;
  }

  buttonEl.textContent = 'Analysing…';
  await new Promise((resolve) => setTimeout(resolve, 30));

  const result = window.DSP.analyse(decoded.getChannelData(0), decoded.sampleRate);

  await saveRecord(entry.path, {
    key: result.key,
    camelot: result.camelot,
    keyConfidence: result.keyConfidence,
    keyAlternate: result.keyAlternate,
    detectedBpm: result.bpm,
    analysedFrom: render.primary.name
  });

  buttonEl.disabled = false;
  buttonEl.textContent = 'Analyse';

  const drift =
    entry.bpm && result.bpm ? Math.abs(entry.bpm - result.bpm) : null;

  toast(
    'Analysed',
    `${result.key} (${result.camelot}) · ${result.bpm} BPM` +
      (drift !== null && drift > 1.5
        ? ` — session says ${formatBpm(entry.bpm)}, worth a look`
        : '')
  );

  render();
}

/* ------------------------------- notes ---------------------------- */

function renderNotesTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Notes', entry.name));

  section.append(
    el(
      'div',
      'callout',
      'Saved as a text file next to the project, named after this version and the time you last edited it. Each session file keeps its own note.'
    )
  );

  const area = el('textarea', 'notes');
  area.placeholder = 'Mix notes, references, what to fix next time…';
  const status = el('div', 'notestatus', 'Loading…');

  window.api.loadNote(entry.sessionPath).then(({ text, file }) => {
    area.value = text || '';
    status.textContent = file ? basename(file) : 'No note file yet';
  });

  area.addEventListener('input', () => {
    status.textContent = 'Typing…';
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      const { file } = await window.api.saveNote(entry.sessionPath, area.value);
      status.textContent = file ? `Saved · ${basename(file)}` : 'Note cleared';
    }, 500);
  });

  section.append(area, status);

  // Other versions in the same folder, each with its own note.
  const mates = siblingsOf(entry);
  if (mates.length > 0) {
    const others = el('div');
    others.style.marginTop = '22px';
    others.append(el('div', 'page__kicker', `${mates.length} other version(s) here`));
    entries
      .filter((other) => other.folder === entry.folder && other.path !== entry.path)
      .forEach((other) => {
        const link = el('div', 'filerow');
        link.append(el('span'));
        const middle = el('div');
        middle.append(el('div', 'filerow__name', other.name));
        middle.append(
          el(
            'div',
            'filerow__meta',
            `${other.bpm !== null ? formatBpm(other.bpm) + ' BPM  ·  ' : ''}${timeAgo(other.modified)}`
          )
        );
        link.append(middle, el('span'), el('span'));
        link.addEventListener('click', () => goProject(other));
        others.append(link);
      });
    section.append(others);
  }

  viewEl.append(section);
}

/* ------------------------------ rename ---------------------------- */

let renameFolder = null;

function renderRenameTab(entry) {
  if (!renameFolder) renameFolder = entry.folder;

  const section = el('div', 'section');
  section.append(headRow('Rename files'));

  /* which folder */
  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Renaming files in'));
  const folderPath = el('div', 'mono', renameFolder);
  folderPath.style.margin = '6px 0 10px';
  folderPath.style.wordBreak = 'break-all';
  folderBar.append(folderPath);

  const pick = el('button', 'pill pill--sm', 'Choose a different folder');
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      renameFolder = chosen;
      render();
    }
  });
  const useProject = el('button', 'pill pill--sm', "This project's folder");
  useProject.addEventListener('click', () => {
    renameFolder = entry.folder;
    render();
  });
  const bar = el('div', 'tabs');
  bar.append(pick, useProject);
  folderBar.append(bar);
  section.append(folderBar);

  /* controls */
  const controls = el('div', 'grid2');

  const removeField = fieldInput('Remove this text');
  removeField.input.placeholder = 'e.g. Suraag_';
  controls.append(removeField.wrap);

  const addField = fieldInput('Add this text');
  addField.input.placeholder = 'e.g. MIX_';
  controls.append(addField.wrap);
  section.append(controls);

  /* prefix or suffix — either, never both */
  const where = el('div', 'fieldrow');
  where.append(el('label', null, 'Add it to the'));
  const choice = el('div', 'tabs');
  let position = 'prefix';

  const prefixBtn = el('button', 'pill is-on', 'Beginning');
  const suffixBtn = el('button', 'pill', 'End');

  function setPosition(next) {
    position = next;
    prefixBtn.classList.toggle('is-on', next === 'prefix');
    suffixBtn.classList.toggle('is-on', next === 'suffix');
    build();
  }
  prefixBtn.addEventListener('click', () => setPosition('prefix'));
  suffixBtn.addEventListener('click', () => setPosition('suffix'));

  choice.append(prefixBtn, suffixBtn);
  where.append(choice);
  section.append(where);

  const summary = el('p', 'muted');
  const preview = el('div', 'preview');
  section.append(summary, preview);

  const actions = el('div', 'tabs');
  actions.style.marginTop = '14px';
  const applyBtn = el('button', 'pill pill--solid', 'Apply rename');
  const undoBtn = el('button', 'pill', 'Undo last');
  actions.append(applyBtn, undoBtn);
  section.append(actions);
  viewEl.append(section);

  let plan = null;

  async function build() {
    let files;
    try {
      files = await window.api.renameList(renameFolder, [
        '.wav',
        '.mp3',
        '.aiff',
        '.flac'
      ]);
    } catch (err) {
      summary.textContent = err.message;
      applyBtn.disabled = true;
      return;
    }

    plan = await window.api.renamePlan(files, {
      operation: 'removeAndAdd',
      remove: removeField.input.value,
      add: addField.input.value,
      position
    });

    preview.innerHTML = '';
    summary.textContent = `${plan.changing} of ${files.length} files would change${
      plan.problems ? ` · ${plan.problems} problem(s)` : ''
    }`;

    plan.rows.slice(0, 100).forEach((row) => {
      const node = el('div', 'prev');
      node.append(el('div', 'prev__from', row.from));
      if (row.problem) node.append(el('div', 'prev__problem', `⚠ ${row.problem}`));
      else {
        node.append(
          el(
            'div',
            row.changed ? 'prev__to' : 'prev__to prev__to--same',
            row.changed ? `→ ${row.to}` : '→ unchanged'
          )
        );
      }
      preview.append(node);
    });

    applyBtn.disabled = plan.changing === 0;
  }

  [removeField, addField].forEach((f) =>
    f.input.addEventListener('input', () => build())
  );

  applyBtn.addEventListener('click', async () => {
    if (!plan) return;
    const result = await window.api.renameApply(plan);
    toast(
      'Renamed',
      `${result.renamed} file(s)${result.failed.length ? `, ${result.failed.length} failed` : ''}`,
      result.failed.length > 0
    );
    build();
  });

  undoBtn.addEventListener('click', async () => {
    const result = await window.api.renameUndo();
    toast('Undo', `${result.reverted} file(s) put back`);
    build();
  });

  build();
}

function fieldInput(label) {
  const wrap = el('div', 'fieldrow');
  wrap.append(el('label', null, label));
  const input = el('input', 'input');
  input.type = 'text';
  wrap.append(input);
  return { wrap, input };
}

/* ------------------------------- tags ----------------------------- */

function renderTagsTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Strip ID3 tags'));
  section.append(
    el(
      'div',
      'callout',
      'Removes artwork and metadata from the MP3s in this folder. The audio is untouched — only the tag blocks at the start and end are cut off.'
    )
  );

  const summary = el('p', 'muted');
  const list = el('div', 'preview');
  const actions = el('div', 'tabs');
  actions.style.marginTop = '14px';
  const stripBtn = el('button', 'pill pill--danger', 'Strip tags');
  actions.append(stripBtn);
  section.append(summary, list, actions);
  viewEl.append(section);

  let tagged = [];

  async function scan() {
    summary.textContent = 'Checking MP3s…';
    list.innerHTML = '';
    try {
      const found = await window.api.id3Inspect(entry.folder);
      tagged = found.filter((f) => f.bytesRemovable > 0);

      if (found.length === 0) {
        summary.textContent = 'No MP3 files in this folder.';
        stripBtn.disabled = true;
        return;
      }
      if (tagged.length === 0) {
        summary.textContent = `${found.length} MP3(s), none carrying tags.`;
        stripBtn.disabled = true;
        return;
      }

      const total = tagged.reduce((sum, f) => sum + f.bytesRemovable, 0);
      summary.textContent = `${tagged.length} of ${found.length} MP3(s) carrying ${formatBytes(total)} of tags`;
      stripBtn.disabled = false;

      tagged.forEach((file) => {
        const node = el('div', 'prev');
        node.append(el('div', 'prev__to prev__to--same', file.name));
        const parts = [];
        if (file.hasV2) parts.push(`ID3v2 ×${file.v2Count}`);
        if (file.hasV1) parts.push('ID3v1');
        node.append(
          el('div', 'prev__to', `${parts.join(' + ')} — ${formatBytes(file.bytesRemovable)}`)
        );
        list.append(node);
      });
    } catch (err) {
      summary.textContent = err.message;
      stripBtn.disabled = true;
    }
  }

  stripBtn.addEventListener('click', async () => {
    stripBtn.disabled = true;
    stripBtn.textContent = 'Working…';
    const results = await window.api.id3Strip(tagged.map((f) => f.path));
    const changed = results.filter((r) => r.changed);
    const saved = changed.reduce((sum, r) => sum + r.removed, 0);
    toast('Tags stripped', `${changed.length} file(s), ${formatBytes(saved)} removed`);
    stripBtn.textContent = 'Strip tags';
    scan();
  });

  scan();
}

/* ============================== dedupe ============================= */

$('openDedupe').addEventListener('click', () => {
  view = 'dedupe';
  render();
});

function renderDedupe() {
  viewEl.innerHTML = '';

  const head = el('div', 'section');
  head.append(headRow('Sample cleanup'));
  head.append(
    el(
      'div',
      'callout callout--warn',
      'Only Samples/Imported is examined — the pack material Collect All copied in. Processed, Recorded, stems and bounces are never touched, because those exist nowhere else. Duplicates are replaced with links, not deleted: every path keeps working and every session still opens.'
    )
  );

  const actions = el('div', 'tabs');
  const scanBtn = el('button', 'pill pill--solid', 'Scan for duplicates');
  const linkBtn = el('button', 'pill', 'Link selected');
  linkBtn.disabled = true;
  actions.append(scanBtn, linkBtn);
  head.append(actions);

  const status = el('p', 'muted');
  status.style.marginTop = '12px';
  head.append(status);

  const list = el('div');
  head.append(list);
  viewEl.append(head);

  function paint() {
    list.innerHTML = '';
    const { groups } = dedupeState;
    if (groups.length === 0) return;

    const total = groups.reduce((sum, g) => sum + g.wasted, 0);
    status.textContent = `${groups.length} duplicate group(s) across ${dedupeState.folders} Imported folder(s) — ${formatBytes(total)} reclaimable`;

    const header = el('div', 'dupe');
    header.append(el('span'));
    header.append(el('span', 'th', 'Sample'));
    header.append(el('span', 'th', 'Copies'));
    header.append(el('span', 'th', 'Wasted'));
    list.append(header);

    groups.slice(0, 400).forEach((group, index) => {
      const row = el('div', 'dupe');

      const check = el('input', 'check');
      check.type = 'checkbox';
      check.checked = dedupeState.chosen.has(index);
      check.addEventListener('change', () => {
        if (check.checked) dedupeState.chosen.add(index);
        else dedupeState.chosen.delete(index);
        linkBtn.disabled = dedupeState.chosen.size === 0;
        linkBtn.textContent = `Link selected (${dedupeState.chosen.size})`;
      });
      row.append(check);

      const middle = el('div');
      middle.append(el('div', 'dupe__name', group.files[0].name));
      middle.append(
        el(
          'div',
          'dupe__where',
          group.files.map((f) => f.project).join(', ') +
            (group.crossVolume ? '  ·  spans drives, only same-drive copies link' : '')
        )
      );
      row.append(middle);

      row.append(el('div', 'dupe__num', `${group.count} × ${formatBytes(group.size)}`));
      row.append(el('div', 'dupe__num dupe__num--waste', formatBytes(group.wasted)));

      list.append(row);
    });
  }

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning…';
    status.textContent = 'Looking for Imported folders…';
    list.innerHTML = '';

    const result = await window.api.dedupeScan();
    dedupeState = { ...result, chosen: new Set() };

    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan again';
    linkBtn.disabled = true;

    if (result.groups.length === 0) {
      status.textContent = `Nothing duplicated. ${result.scanned} sample(s) checked across ${result.folders} Imported folder(s).`;
      return;
    }
    paint();
  });

  linkBtn.addEventListener('click', async () => {
    const chosen = [...dedupeState.chosen].map((i) => dedupeState.groups[i]);
    if (chosen.length === 0) return;

    const result = await window.api.dedupeLink(chosen);
    if (result.cancelled) return;

    toast(
      'Linked',
      `${result.linked} copies replaced with links · ${formatBytes(result.reclaimed)} reclaimed`
    );
    dedupeState.chosen = new Set();
    linkBtn.disabled = true;
    paint();
  });

  window.api.onDedupeProgress(({ done, total }) => {
    status.textContent = `Comparing ${done} of ${total} candidates…`;
  });
}

/* ============================== records ============================ */

function record(key) {
  return (
    records[key] || {
      note: '',
      stemsPath: null,
      key: null,
      camelot: null,
      keyConfidence: 0,
      favourite: false
    }
  );
}

async function saveRecord(key, patch) {
  const updated = await window.api.setRecord(key, patch);
  records[key] = updated;
  return updated;
}

/* ============================== settings =========================== */

function renderRootList() {
  const list = $('rootList');
  list.innerHTML = '';

  if (settings.roots.length === 0) {
    list.append(el('p', 'muted', 'Nothing added yet.'));
    return;
  }

  settings.roots.forEach((root) => {
    const item = el('div', 'root');
    const text = el('div');
    text.append(el('div', 'root__name', basename(root)));
    text.append(el('div', 'root__path', root));
    item.append(text);
    item.append(
      el('div', 'root__count', String(entries.filter((e) => e.root === root).length))
    );

    const remove = el('button', 'pill pill--sm', 'Remove');
    remove.addEventListener('click', async () => {
      settings = await window.api.removeRoot(root);
      applySettings();
      refresh();
    });
    item.append(remove);
    list.append(item);
  });
}

$('addRoot').addEventListener('click', async () => {
  const result = await window.api.addRoot();
  settings = result.settings;
  applySettings();
  result.messages.forEach((message) => toast('Folder list', message));
  refresh();
});

let ignoreTimer = null;
$('ignoreInput').addEventListener('input', () => {
  if (ignoreTimer) clearTimeout(ignoreTimer);
  ignoreTimer = setTimeout(async () => {
    settings = await window.api.updateSettings({
      ignore: $('ignoreInput')
        .value.split(',')
        .map((n) => n.trim())
        .filter(Boolean)
    });
    refresh();
  }, 600);
});

$('alwaysOnTop').addEventListener('change', async () => {
  settings = await window.api.updateSettings({ alwaysOnTop: $('alwaysOnTop').checked });
});

const followLinksEl = $('followLinks');
if (followLinksEl) {
  followLinksEl.addEventListener('change', async () => {
    settings = await window.api.updateSettings({
      followLinks: followLinksEl.checked
    });
    refresh();
  });
}

$('pollWatching').addEventListener('change', async () => {
  settings = await window.api.updateSettings({ pollWatching: $('pollWatching').checked });
});

$('openDataDir').addEventListener('click', () => window.api.reveal(settings.dataDir));
$('openSettings').addEventListener('click', openSheet);
$('closeSettings').addEventListener('click', closeSheet);
scrimEl.addEventListener('click', closeSheet);

function openSheet() {
  sheetEl.hidden = false;
  scrimEl.hidden = false;
}
function closeSheet() {
  sheetEl.hidden = true;
  scrimEl.hidden = true;
}

/* ============================== wiring ============================= */

$('rescan').addEventListener('click', refresh);
searchEl.addEventListener('input', () => {
  if (view !== 'list') view = 'list';
  render();
});

favFilterEl.addEventListener('click', () => {
  favOnly = !favOnly;
  favFilterEl.classList.toggle('is-on', favOnly);
  view = 'list';
  render();
  renderCollections();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!sheetEl.hidden) return closeSheet();
    if (view !== 'list') {
      view = 'list';
      render();
    }
  }
  if (event.key === ' ' && event.target === document.body) {
    event.preventDefault();
    Player.toggle();
  }
});

Player.onChange(({ path: playing }) => {
  document.querySelectorAll('.row, .filerow').forEach((node) => {
    node.classList.remove('is-playing');
  });
  if (!playing) return;
  document.querySelectorAll('.filerow').forEach((node) => {
    if (node.dataset.path === playing) node.classList.add('is-playing');
  });
});

window.api.onBounce((bounce) => {
  toast('New bounce', `${bounce.label} · ${bounce.formats.join(' + ').toUpperCase()}`);
  if (view === 'list') refresh();
});

window.api.onNoteRenamed(() => {
  /* the status line updates on next load; nothing to do here */
});

/* ============================== helpers ============================ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function headRow(title, subtitle) {
  const head = el('div', 'section__head');
  head.append(el('h3', null, title));
  if (subtitle) head.append(el('span', 'muted', subtitle));
  return head;
}

function showSpinner(title, body) {
  viewEl.innerHTML = '';
  const wrap = el('div', 'empty');
  wrap.append(el('div', 'spinner'));
  wrap.append(el('h2', null, title));
  wrap.append(el('p', null, body));
  viewEl.append(wrap);
}

function renderEmpty(title, body) {
  const wrap = el('div', 'empty');
  wrap.append(el('h2', null, title));
  wrap.append(el('p', null, body));
  const btn = el('button', 'pill pill--solid', 'Open settings');
  btn.addEventListener('click', openSheet);
  wrap.append(btn);
  viewEl.append(wrap);
}

function sep() {
  return settings && settings.platform === 'win32' ? '\\' : '/';
}

function basename(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function shortName(p) {
  return basename(p);
}

function formatBpm(bpm) {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function timeAgo(ms) {
  if (!ms) return '—';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function toast(title, body, isAlert) {
  const node = el('div', `toast${isAlert ? ' toast--alert' : ''}`);
  node.append(el('div', 'toast__title', title));
  node.append(el('div', 'toast__body', body));
  toastsEl.append(node);
  setTimeout(() => node.remove(), 7000);
}

boot();
