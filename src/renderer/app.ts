/**
 * Runs inside the window. No file access — everything goes through
 * window.api, defined in preload.js.
 *
 * The project list, project page and standalone tools share the main pane.
 */

import { Player } from './player';
import { DSP } from './dsp';
import { parseQuery, hasQuery, matchesQuery } from './search';
import { findMatches } from './matching';

const $ = (id: string): any => document.getElementById(id);

const viewEl = $('view');
const collectionsEl = $('collections');
const searchEl = $('search');
const toastsEl = $('toasts');
const favFilterEl = $('favFilter');
const backBtn = $('backBtn');
const sheetEl = $('sheet');
const scrimEl = $('scrim');
const themeToggleEl = $('themeToggle');

function applyTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('theme-light', light);
  themeToggleEl.textContent = light ? 'Dark mode' : 'Light mode';
  themeToggleEl.setAttribute('aria-pressed', String(light));
}

const savedTheme = localStorage.getItem('dawBuddyTheme');
applyTheme(savedTheme === 'light' ? 'light' : 'dark');

themeToggleEl.addEventListener('click', () => {
  const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  localStorage.setItem('dawBuddyTheme', next);
  applyTheme(next);
});

/* ============================== state ============================== */

let settings = null;
let records = {};
let entries = [];
let groupedRows = [];
let groupVersionsOn = true;
let expanded = new Set();
let browsing = null;
let view = 'list';
let openProject = null;
let projectTab = 'projectfiles';
let projectTool = null;
let selected = null;
let filterRoot = null;
let filterDaw = null;
let favOnly = false;
let sortBy = 'modified';
let sortDir = -1;
const noteTimers = new Map();
let dedupeState = { groups: [], scanned: 0, folders: 0, chosen: new Set<number>() };
let silenceProgressStatus = null;
let qcProgressStatus = null;
let dedupeProgressStatus = null;
let activeNoteEditor = null;
let id3Folder = null;
let id3Files = [];
let id3Selected = new Set();

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
  groupedRows = result.grouped || [];

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
  if (view === 'id3') return renderId3Editor();
  if (view === 'silence') return renderStandaloneSilence();
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
  projectTab = 'projectfiles';
  projectTool = null;
  renameFolder = entry.folder;
  silenceFolder = entry.folder;
  silenceResults = [];
  silenceChosen = new Set();
  qcFolder = entry.folder;
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

  const shown = groupVersionsOn && groupedRows.length ? groupedRows.length : entries.length;
  const all = collButton('All projects', shown);
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

  // Grouping toggle. The raw file count stays visible next to it, so the
  // number never looks like projects went missing.
  const groupRow = el('button', 'coll');
  groupRow.append(
    el('span', 'coll__name', groupVersionsOn ? 'Grouping versions' : 'Every file')
  );
  groupRow.append(el('span', 'coll__count', `${entries.length} files`));
  if (groupVersionsOn) groupRow.classList.add('is-on');
  groupRow.addEventListener('click', () => {
    groupVersionsOn = !groupVersionsOn;
    expanded = new Set();
    view = 'list';
    render();
    renderCollections();
  });
  collectionsEl.append(groupRow);

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

  // DAWs actually present. Never list one with zero projects.
  const daws = new Map();
  entries.forEach((entry) => {
    if (!entry.daw) return;
    daws.set(entry.daw, (daws.get(entry.daw) || 0) + 1);
  });

  if (daws.size > 1) {
    collectionsEl.append(el('div', 'coll__label', 'DAWs'));
    [...daws.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([daw, count]) => {
        const item = collButton(daw, count);
        if (filterDaw === daw) item.classList.add('is-on');
        item.addEventListener('click', () => {
          filterDaw = filterDaw === daw ? null : daw;
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
  const q = parseQuery(searchEl.value);
  const active = hasQuery(q);
  const source = groupVersionsOn && groupedRows.length ? groupedRows : entries;

  let list = source.filter((entry) => {
    if (filterRoot && entry.root !== filterRoot) return false;
    if (filterDaw && entry.daw !== filterDaw) return false;
    if (favOnly && !record(entry.path).favourite) return false;
    if (!active) return true;
    return matchesQuery(entry, record(entry.path), q);
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

  list.forEach((entry) => {
    viewEl.append(buildRow(entry));

    if (entry.isGroup && expanded.has(entry.path)) {
      entry.versions.forEach((version) => viewEl.append(buildVersionRow(version)));
    }
  });
}

// NOTE: buildVersionRow is referenced by the grouped-versions expand path but
// never defined — a latent ReferenceError. Aliased to buildRow (a version is
// itself a session entry) so expanding a group renders rows rather than
// throwing. Revisit when the grouping feature is built out.
function buildVersionRow(entry) {
  return buildRow(entry);
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
  if (entry.isGroup && entry.versionCount > 1) {
    const open = expanded.has(entry.path);
    const badge = el(
      'button',
      'badge badge--inside',
      `${open ? '▾' : '▸'} ${entry.versionCount} versions`
    );
    badge.title = 'Every version of this in the same folder';
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      if (open) expanded.delete(entry.path);
      else expanded.add(entry.path);
      render();
    });
    line.append(badge);
  } else if (!entry.isGroup && entry.siblingCount > 1 && !groupVersionsOn) {
    line.append(el('span', 'badge', `${entry.siblingCount} in folder`));
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
  row.addEventListener('dblclick', () =>
    goProject(entry.isGroup ? entry.versions[0] : entry)
  );
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

  const crumbs = el('div', 'breadcrumbs');
  const backToProjects = el('button', 'breadcrumb__link', 'Projects');
  backToProjects.addEventListener('click', () => goList(null));
  crumbs.append(backToProjects);
  const places = String(entry.location || '').split(/[\\/]/).filter(Boolean).slice(-3);
  places.forEach((place) => {
    crumbs.append(el('span', 'breadcrumb__sep', '/'));
    crumbs.append(el('span', 'breadcrumb__part', place));
  });
  crumbs.append(el('span', 'breadcrumb__sep', '/'));
  crumbs.append(el('span', 'breadcrumb__current', entry.name));
  viewEl.append(crumbs);

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
  open.disabled = !entry.sessionPath;
  open.addEventListener('click', () => openWithGuard(entry));
  actions.append(open);

  const reveal = el('button', 'pill', `Show in ${settings.fileManager}`);
  reveal.addEventListener('click', () =>
    window.api.reveal(entry.sessionPath)
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

  viewEl.append(actions);

  /* tabs */
  const tabs = el('div', 'tabs project-tabs');
  tabs.style.padding = '0 12px 18px';
  const projectTabs = [
    ['projectfiles', 'Project files'],
    ['renders', 'Renders'],
    ['stems', 'Stems'],
    ['notes', 'Notes & versions'],
    ['tools', 'Tools'],
    ['allaudio', 'All audio']
  ];
  if (entry.videoCount > 0) projectTabs.splice(1, 0, ['videos', 'Videos']);
  if (entry.bpm !== null || record(entry.path).camelot) projectTabs.push(['matches', 'Matches']);

  projectTabs.forEach(([key, label]) => {
    const tab = el('button', 'pill', label);
    if (projectTab === key) tab.classList.add('is-on');
    tab.addEventListener('click', () => {
      if (key === 'tools') projectTool = null;
      projectTab = key;
      render();
    });
    tabs.append(tab);
  });
  viewEl.append(tabs);

  if (projectTab === 'projectfiles') return renderProjectFilesTab(entry);
  if (projectTab === 'videos') return renderVideosTab(entry);
  if (projectTab === 'renders') return renderRendersTab(entry);
  if (projectTab === 'stems') return renderStemsTab(entry);
  if (projectTab === 'notes') return renderNotesTab(entry);
  if (projectTab === 'tools') return renderProjectToolsTab(entry);
  if (projectTab === 'allaudio') return renderAllAudioTab(entry);
  if (projectTab === 'matches') return renderMatchesTab(entry);
  return renderProjectFilesTab(entry);
}

/**
 * Cross-project harmonic + tempo matches for this project. Excludes the
 * project's own folder so it surfaces genuinely different work you could mix
 * or collab with. Logic + tests live in matching.ts.
 */
function renderMatchesTab(entry) {
  const rec = record(entry.path);
  const others = entries.filter((e) => e.folder !== entry.folder);
  const matches = findMatches(entry, rec, others, (e) => record(e.path));

  const section = el('div', 'section');
  section.append(headRow('Compatible projects'));
  section.append(
    el(
      'div',
      'callout',
      'Projects that mix well with this one — the same or a neighbouring Camelot key, and a matching tempo (half- and double-time count). Analyse a render on a project to detect its key.'
    )
  );

  if (!matches.length) {
    section.append(el('p', 'muted', 'No harmonically compatible projects found yet.'));
    viewEl.append(section);
    return;
  }

  const list = el('div');
  matches.slice(0, 60).forEach((m) => {
    const r = record(m.entry.path);
    const row = el('button', 'filerow');
    const main = el('div', 'filerow__main');
    main.append(el('div', 'filerow__name', m.entry.name));
    const reasons = [m.keyRelation, m.tempoRelation].filter(Boolean).join(' · ');
    const bits = [
      m.entry.bpm ? `${formatBpm(m.entry.bpm)} BPM` : null,
      r.camelot ? `${r.key || ''} (${r.camelot})`.trim() : r.key || null,
      m.entry.location,
      reasons
    ].filter(Boolean);
    main.append(el('div', 'filerow__meta', bits.join('  —  ')));
    row.append(main);
    row.addEventListener('click', () => goProject(m.entry));
    list.append(row);
  });
  section.append(list);
  viewEl.append(section);
}

function renderProjectToolsTab(entry) {
  if (projectTool) {
    const backBar = el('div', 'tool-back');
    const back = el('button', 'breadcrumb__link', '← All tools');
    back.addEventListener('click', () => {
      projectTool = null;
      render();
    });
    backBar.append(back);
    viewEl.append(backBar);

    if (projectTool === 'rename') return renderRenameTab(entry);
    if (projectTool === 'silence') return renderSilenceTab(entry);
    if (projectTool === 'qc') return renderQcTab(entry);
  }

  const section = el('div', 'section');
  section.append(headRow('Tools'));
  section.append(
    el(
      'div',
      'callout',
      'Choose a job when you need it. Keeping these utilities together leaves the project page focused on the music, files and versions.'
    )
  );

  const grid = el('div', 'tool-grid');
  [
    {
      key: 'rename',
      icon: 'Aa',
      title: 'Rename files',
      text: 'Clean up or standardise many audio filenames at once, with a preview before anything changes.'
    },
    {
      key: 'silence',
      icon: '✂',
      title: 'Strip silence',
      text: 'Find trailing silence in WAV files and make trimmed copies without touching the originals.'
    },
    {
      key: 'qc',
      icon: '✓',
      title: 'Check audio',
      text: 'Flag quiet files, silent files and loops that may drift or click when repeated.'
    }
  ].forEach((tool) => {
    const card = el('button', 'tool-card');
    card.type = 'button';
    card.append(el('span', 'tool-card__icon', tool.icon));
    const copy = el('span', 'tool-card__copy');
    copy.append(el('b', 'tool-card__title', tool.title));
    copy.append(el('span', 'tool-card__text', tool.text));
    card.append(copy, el('span', 'tool-card__open', 'Open →'));
    card.addEventListener('click', () => {
      projectTool = tool.key;
      render();
    });
    grid.append(card);
  });
  section.append(grid);
  viewEl.append(section);
}

/* ------------------------------ videos ---------------------------- */

function renderVideosTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Videos', basename(entry.folder)));

  const list = el('div');
  list.append(el('p', 'muted', 'Reading video files…'));
  section.append(list);
  viewEl.append(section);

  window.api
    .listVideos(entry.folder)
    .then((files) => {
      list.innerHTML = '';
      if (!files.length) {
        list.append(el('p', 'muted', 'No video files remain in this folder. Press Rescan to update the tab.'));
        return;
      }

      files.forEach((file) => {
        const row = el('div', 'filerow');
        row.append(el('div', 'projectfile__icon', file.ext.replace('.', '').toUpperCase()));

        const middle = el('div');
        middle.append(el('div', 'filerow__name', file.name));
        middle.append(
          el(
            'div',
            'filerow__meta',
            `${formatBytes(file.size)}  ·  ${timeAgo(file.modified)}`
          )
        );
        row.append(middle, el('span'));

        const actions = el('div', 'filerow__actions');
        const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
        reveal.addEventListener('click', (event) => {
          event.stopPropagation();
          window.api.reveal(file.path);
        });

        const open = el('button', 'pill pill--solid pill--sm', 'Open');
        open.addEventListener('click', async (event) => {
          event.stopPropagation();
          const error = await window.api.open(file.path);
          if (error) toast('Could not open video', error, true);
        });
        actions.append(reveal, open);
        row.append(actions);

        row.title = file.path;
        row.addEventListener('dblclick', () => window.api.open(file.path));
        list.append(row);
      });
    })
    .catch((error) => {
      list.innerHTML = '';
      list.append(el('p', 'muted', error.message));
    });
}

function fact(label, value) {
  const node = el('span');
  node.append(document.createTextNode(`${label} `));
  node.append(el('b', null, value));
  return node;
}

async function openWithGuard(entry) {
  const result = await window.api.openProject(entry.sessionPath, entry.name);
  if (result.cancelled) return;
  if (result.error) toast('Could not open', result.error, true);
}

/* --------------------------- project files ------------------------ */

function renderProjectFilesTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('Project files', basename(entry.folder)));
  section.append(
    el(
      'div',
      'callout',
      'Every DAW project file in this folder. Open the programmed version when you need to change the arrangement, or the bounced version when you need to render stems.'
    )
  );

  const files = entries
    .filter((candidate) => candidate.folder === entry.folder)
    .slice()
    .sort((a, b) => b.modified - a.modified);

  if (files.length === 0) {
    section.append(el('p', 'muted', 'No project files found in this folder.'));
    viewEl.append(section);
    return;
  }

  files.forEach((file) => {
    const row = el('div', 'filerow');
    row.append(
      el('div', 'projectfile__icon', file.ext.replace('.', '').toUpperCase())
    );

    const middle = el('div');
    middle.append(el('div', 'filerow__name', basename(file.sessionPath)));
    middle.append(
      el(
        'div',
        'filerow__meta',
        [
          file.daw,
          file.bpm !== null ? `${formatBpm(file.bpm)} BPM` : null,
          `${file.backupCount} save${file.backupCount === 1 ? '' : 's'}`,
          timeAgo(file.modified),
          formatBytes(file.size)
        ]
          .filter(Boolean)
          .join('  ·  ')
      )
    );
    row.append(middle);

    row.append(
      file.sessionPath === entry.sessionPath
        ? el('span', 'badge badge--packaged', 'Current page')
        : el('span')
    );

    const actions = el('div', 'tabs');
    const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
    reveal.addEventListener('click', (event) => {
      event.stopPropagation();
      window.api.reveal(file.sessionPath);
    });

    const open = el('button', 'pill pill--solid pill--sm', 'Open');
    open.addEventListener('click', async (event) => {
      event.stopPropagation();
      await openWithGuard(file);
    });
    actions.append(reveal, open);
    row.append(actions);

    row.title = file.sessionPath;
    row.addEventListener('dblclick', () => openWithGuard(file));
    section.append(row);
  });

  viewEl.append(section);
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

/* ------------------------------- stems --------------------------- */

function renderStemsTab(entry) {
  const section = el('div', 'section');
  const rec = record(entry.path);
  section.append(headRow('Stems', rec.stemsPath ? basename(rec.stemsPath) : 'No folder selected'));

  const controls = el('div', 'tabs');
  if (rec.stemsPath) {
    const reveal = el('button', 'pill pill--solid', `Open folder in ${settings.fileManager}`);
    reveal.addEventListener('click', () => window.api.reveal(rec.stemsPath));
    controls.append(reveal);
  }

  const choose = el(
    'button',
    'pill',
    rec.stemsPath ? 'Change stems folder' : 'Choose stems folder'
  );
  choose.addEventListener('click', async () => {
    const updated = await window.api.chooseStems(entry.path);
    if (updated) {
      records[entry.path] = updated;
      render();
    }
  });
  controls.append(choose);
  section.append(controls);

  if (!rec.stemsPath) {
    section.append(
      el(
        'div',
        'callout',
        'Choose the folder where you keep this project’s stems. Its audio files will then appear here.'
      )
    );
    viewEl.append(section);
    return;
  }

  const list = el('div');
  list.append(el('p', 'muted', 'Reading stems folder…'));
  section.append(list);
  viewEl.append(section);
  loadStems(entry, rec.stemsPath, list);
}

async function loadStems(entry, folder, container) {
  const files = await window.api.listAllAudio(folder);
  container.innerHTML = '';

  if (!files.length) {
    container.append(el('p', 'muted', 'No WAV, MP3, AIFF, FLAC or OGG files found in this folder.'));
    return;
  }

  files.forEach((file) => container.append(buildStemRow(entry, file)));
}

function buildStemRow(entry, file) {
  const row = el('div', 'filerow');
  const play = el('button', 'filerow__play', '▶');
  play.addEventListener('click', (event) => {
    event.stopPropagation();
    Player.load(file);
  });
  row.append(play);

  const middle = el('div');
  middle.append(el('div', 'filerow__name', file.name));
  middle.append(
    el(
      'div',
      'filerow__meta',
      [file.ext.replace('.', '').toUpperCase(), file.folder, formatBytes(file.size), timeAgo(file.modified)]
        .filter(Boolean)
        .join('  ·  ')
    )
  );
  row.append(middle, el('span'));

  const actions = el('div', 'filerow__actions');
  actions.append(analyseAudioButton(entry, file));
  const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
  reveal.addEventListener('click', (event) => {
    event.stopPropagation();
    window.api.reveal(file.path);
  });
  actions.append(reveal);
  row.append(actions);
  row.dataset.path = file.path;
  row.addEventListener('click', () => Player.load(file));
  return row;
}

function analyseAudioButton(entry, file) {
  const button = el('button', 'pill pill--sm', 'Analyse');
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    await analyseRender(entry, { primary: file }, button, { refresh: false });
  });
  return button;
}

async function analyseRender(entry, render, buttonEl, { refresh = true } = {}) {
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

  const result = DSP.analyse(decoded.getChannelData(0), decoded.sampleRate);

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

  if (refresh) render();
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
  activeNoteEditor = { sessionPath: entry.sessionPath, area };

  let dirty = false;
  window.api.loadNote(entry.sessionPath).then(({ text, file }) => {
    if (!dirty) area.value = text || '';
    status.textContent = file ? basename(file) : 'No note file yet';
  });

  area.addEventListener('input', () => {
    dirty = true;
    status.textContent = 'Typing…';
    const prior = noteTimers.get(entry.sessionPath);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(async () => {
      noteTimers.delete(entry.sessionPath);
      const { file } = await window.api.saveNote(entry.sessionPath, area.value);
      status.textContent = file ? `Saved · ${basename(file)}` : 'Note cleared';
    }, 500);
    noteTimers.set(entry.sessionPath, timer);
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
let renameMode = 'simple';

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
  /* mode: simple or template */
  const modeRow = el('div', 'tabs');
  modeRow.style.marginBottom = '12px';
  const simpleBtn = el(
    'button',
    `pill${renameMode === 'simple' ? ' is-on' : ''}`,
    'Remove & add'
  );
  const templateBtn = el(
    'button',
    `pill${renameMode === 'template' ? ' is-on' : ''}`,
    'Template'
  );
  modeRow.append(simpleBtn, templateBtn);
  section.append(modeRow);

  simpleBtn.addEventListener('click', () => {
    renameMode = 'simple';
    render();
  });
  templateBtn.addEventListener('click', () => {
    renameMode = 'template';
    render();
  });

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

  /* template mode controls */
  const templateWrap = el('div');
  const templateField = fieldInput('Template');
  templateField.input.placeholder = '{project}_{name}_{n:02}';
  templateField.input.value = '{project}_{name}_{n:02}';
  templateWrap.append(templateField.wrap);

  const tokens = el('div', 'callout');
  tokens.append(el('div', 'page__kicker', 'Tokens'));
  const tokenList = el('div', 'mono');
  tokenList.style.cssText = 'font-size:11.5px;line-height:1.9;margin-top:6px';
  [
    ['{name}', 'the existing filename'],
    ['{project}', entry.name],
    ['{parent}', basename(renameFolder)],
    ['{bpm}', entry.bpm !== null ? String(entry.bpm) : 'not read for this project'],
    ['{key}', record(entry.path).camelot || 'analyse a render first'],
    ['{date}', new Date().toISOString().slice(0, 10)],
    ['{n}, {n:02}', 'a counter, optionally padded']
  ].forEach(([token, meaning]) => {
    const line = el('div');
    line.append(el('span', null, token.padEnd(14)));
    line.append(el('span', 'muted', ` ${meaning}`));
    tokenList.append(line);
  });
  tokens.append(tokenList);
  templateWrap.append(tokens);

  if (renameMode === 'template') section.append(templateWrap);

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

    plan = await window.api.renamePlan(
      files,
      renameMode === 'template'
        ? {
            operation: 'applyTemplate',
            template: templateField.input.value,
            projectName: entry.name,
            parentFolder: basename(renameFolder),
            bpm: entry.bpm,
            key: record(entry.path).camelot || record(entry.path).key,
            startAt: 1
          }
        : {
            operation: 'removeAndAdd',
            remove: removeField.input.value,
            add: addField.input.value,
            position
          }
    );

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

  [removeField, addField, templateField].forEach((f) =>
    f.input.addEventListener('input', () => build())
  );

  // Hide whichever set of controls the current mode doesn't use.
  controls.hidden = renameMode === 'template';
  where.hidden = renameMode === 'template';

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

/* ----------------------------- silence ---------------------------- */

let silenceFolder = null;
let silenceResults = [];
let silenceChosen = new Set<number>();

function renderStandaloneSilence() {
  viewEl.innerHTML = '';
  renderSilenceTab(null);
}

function renderSilenceTab(entry = null) {
  if (!silenceFolder && entry) silenceFolder = entry.folder;

  const section = el('div', 'section');
  section.append(headRow('Strip silence'));
  section.append(
    el(
      'div',
      'callout callout--warn',
      'Trims trailing silence from WAV files. Your originals are never touched — trimmed copies are written to the output folder. Analyse first to see exactly what would be cut.'
    )
  );

  /* folder */
  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Reading WAVs from'));
  const folderPath = el('div', 'mono', silenceFolder || 'Choose a folder to begin');
  folderPath.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  folderBar.append(folderPath);

  const bar = el('div', 'tabs');
  const pick = el(
    'button',
    `pill${silenceFolder ? ' pill--sm' : ' pill--solid'}`,
    silenceFolder ? 'Choose a different folder' : 'Choose folder'
  );
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      silenceFolder = chosen;
      silenceResults = [];
      silenceChosen = new Set();
      render();
    }
  });
  bar.append(pick);
  if (entry) {
    const useProject = el('button', 'pill pill--sm', "This project's folder");
    useProject.addEventListener('click', () => {
      silenceFolder = entry.folder;
      silenceResults = [];
      silenceChosen = new Set();
      render();
    });
    bar.append(useProject);
  }
  folderBar.append(bar);
  section.append(folderBar);

  /* settings */
  const controls = el('div', 'grid2');

  const detectWrap = el('div', 'fieldrow');
  detectWrap.append(el('label', null, 'Detection'));
  const detectRow = el('div', 'tabs');
  let detection = 'RMS';
  const rmsBtn = el('button', 'pill is-on', 'RMS');
  rmsBtn.title = 'Averages over a window. Ignores isolated clicks.';
  const peakBtn = el('button', 'pill', 'Peak');
  peakBtn.title = 'A single sample above the floor counts as audio.';
  rmsBtn.addEventListener('click', () => {
    detection = 'RMS';
    rmsBtn.classList.add('is-on');
    peakBtn.classList.remove('is-on');
  });
  peakBtn.addEventListener('click', () => {
    detection = 'Peak';
    peakBtn.classList.add('is-on');
    rmsBtn.classList.remove('is-on');
  });
  detectRow.append(rmsBtn, peakBtn);
  detectWrap.append(detectRow);
  controls.append(detectWrap);

  const threshold = fieldInput('Threshold (dB)');
  threshold.input.value = '-72';
  controls.append(threshold.wrap);

  const tail = fieldInput('Leave a tail (ms)');
  tail.input.value = '10';
  tail.input.title =
    'Cutting at the exact sample where audio drops below the threshold truncates a decaying waveform and clicks. A few ms of padding avoids that.';
  controls.append(tail.wrap);

  section.append(controls);

  const actions = el('div', 'tabs');
  actions.style.marginTop = '6px';
  const analyseBtn = el('button', 'pill pill--solid', 'Analyse folder');
  analyseBtn.disabled = !silenceFolder;
  const processBtn = el('button', 'pill', 'Process selected');
  processBtn.disabled = true;
  actions.append(analyseBtn, processBtn);
  section.append(actions);

  const status = el('p', 'muted');
  silenceProgressStatus = status;
  status.style.marginTop = '12px';
  if (!silenceFolder) status.textContent = 'Choose any folder containing WAV files.';
  const list = el('div');
  section.append(status, list);
  viewEl.append(section);

  function options() {
    return {
      detection,
      thresholdDb: Number(threshold.input.value) || -72,
      tailMs: Number(tail.input.value) || 10
    };
  }

  function paint() {
    list.innerHTML = '';
    const usable = silenceResults.filter((r) => !r.error && !r.skip);

    if (silenceResults.length === 0) return;

    const total = usable.reduce((sum, r) => sum + r.removable, 0);
    status.textContent =
      `${usable.length} of ${silenceResults.length} file(s) have trailing silence — ` +
      `${total.toFixed(1)}s in total`;

    silenceResults.forEach((result, index) => {
      const row = el('div', 'dupe');

      const check = el('input', 'check');
      check.type = 'checkbox';
      check.disabled = Boolean(result.error || result.skip);
      check.checked = silenceChosen.has(index);
      check.addEventListener('change', () => {
        if (check.checked) silenceChosen.add(index);
        else silenceChosen.delete(index);
        processBtn.disabled = silenceChosen.size === 0;
        processBtn.textContent = `Process selected (${silenceChosen.size})`;
      });
      row.append(check);

      const middle = el('div');
      middle.append(el('div', 'dupe__name', result.name || basename(result.path)));
      middle.append(
        el(
          'div',
          'dupe__where',
          result.error
            ? `Skipped — ${result.error}`
            : result.skip
              ? result.reason
              : `${result.duration.toFixed(1)}s · ${result.sampleRate / 1000}k ${result.bits}-bit ${result.channels === 1 ? 'mono' : 'stereo'}`
        )
      );
      row.append(middle);

      row.append(
        el('div', 'dupe__num', result.error || result.skip ? '—' : `${result.duration.toFixed(1)}s`)
      );
      row.append(
        el(
          'div',
          'dupe__num dupe__num--waste',
          result.error || result.skip ? '' : `−${result.removable.toFixed(2)}s`
        )
      );

      list.append(row);
    });
  }

  analyseBtn.addEventListener('click', async () => {
    analyseBtn.disabled = true;
    analyseBtn.textContent = 'Analysing…';
    list.innerHTML = '';
    silenceChosen = new Set();
    processBtn.disabled = true;

    try {
      const files = await window.api.silenceList(silenceFolder);
      if (files.length === 0) {
        status.textContent = 'No WAV files in this folder.';
        silenceResults = [];
      } else {
        status.textContent = `Reading ${files.length} file(s)…`;
        silenceResults = await window.api.silenceAnalyse(
          files.map((f) => f.path),
          options()
        );
        // Everything with something to trim starts ticked.
        silenceResults.forEach((r, i) => {
          if (!r.error && !r.skip) silenceChosen.add(i);
        });
        processBtn.disabled = silenceChosen.size === 0;
        processBtn.textContent = `Process selected (${silenceChosen.size})`;
        paint();
      }
    } catch (err) {
      status.textContent = err.message;
    }

    analyseBtn.disabled = false;
    analyseBtn.textContent = 'Analyse folder';
  });

  processBtn.addEventListener('click', async () => {
    const paths = [...silenceChosen].map((i) => silenceResults[i].path);
    if (paths.length === 0) return;

    processBtn.disabled = true;
    processBtn.textContent = 'Processing…';

    try {
      const outcome = await window.api.silenceProcess(paths, options());
      if (!outcome.cancelled) {
        const done = outcome.results.filter((r) => r.success && r.modified);
        const failed = outcome.results.filter((r) => !r.success);
        const seconds = done.reduce((sum, r) => sum + (r.secondsRemoved || 0), 0);
        toast(
          'Silence removed',
          `${done.length} file(s), ${seconds.toFixed(1)}s trimmed` +
            (failed.length ? ` · ${failed.length} skipped` : ''),
          failed.length > 0
        );
      }
    } catch (err) {
      toast('Could not process', err.message, true);
    }

    processBtn.disabled = false;
    processBtn.textContent = `Process selected (${silenceChosen.size})`;
  });

  paint();
}

/* ------------------------------- QC ------------------------------- */

let qcFolder = null;

function renderQcTab(entry) {
  if (!qcFolder) qcFolder = entry.folder;

  const section = el('div', 'section');
  section.append(headRow('Check audio'));
  section.append(
    el(
      'div',
      'callout',
      'Reads every WAV in the folder and flags two things: files too quiet to sit in a mix, and loops whose length is not a whole number of beats — those drift or click when looped. Nothing is written.'
    )
  );

  const folderBar = el('div', 'callout');
  folderBar.append(el('div', 'page__kicker', 'Checking'));
  const fp = el('div', 'mono', qcFolder);
  fp.style.cssText = 'margin:6px 0 10px;word-break:break-all';
  folderBar.append(fp);
  const bar = el('div', 'tabs');
  const pick = el('button', 'pill pill--sm', 'Choose folder');
  pick.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (chosen) {
      qcFolder = chosen;
      render();
    }
  });
  const useProject = el('button', 'pill pill--sm', "This project's folder");
  useProject.addEventListener('click', () => {
    qcFolder = entry.folder;
    render();
  });
  bar.append(pick, useProject);
  folderBar.append(bar);
  section.append(folderBar);

  const controls = el('div', 'grid2');
  const quiet = fieldInput('Flag peaks below (dB)');
  quiet.input.value = '-12';
  const tol = fieldInput('Grid tolerance (% of a beat)');
  tol.input.value = '2';
  controls.append(quiet.wrap, tol.wrap);
  section.append(controls);

  const scanBtn = el('button', 'pill pill--solid', 'Check folder');
  const actions = el('div', 'tabs');
  actions.append(scanBtn);
  section.append(actions);

  const status = el('p', 'muted');
  qcProgressStatus = status;
  status.style.marginTop = '12px';
  const list = el('div');
  section.append(status, list);
  viewEl.append(section);

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Checking…';
    list.innerHTML = '';

    try {
      const result = await window.api.qcScan(qcFolder, {
        quietPeakDb: Number(quiet.input.value) || -12,
        gridTolerance: (Number(tol.input.value) || 2) / 100
      });

      status.textContent =
        `${result.scanned} file(s) checked · ${result.withIssues} with issues` +
        (result.unreadable ? ` · ${result.unreadable} unreadable` : '');

      const flagged = result.results.filter((r) => r.error || (r.issues && r.issues.length));
      if (flagged.length === 0) {
        list.append(el('p', 'muted', 'Nothing flagged — every file looks fine.'));
      }

      flagged.forEach((file) => {
        const row = el('div', 'filerow');

        const play = el('button', 'filerow__play', '▶');
        play.addEventListener('click', (event) => {
          event.stopPropagation();
          Player.load({ path: file.path, name: file.name, ext: '.wav' });
        });
        row.append(play);

        const middle = el('div');
        middle.append(el('div', 'filerow__name', file.name));
        middle.append(
          el(
            'div',
            'filerow__meta',
            file.error
              ? file.error
              : (file.issues || []).map((i) => i.detail).join('  ·  ')
          )
        );
        row.append(middle);

        const kinds = (file.issues || []).map((i) => i.kind);
        row.append(
          kinds.length
            ? el('span', 'badge badge--packaged', kinds.join(' + '))
            : el('span', 'badge', 'unreadable')
        );
        const actions = el('div', 'filerow__actions');
        if (file.duration) actions.append(el('span', 'cell', `${file.duration.toFixed(2)}s`));
        if (!file.error) {
          actions.append(
            analyseAudioButton(entry, { path: file.path, name: file.name, ext: '.wav' })
          );
        }
        row.append(actions);

        row.dataset.path = file.path;
        if (!file.error) {
          row.addEventListener('click', () =>
            Player.load({ path: file.path, name: file.name, ext: '.wav' })
          );
        }
        list.append(row);
      });
    } catch (err) {
      status.textContent = err.message;
    }

    scanBtn.disabled = false;
    scanBtn.textContent = 'Check folder';
  });

}

/* --------------------------- all audio ---------------------------- */

/**
 * Every audio file below this project, however deep — the flattened view.
 * Grouped by the folder each came from so it stays readable.
 */
function renderAllAudioTab(entry) {
  const section = el('div', 'section');
  section.append(headRow('All audio'));
  section.append(
    el(
      'div',
      'callout',
      'Every audio file anywhere below this project folder, flattened into one list. Samples, Backup and Freeze are skipped — those hold source material, not renders.'
    )
  );

  const list = el('div');
  section.append(list);
  viewEl.append(section);

  list.append(el('p', 'muted', 'Looking…'));

  window.api
    .deepAudio(entry.folder)
    .then((files) => {
      list.innerHTML = '';
      if (files.length === 0) {
        list.append(el('p', 'muted', 'No audio anywhere below this folder.'));
        return;
      }

      const byFolder = new Map();
      files.forEach((file) => {
        if (!byFolder.has(file.where)) byFolder.set(file.where, []);
        byFolder.get(file.where).push(file);
      });

      const total = files.reduce((sum, f) => sum + f.size, 0);
      list.append(
        el(
          'p',
          'muted',
          `${files.length} file(s) across ${byFolder.size} folder(s) · ${formatBytes(total)}`
        )
      );

      for (const [folder, group] of byFolder) {
        const heading = el('div', 'page__kicker', folder);
        heading.style.margin = '16px 0 6px';
        list.append(heading);

        group.slice(0, 200).forEach((file) => {
          const row = el('div', 'filerow');
          const play = el('button', 'filerow__play', '▶');
          play.addEventListener('click', (event) => {
            event.stopPropagation();
            Player.load(file);
          });
          row.append(play);

          const middle = el('div');
          middle.append(el('div', 'filerow__name', file.name));
          middle.append(
            el(
              'div',
              'filerow__meta',
              `${file.ext.replace('.', '').toUpperCase()}  ·  ${formatBytes(file.size)}  ·  ${timeAgo(file.modified)}`
            )
          );
          row.append(middle, el('span'), analyseAudioButton(entry, file));

          row.dataset.path = file.path;
          row.addEventListener('click', () => Player.load(file));
          list.append(row);
        });
      }
    })
    .catch((err) => {
      list.innerHTML = '';
      list.append(el('p', 'muted', err.message));
    });
}

/* ============================= ID3 editor ========================== */

$('openId3').addEventListener('click', () => {
  view = 'id3';
  viewEl.scrollTop = 0;
  render();
});

$('openSilence').addEventListener('click', () => {
  view = 'silence';
  silenceFolder = null;
  silenceResults = [];
  silenceChosen = new Set();
  viewEl.scrollTop = 0;
  render();
});

function renderId3Editor() {
  viewEl.innerHTML = '';
  const section = el('div', 'section');
  section.append(headRow('ID3 editor', id3Folder ? basename(id3Folder) : null));
  section.append(
    el(
      'div',
      'callout',
      'Choose a sample-pack folder. DAW Buddy finds MP3s in its subfolders and lets you replace their metadata with clean information or remove it completely. WAV, FLAC and AIFF files are left alone because ID3 is an MP3 tagging system.'
    )
  );

  const folderActions = el('div', 'tabs');
  const chooseBtn = el('button', 'pill pill--solid', id3Folder ? 'Change folder' : 'Choose folder');
  const revealBtn = el('button', 'pill', `Open folder in ${settings.fileManager}`);
  revealBtn.hidden = !id3Folder;
  revealBtn.addEventListener('click', () => window.api.reveal(id3Folder));
  folderActions.append(chooseBtn, revealBtn);
  section.append(folderActions);

  const editor = el('div', 'callout');
  editor.append(el('div', 'page__kicker', 'Clean metadata to write'));
  editor.append(
    el(
      'p',
      'muted',
      'These fields replace the existing tag, including unwanted author information and artwork. Blank fields are removed — except Title, which defaults to each file’s own name. Type a Title to set the same one on every file (include {filename} to keep the name too).'
    )
  );

  const fieldsGrid = el('div', 'grid2');
  const title = fieldInput('Title');
  title.input.placeholder = 'Each file keeps its own name';
  const artist = fieldInput('Artist');
  const album = fieldInput('Album');
  const albumArtist = fieldInput('Album artist');
  const composer = fieldInput('Composer / author');
  const publisher = fieldInput('Publisher');
  const copyright = fieldInput('Copyright');
  const genre = fieldInput('Genre');
  const year = fieldInput('Year');
  const comment = fieldInput('Comment');
  [title, artist, album, albumArtist, composer, publisher, copyright, genre, year, comment].forEach((field) =>
    fieldsGrid.append(field.wrap)
  );
  editor.append(fieldsGrid);
  section.append(editor);

  const selectionActions = el('div', 'tabs');
  const allBtn = el('button', 'pill pill--sm', 'Select all');
  const taggedBtn = el('button', 'pill pill--sm', 'Select tagged');
  const noneBtn = el('button', 'pill pill--sm', 'Select none');
  const writeBtn = el('button', 'pill pill--solid', 'Write clean metadata');
  const removeBtn = el('button', 'pill pill--danger', 'Remove all metadata');
  writeBtn.disabled = true;
  removeBtn.disabled = true;
  selectionActions.append(allBtn, taggedBtn, noneBtn, writeBtn, removeBtn);
  section.append(selectionActions);

  const status = el('p', 'muted', id3Folder ? 'Checking MP3s…' : 'Choose a folder to begin.');
  const list = el('div');
  section.append(status, list);
  viewEl.append(section);

  function selectedFiles() {
    return id3Files.filter((file) => id3Selected.has(file.path) && !file.error);
  }

  function updateButtons() {
    const count = selectedFiles().length;
    writeBtn.disabled = count === 0;
    removeBtn.disabled = count === 0;
    writeBtn.textContent = count ? `Write metadata (${count})` : 'Write clean metadata';
    removeBtn.textContent = count ? `Remove metadata (${count})` : 'Remove all metadata';
  }

  function paintFiles() {
    list.innerHTML = '';
    if (!id3Files.length) {
      if (id3Folder) list.append(el('p', 'muted', 'No MP3 files found in this folder or its subfolders.'));
      updateButtons();
      return;
    }

    const tagged = id3Files.filter((file) => file.bytesRemovable > 0).length;
    const unreadable = id3Files.filter((file) => file.error).length;
    status.textContent =
      `${id3Files.length} MP3(s) · ${tagged} carrying metadata · ${id3Selected.size} selected` +
      (unreadable ? ` · ${unreadable} unreadable` : '');

    id3Files.slice(0, 500).forEach((file) => {
      const row = el('div', 'filerow');
      const check = el('input', 'check');
      check.type = 'checkbox';
      check.disabled = Boolean(file.error);
      check.checked = id3Selected.has(file.path);
      check.addEventListener('click', (event) => event.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) id3Selected.add(file.path);
        else id3Selected.delete(file.path);
        paintFiles();
      });
      row.append(check);

      const middle = el('div');
      middle.append(el('div', 'filerow__name', file.name));
      middle.append(
        el(
          'div',
          'filerow__meta',
          file.error ? file.error : id3FieldSummary(file.fields, file.bytesRemovable)
        )
      );
      row.append(middle);
      row.append(
        file.bytesRemovable > 0
          ? el('span', 'badge badge--packaged', 'tagged')
          : el('span', 'badge', 'clean')
      );

      const actions = el('div', 'filerow__actions');
      actions.append(el('span', 'cell', formatBytes(file.size)));
      const reveal = el('button', 'pill pill--sm', `Show in ${settings.fileManager}`);
      reveal.addEventListener('click', (event) => {
        event.stopPropagation();
        window.api.reveal(file.path);
      });
      actions.append(reveal);
      row.append(actions);
      row.addEventListener('click', () => {
        if (file.error) return;
        if (id3Selected.has(file.path)) id3Selected.delete(file.path);
        else id3Selected.add(file.path);
        paintFiles();
      });
      list.append(row);
    });
    if (id3Files.length > 500) {
      list.append(
        el(
          'p',
          'muted',
          `Showing the first 500 files to keep the window fast. Selection buttons still apply to all ${id3Files.length}.`
        )
      );
    }
    updateButtons();
  }

  async function scan() {
    if (!id3Folder) return;
    status.textContent = 'Reading MP3 metadata…';
    list.innerHTML = '';
    try {
      id3Files = await window.api.id3Inspect(id3Folder);
      id3Selected = new Set(
        id3Files.filter((file) => !file.error && file.bytesRemovable > 0).map((file) => file.path)
      );
      paintFiles();
    } catch (error) {
      status.textContent = error.message;
      id3Files = [];
      id3Selected = new Set();
      updateButtons();
    }
  }

  chooseBtn.addEventListener('click', async () => {
    const chosen = await window.api.pickFolder();
    if (!chosen) return;
    id3Folder = chosen;
    id3Files = [];
    id3Selected = new Set();
    render();
  });

  allBtn.addEventListener('click', () => {
    id3Selected = new Set(id3Files.filter((file) => !file.error).map((file) => file.path));
    paintFiles();
  });
  taggedBtn.addEventListener('click', () => {
    id3Selected = new Set(
      id3Files.filter((file) => !file.error && file.bytesRemovable > 0).map((file) => file.path)
    );
    paintFiles();
  });
  noneBtn.addEventListener('click', () => {
    id3Selected = new Set();
    paintFiles();
  });

  writeBtn.addEventListener('click', async () => {
    const chosen = selectedFiles();
    if (!chosen.length) return;
    if (!window.confirm(`Replace the metadata in ${chosen.length} selected MP3 file(s)?\n\nThe audio itself will not change.`)) return;

    writeBtn.disabled = true;
    removeBtn.disabled = true;
    writeBtn.textContent = 'Writing…';
    const jobs = chosen.map((file) => {
      const filename = file.name.replace(/\.mp3$/i, '');
      return {
        path: file.path,
        fields: {
          title: title.input.value.trim()
            ? title.input.value.replace(/{filename}/g, filename)
            : filename,
          artist: artist.input.value,
          album: album.input.value,
          albumArtist: albumArtist.input.value,
          composer: composer.input.value,
          publisher: publisher.input.value,
          copyright: copyright.input.value,
          genre: genre.input.value,
          year: year.input.value,
          comment: comment.input.value
        }
      };
    });
    const results = await window.api.id3Write(jobs);
    const changed = results.filter((result) => result.changed).length;
    const failed = results.filter((result) => result.error).length;
    toast('Metadata written', `${changed} file(s)` + (failed ? ` · ${failed} failed` : ''), failed > 0);
    await scan();
  });

  removeBtn.addEventListener('click', async () => {
    const chosen = selectedFiles();
    if (!chosen.length) return;
    if (!window.confirm(`Remove all metadata from ${chosen.length} selected MP3 file(s)?\n\nThe audio itself will not change.`)) return;

    writeBtn.disabled = true;
    removeBtn.disabled = true;
    removeBtn.textContent = 'Removing…';
    const results = await window.api.id3Strip(chosen.map((file) => file.path));
    const changed = results.filter((result) => result.changed).length;
    const failed = results.filter((result) => result.error).length;
    toast('Metadata removed', `${changed} file(s)` + (failed ? ` · ${failed} failed` : ''), failed > 0);
    await scan();
  });

  if (id3Folder) scan();
}

function id3FieldSummary(fields, bytes) {
  const labels = [
    fields && fields.title ? `Title: ${fields.title}` : null,
    fields && fields.artist ? `Artist: ${fields.artist}` : null,
    fields && fields.album ? `Album: ${fields.album}` : null,
    fields && fields.composer ? `Author: ${fields.composer}` : null,
    fields && fields.genre ? `Genre: ${fields.genre}` : null,
    fields && fields.year ? `Year: ${fields.year}` : null
  ].filter(Boolean);
  if (labels.length) return labels.join('  ·  ');
  return bytes > 0 ? 'Metadata present (no common text fields)' : 'No metadata';
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
  const selectAllBtn = el('button', 'pill', 'Select all');
  const clearBtn = el('button', 'pill', 'Clear selection');
  const linkBtn = el('button', 'pill', 'Link selected');
  selectAllBtn.disabled = true;
  clearBtn.disabled = true;
  linkBtn.disabled = true;
  actions.append(scanBtn, selectAllBtn, clearBtn, linkBtn);
  head.append(actions);

  const status = el('p', 'muted');
  dedupeProgressStatus = status;
  status.style.marginTop = '12px';
  head.append(status);

  const list = el('div');
  head.append(list);
  viewEl.append(head);

  function updateSelectionControls() {
    const count = dedupeState.chosen.size;
    const total = dedupeState.groups.length;
    selectAllBtn.disabled = total === 0 || count === total;
    selectAllBtn.textContent = total ? `Select all (${total})` : 'Select all';
    clearBtn.disabled = count === 0;
    linkBtn.disabled = count === 0;
    linkBtn.textContent = count ? `Link selected (${count})` : 'Link selected';
  }

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
        updateSelectionControls();
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
    dedupeState = { ...result, chosen: new Set<number>() };

    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan again';
    updateSelectionControls();

    if (result.groups.length === 0) {
      status.textContent = `Nothing duplicated. ${result.scanned} sample(s) checked across ${result.folders} Imported folder(s).`;
      return;
    }
    paint();
  });

  selectAllBtn.addEventListener('click', () => {
    dedupeState.chosen = new Set(dedupeState.groups.map((group, index) => index));
    updateSelectionControls();
    paint();
  });

  clearBtn.addEventListener('click', () => {
    dedupeState.chosen = new Set();
    updateSelectionControls();
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
    updateSelectionControls();
    paint();
  });

  updateSelectionControls();
  paint();
}

/* ============================== records ============================ */

/** "F# min" -> "F#". The drone only needs the root. */
function rootNoteOf(rec) {
  if (!rec || !rec.key) return null;
  const match = String(rec.key).match(/^([A-G]#?)/);
  return match ? match[1] : null;
}

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

window.addEventListener('beforeunload', () => {
  if (!activeNoteEditor) return;
  const timer = noteTimers.get(activeNoteEditor.sessionPath);
  if (timer) {
    clearTimeout(timer);
    noteTimers.delete(activeNoteEditor.sessionPath);
  }
  // Invoking sends the request to the main process immediately. The main
  // process tracks the resulting write and waits for it during shutdown.
  window.api
    .saveNote(activeNoteEditor.sessionPath, activeNoteEditor.area.value)
    .catch(() => {});
});

/* ------------------------- audition controls ---------------------- */

/**
 * The drone needs a key, and the key comes from analysing a render — so the
 * button stays disabled until there's something to play. Better than a button
 * that silently does nothing.
 */
const droneBtn = $('droneBtn');
const verbBtn = $('verbBtn');
const clipBtn = $('clipBtn');

droneBtn.addEventListener('click', () => {
  if (Player.isDroning()) {
    Player.stopDrone();
    droneBtn.classList.remove('is-on');
    return;
  }

  const entry = openProject || entries.find((e) => e.path === selected);
  const rec = entry ? record(entry.path) : null;

  if (!rec || !rootNoteOf(rec)) {
    toast(
      'No key yet',
      'Analyse a render first — the drone plays the root note it finds.',
      true
    );
    return;
  }

  if (Player.startDrone(rootNoteOf(rec))) {
    droneBtn.classList.add('is-on');
    toast('Drone', `Holding ${rootNoteOf(rec)} underneath`);
  }
});

verbBtn.addEventListener('click', () => {
  const on = verbBtn.classList.toggle('is-on');
  Player.setReverb(on ? 0.35 : 0);
});

clipBtn.addEventListener('click', () => {
  const on = clipBtn.classList.toggle('is-on');
  Player.setSoftClip(on ? 0.4 : 0);
});

Player.onChange(({ path: playing }) => {
  document.querySelectorAll('.row, .filerow').forEach((node) => {
    node.classList.remove('is-playing');
  });
  if (!playing) return;
  document.querySelectorAll('.filerow').forEach((node) => {
    if ((node as HTMLElement).dataset.path === playing) node.classList.add('is-playing');
  });
});

window.api.onBounce((bounce) => {
  toast('New bounce', `${bounce.label} · ${bounce.formats.join(' + ').toUpperCase()}`);
  if (view === 'list') refresh();
});

window.api.onSilenceProgress(({ done, total, phase }) => {
  if (silenceProgressStatus) {
    silenceProgressStatus.textContent =
      `${phase === 'analyse' ? 'Analysing' : 'Processing'} ${done} of ${total}…`;
  }
});

window.api.onQcProgress(({ done, total }) => {
  if (qcProgressStatus) qcProgressStatus.textContent = `Reading ${done} of ${total}…`;
});

window.api.onDedupeProgress(({ done, total }) => {
  if (dedupeProgressStatus) {
    dedupeProgressStatus.textContent = `Comparing ${done} of ${total} candidates…`;
  }
});

window.api.onNoteRenamed(() => {
  /* the status line updates on next load; nothing to do here */
});

/* ============================== helpers ============================ */

function el(tag: string, className?: string | null, text?: any): any {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function headRow(title, subtitle?) {
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

function toast(title, body, isAlert?) {
  const node = el('div', `toast${isAlert ? ' toast--alert' : ''}`);
  node.append(el('div', 'toast__title', title));
  node.append(el('div', 'toast__body', body));
  toastsEl.append(node);
  setTimeout(() => node.remove(), 7000);
}

boot();
