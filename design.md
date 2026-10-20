# DAW Buddy — UI design brief for Stitch

Use this file to generate desktop UI ideas for **DAW Buddy**, a private desktop companion for music producers. It sits beside a DAW (Ableton, FL Studio, Logic, Pro Tools, Cubase, Bitwig, Studio One, REAPER). It does not replace the DAW.

**How to prompt Stitch.** Paste the *Product and visual system* section once, then paste **one screen or overlay at a time** from the catalogue below. Ask for a desktop frame around **1280×800**, dark surface first. Keep every control named in that screen. Do not merge screens. Do not invent login, billing, social feeds, or mobile navigation.

The product is one Electron window plus two extra windows (splash, mini player). Most “pages” swap inside the main content area. Overlays sit on top and must stay reachable from the screen that opens them.

---

## Product and visual system

**Who it is for.** Producers, mix engineers, and songwriters who have hundreds of session files and need BPM, key, Camelot code, versions, stems, and notes without launching a heavy DAW.

**Job of the UI.** Find a session fast, understand its musical facts, audition audio, drag a file or MIDI into the DAW, and run one utility at a time.

**Tone.** Studio tool, not a consumer music app. Dense but calm. Information first, decoration second. Comic energy is allowed only in the Theme Lab bubble.

**Type.** Inter for UI. IBM Plex Mono (or JetBrains Mono) for BPM, keys, paths, file sizes, and timestamps.

**Default surface.** Near-black workspace (`#0c1014` range), hairline borders, one electric accent. Default accent is electric cyan (`#00e5ff`). Text is off-white; secondary text is muted blue-grey.

**Other surfaces the design must survive.**

| Style | Surface | Accent examples |
|---|---|---|
| Minimalist | Dark, Light, AMOLED | Cyan, mint, lime, pink, mono |
| Ableton-like | Same three surfaces; project rows get a coloured left tag | Mint, magenta, yellow, sky, lavender, amber, coral |
| Studio Classic | Same three surfaces | Green, blue, yellow, amber, red |
| Bloo wireframe | Deep navy `#00253A`, outlined cards, Poppins-like type | Bloo `#0093ED`, soft cyan, sky, indigo, amber |

Light mode and AMOLED (pure black) are required variants of the same layout. Do not design a separate information architecture for them.

**Shared components.** Pill buttons (default, solid, small, active `is-on`). Round icon buttons. Counted sidebar rows. Sortable table headers. File rows with an extension badge, name, meta, and actions. Callout banners (neutral and warning). Empty states with a title, one sentence, and one action. Toasts (success and error) stacked bottom-right. Drag tiles labelled so a file can be dropped into a DAW. Gear hint (`⚙`) on controls that open a deeper panel.

**Safety copy that must stay visible on destructive-feeling tools.** Originals are never overwritten. Copies go to an output folder (`Music/DAW Buddy/…`). Linking duplicates does not delete files.

---

## App map

```
Splash window
First-run wizard (globe → output folder)
Main window
  Sidebar collections
  Top bar
  Content
    Projects list (+ folder browse, empty, no-match)
    This week
    Project page
      tabs: Project files, Videos*, Renders, Stems,
            Notes & variations, Tools, All audio, Matches*
      project tools: Randomizer, Renamer, Strip silence,
                     Trim audio, Check audio
    Tools hub
      Slowed + Reverb Studio
      Format Converter & Splitter
      Producer Randomizer
      Scale & Raaga Detector
      Sample cleanup
      Disk insights
      ID3 editor
      Renamer (Smart + Bulk)
      Audio finishing
      Strip silence
      Vocal reconstruction (Split | Rebuild)
  Transport bar (always)
Mini Player window (separate, always-on-top)
```

\* Videos appears only when the project folder has video. Matches appears only when BPM or a Camelot key is known.

---

## 1. Splash window

Separate small window, no chrome.

- Full-bleed muted intro video, or a centred logo if video fails.
- Bottom-left status: pulsing dot + “Starting DAW Buddy…”
- Top-right text button: “Skip ✕”.
- No menus, no progress percentage.

---

## 2. First-run / region setup wizard

Large centred modal. Two steps. Also reopenable from Settings as “3D Globe & Scale Setup”.

**Step 1 — Musical tradition.**

- Title: “Welcome to DAW Buddy — Choose Your Tradition” (settings reopen: “Musical Traditions & Regional Scales”).
- Interactive 3D globe. Clicking a region selects it.
- Region list: India & South Asia, Arabia & Egypt, China & East Asia, Western / Americas & Europe, Mediterranean & Spain, Celtic & Nordic.
- Scale-suggestion mode: All world traditions, or only the selected tradition, or a custom multi-select.
- Cards for a few scales in the chosen tradition: native name, western name, short description. Play ascending phrase, play descending phrase, drag a MIDI guide.
- Footer: step indicator, Next.

**Step 2 — Output storage.**

- Explain that renders land in one folder, split into tool subfolders: Format Converter, Slowed + Reverb, Audio Finishing, Trimmed, Vocal Stems.
- Path readout, “Choose folder”, default hint (OS Music folder / DAW Buddy).
- Back and “Start using DAW Buddy”.

---

## 3. Main window chrome

Persistent. Every content screen below sits inside this frame.

**Sidebar (left, ~240px).**

- Brand: logo, “DAW BUDDY”, live status “Watching projects” with a green dot.
- Collections, each a row with icon, name, count, active state:
  - All projects
  - This week
  - Favourites
  - Grouped (collapse versioned sessions into one row)
  - Every file (one row per session file)
- Section label “Folders”, then each watched root folder with a count.
- Section label “DAWs” (only if more than one DAW is present), each DAW name with a count. Examples: Ableton Live, FL Studio, Logic Pro.
- Footer actions, stacked: Tour, Tools, Settings.

**Top bar.**

- Back button (hidden on the root project list).
- Page title (Projects, project name, or tool name).
- Search field, placeholder “Search projects…”, with a ▾ that opens a tip bubble:
  - `bpm:140` or `bpm:120-145`
  - `key:8A` or `key:Am`
  - `daw:ableton` / `daw:logic`
  - `note:vocal`
  - plain text matches the name
- Sort menu (list only): Modified, Name, BPM, Key, Saves, Audio, Favourites first, Has notes. Caret shows direction.
- “Mini player”
- Theme pill: “Light mode” / “Dark mode”, plus a `⚙` that opens Theme Lab. Right-click does the same.
- “Favourites” filter pill.
- “Rescan”
- Switch: “On top” (keep window above the DAW).

**Transport (bottom, full width). Always visible.**

- Play button, now-playing title (“Nothing loaded” when idle), time `0:00 / 0:00`.
- Optional scale-modulation strip directly above the waveform (see overlay 29).
- Seekable waveform canvas.
- Chips: Metro, Drone, Verb (with `⚙` and a `✨` that opens Slowed + Reverb), Clip (with `⚙`).
- Volume slider.

---

## 4. Projects list

Default page. Title “Projects”.

- Optional kicker when browsing inside a folder: the folder path.
- Column header row: Name, BPM, Key, Audio, Saves, Modified. Name, BPM, Key, and Modified are sortable.
- Project row:
  - Optional Ableton-style colour tag on the left edge.
  - Multi-select handle.
  - Session name.
  - Badges as needed: DAW name, Fav, genre, Packaged, “N variations” (expandable).
  - BPM, key or Camelot, audio count, save/version count, relative modified time.
  - Hover reveals: favourite, open, show in file manager.
- Click opens the project page. Drag the row’s audio or session into a DAW.
- Expanded variation rows nest under the parent with the same columns.

**Empty — no folders yet.** Title “Add your projects folder”. Body: point Settings at the folder sessions live in. Button opens Settings.

**Empty — no matches.** Title “Nothing matches”. Body depends on search vs filter.

---

## 5. This week

Same frame. Sidebar “This week” is active.

- Title “This week”.
- Subtitle: “12 projects touched · 4 folders · 2 DAWs”, or “Nothing in the last seven days”.
- Same columns as the project list.
- Day group headers: Today, Yesterday, weekday names.
- Empty callout: nothing modified in seven days; a save will show up here.

---

## 6. Project page

Title becomes the session name. Back returns to the list.

**Sticky bar** (slides in after scrolling): BPM art tile, DAW badge, name, chips for BPM, time signature, key (Camelot), scale name, a mini piano keyboard, Open, colour dot, genre pill.

**Breadcrumb:** Projects / last few folders / current name.

**Header.**

- Large art tile showing BPM (or a note glyph).
- Kicker: DAW name. H1: project name.
- Fact chips: BPM, Time signature (click opens meter picker; may show Indian tala name), Key or Scale, Genre, Saves, Audio, Modified, Exported.
- Harmony panel on the right (or below on a narrow window):
  - If no key yet: banner “Demo Preview · A min (8A)” and “Analyse audio to detect real key”.
  - Piano keyboard with in-scale notes lit. Click a key to audition.
  - Guitar fretboard under or beside it, same highlighting, solfege / sargam on hover.
  - Actions: play scale, drone the root, drag scale MIDI to the DAW.
  - Clicking the keyboard area opens the Camelot inspector.

**Action row:** Open project, Show in Finder/Explorer, Favourite, Genre, Meter, colour swatch, Analyse (runs key/BPM/scale detection on a render).

**Missing-sample audit** (Ableton, when relevant): collapsible warning listing samples the session cannot find. Not a delete action.

**Tabs** (pill row). Design every tab as its own filled state:

### 6a. Project files

Callout: every DAW project file in this folder. Rows: select handle, extension badge (ALS, FLP, LOGICX…), filename, modified time, size, Open, Show in file manager. Double-click opens in the DAW.

### 6b. Videos

Only if videos exist. Rows: extension, name, size, relative time, Show in file manager, Open.

### 6c. Renders

Grouped by place: this folder, Renders, Bounces, Stems, Elsewhere. Each render row: waveform-ready name, duration, size, format pills **WAV / MP3 / FLAC** that drag straight out, play (loads the transport), analyse. Empty: no render matched the project name.

### 6d. Stems

Header shows the chosen stems folder or “No folder selected”. Actions: Open folder, Choose / Change stems folder, “Smart Rename stems”. Then the file list of that folder. Empty state asks for a folder.

### 6e. Notes & variations

Callout: notes save as a text file next to the project, per session file. Large textarea, placeholder “Mix notes, references, what to fix next time…”. Status line: “No note file yet” / “Typing…” / “Saved · filename”. Below: sibling versions in the same folder, each with a one-line note preview. Clicking a sibling opens that version.

### 6f. Project tools

A grid of five cards, then the chosen tool replaces the grid with a “← All tools” back link. Cards:

1. Producer Randomizer & Genre Challenge
2. Renamer — smart classifier and bulk patterns
3. Strip silence
4. Trim audio
5. Check audio

The tool bodies match screens 15, 18, 20, 21, and 22, but they stay inside the project page and default their folder to this project.

### 6g. All audio

Callout: every audio file under the project, except Samples, Backup, and Freeze. Flat list with play, drag-out format pills, size, relative path. Loading line: “Looking…”.

### 6h. Matches

Callout: other projects in a neighbouring Camelot key and a compatible tempo (half-time and double-time count). Rows: Camelot or BPM tile, name, BPM, key, location, reason badge (“relative major · double-time”). Click opens that project. Empty: no compatible projects yet.

---

## 7. Tools hub

Reached from the sidebar “Tools” button. Title “Tools”.

Short intro: utilities live here so the sidebar stays calm.

Card grid, each card is icon, title, one sentence, “Open →”:

1. Slowed + Reverb Studio — slow a track by speed or pitch and add stereo reverb.
2. Format Converter & Splitter — convert WAV/MP3 and split to a size or time limit.
3. Producer Randomizer & Genre Challenge — key, scale, raaga, BPM, tala, genre challenge.
4. Scale & Raaga Detector — drop audio or MIDI to detect BPM, key, scale, tuning, raagas.
5. Sample cleanup — find duplicate imported samples and replace extra copies with links.
6. Disk insights — which project folders use the most storage. Read-only.
7. ID3 editor — add, replace, or remove MP3 metadata in bulk.
8. Renamer — smart stem classifier and bulk filename patterns.
9. Audio finishing — normalise WAVs and optionally fit length to bars.
10. Strip silence — trim leading or trailing silence into copies.
11. Vocal reconstruction — split a long vocal, process elsewhere, rebuild on the original timeline.

Every card opens its own page. Each of those pages has a “← All tools” breadcrumb and a small Tutorial button.

---

## 8. Slowed + Reverb Studio

Exists twice: a full page, and a large modal opened from the Verb `✨` chip or from the reverb panel. Design both. Same controls.

- Title and subtitle about resampled slow-down plus Freeverb.
- Drop zone for an audio file. Chosen-file banner: name, duration, sample rate.
- Speed control: percent (for example 80%) **or** pitch in semitones. Make the mode switch obvious.
- Reverb: decay, room size, pre-delay, low cut, high cut, mix knob.
- Loudness normalise toggle.
- Process button.
- Result: seekable stereo waveform, play/pause, loop region optional.
- Export row: bit depth 16 / 24 / 32-bit float WAV, or MP3 128–320 kbps. Destination hint: `Slowed + Reverb/` under the output folder. Open-folder button.
- Modal variant adds a header and Close. Click outside or Escape closes it.

---

## 9. Format Converter & Splitter

- Destination card: “Output location: Format Converter/” plus the full path and “Open folder”.
- Drop zone: drag audio, or “Choose audio files”. Subcopy lists WAV, and MP3/AIFF when FFmpeg exists.
- Selected-files list: name, size in MB, remove, clear all.
- Card 1 — Target format: MP3 or WAV.
  - MP3: bitrate pills 128, 160, 192, 224, 256, 320.
  - WAV: bit depth 16 / 24 / 32-bit float, and sample-rate pills.
- Card 2 — Split rules: off, or by max size (default 50 MB) and/or max duration (default 5:00). Show a live estimate of part count, bytes, and duration.
- Card 3 — Cut behaviour: prefer silence gaps, pad with digital silence so parts stay a consistent length.
- Plan preview: a row per output part before anything is written.
- Primary button: Convert. Progress per file. Results list with reveal and drag-out.

---

## 10. Producer Randomizer & Genre Challenge

Hero, then a results board. This is the creative screen; it can be more playful than the file tools, still inside the studio chrome.

- Title, one-line description, Tutorial.
- Primary button: “Randomize Idea (Roll)” with a dice icon.
- Reroll row: tradition select (All world scales, Western, Indian classical, Arabic maqamat, Chinese pentatonic, Mediterranean & flamenco, Celtic folk), Reroll genre, Reroll key & scale, Reroll BPM, Reroll time signature.
- Metric cards:
  - **Genre challenge** — category badge, genre name, typical BPM range, short description, and a grouped dropdown to pick a genre instead of rolling. About 48 genres in 9 categories.
  - **Tempo** — big BPM. Minus and plus 1. Drag up/down on the number to scrub. Hint while dragging.
  - **Key & scale** — tonic, scale name, Camelot badge, tradition flag and subcategory. “Pick scale” opens a search of world scales and a root-note selector (C through B). Changing root keeps the scale and updates Camelot.
  - **Meter** — time signature and, when relevant, Indian tala name.
- Instrument block: piano keyboard and 6-string fretboard for the rolled scale. Click to audition. Labels can show scale degree, solfege, or sargam.
- Phrase row: play ascending (aaroh), play descending (avaroh), hold drone, drag MIDI guide to the DAW.
- Chord block: “8 most used progressions” and “all diatonic chords”. Each chord card shows the chord name and roman numeral, plays on click, and can be dragged as MIDI.
- YouTube inspiration block: a few search prompts for the rolled genre and key. Links only; no embedded player required.
- World-scale card rail filtered by the tradition select, with play and “use this scale”.

---

## 11. Scale & Raaga Detector

- Breadcrumb back to Tools. Title, subtitle, Tutorial.
- Large drop zone: “Drop audio sample or MIDI file here”. Types: WAV, MP3, FLAC, AIFF, OGG, MID. Browse button. Analysing state replaces the prompt with a spinner and “Analyzing musical content…”.
- Error callout if analysis fails.
- Results, once a file is loaded:
  - File header: name, audio vs MIDI, size, duration.
  - Metric cards: detected tempo with confidence, key and Camelot plus scale name, concert tuning (`A4 = 440.0 Hz` or detuned cents).
  - Interactive keyboard and fretboard. Click to audition at the detected tuning.
  - Actions: play scale, play drone, drag scale MIDI.
  - Chord-progression timeline detected from the file: horizontal cards, play/stop, drag progression MIDI.
  - Matching world traditions: raaga / maqam / mode cards with aaroh and avaroh, prahar or mood when the data has it.
  - **Key & scale matcher** (show this on the results, under the metrics):
    - Badge: “MIDI Transposer” or “Audio Pitch-Shift”.
    - Two columns: Detected source (tonic, scale, chord summary, roman analysis) and Target destination, with a clear arrow and the semitone shift between them.
    - Target scale dropdown. Root can be changed.
    - MIDI only: “Chromatic shift” vs “Harmonic scale remap”.
    - MIDI actions: audition transposed chords, drag transposed MIDI.
    - Audio actions: “Render pitch shift”, then a drag tile for the pitched WAV. Original is untouched.

---

## 12. Sample cleanup

Warning callout: only `Samples/Imported` is scanned. Processed, recorded, stems, and bounces are ignored. Duplicates become links, not deletions.

- Buttons: Scan for duplicates, Select all, Clear selection, Link selected (count in the label). Link stays disabled until something is selected.
- Status line: folders scanned, duplicate groups, reclaimable size.
- Group rows: hash or filename identity, wasted bytes, the paths that are copies, a checkbox per group, which path stays the original.
- Confirm step before linking (see overlay 32).

---

## 13. Disk insights

Neutral callout: read-only, nothing is deleted, scan stops at 250,000 files.

- “Scan disk usage” / “Scan again”, and “Cancel scan” while running.
- Status: folders measured, files, total bytes, plus flags if cancelled or truncated.
- Two ranked lists with size bars:
  - Largest project folders
  - Largest Samples / Imported folders
- Each row: folder name, path, size. No delete button.

---

## 14. ID3 editor

Callout: MP3s only. WAV, FLAC, and AIFF are skipped.

- Choose folder / Change folder, Open folder.
- “Clean metadata to write” form, two columns: Title (placeholder explains `{filename}`), Artist, Album, Album artist, Composer / author, Publisher, Copyright, Genre, Year, Comment. Blank fields are removed. Title defaults to each file name.
- Select all, clear, file checklist with current title/artist preview.
- Two commits: “Write tags” and “Strip all metadata”. Both need a confirm. Result toast with how many files changed.

---

## 15. Renamer

One page, two modes, switched by a segmented control. Standalone and inside a project.

**15a. Smart renamer.** “Classify & rename cryptic stems into mix-ready instrument categories.”

- Folder path and choose-folder.
- Optional banners: FL Studio empty-pattern cleaner, empty-track warning. Dismissible.
- Analyse button. Results are groups: Kicks, Snares, Basses, Leads, Vocals, FX, and anything uncertain.
- Each file shows the guessed category, a confidence hint, and an override dropdown. Overrides teach a personal dictionary.
- Multi-select. Preview of new names before writing.
- Apply, and a rollback list of past manifests so a rename can be undone.

**15b. Bulk renamer.** “Clean up prefixes, suffixes, or apply token templates.”

- Same folder bar.
- Find / replace, prefix, suffix, numbering, and a token template (`{name}`, `{n}`, `{category}`).
- Live before → after list.
- Apply writes copies or renames according to the existing safe pattern; show the pattern in the UI so it is obvious what will change.

---

## 16. Audio finishing

Warning callout: peak normalise and optional bar-fit. Copies go to the output folder. Short files are never stretched.

- Folder chooser.
- Toggles: Normalize peak, Fit to bars.
- Fields: target peak (dB, default −1), BPM, time signature, bar count.
- File list with checkboxes.
- Analyse preview: current peak, proposed length, whether the file will be trimmed.
- Process selected. Per-file success or skip reason.

---

## 17. Strip silence

Warning callout: leading, trailing, or both. Analyse before cutting. Originals stay. Copies go to the output folder.

- Folder chooser (pre-filled on the project page).
- Threshold (dB), padding (ms), side: start, end, both.
- Analyse. Each row shows silence found at the head and tail.
- Select rows, “Process selected (n)”.

---

## 18. Trim audio

Callout: drag two handles, audition the region on a loop, export a copy. WAV export only; other formats can be previewed. Original untouched.

- Folder chooser and file list.
- Large waveform with two crop handles and a shaded keep-region.
- Transport for the selection: play selection, loop.
- Time readouts for start, end, and length.
- “Save trimmed copy” into `Trimmed/`.

---

## 19. Check audio

Read-only. Callout: flag quiet files and loops whose length is not a whole number of beats.

- Folder path, Choose folder, “This project’s folder”.
- Fields: flag peaks below (dB, default −12), BPM, grid tolerance as a percent of a beat.
- Run check.
- Results split into Quiet, Silent, and Off-grid loop. Each row: name, measured peak or drift, no write action.

---

## 20. Vocal reconstruction

Warning callout: split a long vocal into phrases for external processing (Melodyne, Auto-Tune, ElevenLabs), then rebuild on the original timeline. Originals never move. Output sits beside the source and in `Vocal Stems/`.

Segmented tabs: **Split vocal** | **Rebuild timeline**.

**Split.**

- Folder, WAV list, select all / clear.
- Controls: silence threshold, minimum phrase length, padding.
- Preview: a phrase lane showing blocks on a timeline before export.
- “Split selected”. Result lists the phrase files in order.

**Rebuild.**

- Pick the manifest or the folder of processed phrases.
- Timeline comparing original timing to the returned files. Missing phrases are called out.
- “Rebuild” writes one WAV with sample-accurate gaps restored.
- Play the rebuild in the transport.

---

## 21. Settings sheet

Right-hand drawer over a scrim. Title “Settings”, Close. Long scroll. Design every section; do not collapse them into a single “preferences” blob.

1. **Appearance** — style pills: Minimalist, Ableton Like, Studio Classic, Bloo Wireframe. Swatches change with the style (list in the visual system). Surface: Dark, Light, AMOLED. Brightness and contrast sliders. Reset tuning. Reset theme.
2. **Graphics & animation scale** — 4-step slider: 0× off, 0.25×, 0.50× snappy, 1.0× full. GPU line: “Active (hardware accelerated)”.
3. **Musical traditions** — primary region select, scale-suggestion select (including Custom). Summary badge with flag. Button: “3D Globe & Scale Setup” (opens screen 2).
4. **Metronome & click tracks** — soundset select: Ableton, FL Studio, Logic, Cubase, Pro Tools default, Pro Tools marimba, Maschine, MPC, Reason, Sonar, electronic sine. “Audition 4/4 loop”. Drag box: BPM, time signature (4/4, 3/4, 6/8, 7/8, 5/4, 12/8), bars (2, 4, 8, 16). Two drag tiles: Drag audio (.wav), Drag MIDI (.mid).
5. **Project folders** — list of roots with remove, “Add folder”.
6. **Folder names to skip** — comma-separated text field.
7. **Bounce webhook** — optional URL for Discord, Slack, or Zapier. Blank means local only.
8. **External and network drives** — switch “Check the disk repeatedly”.
9. **Shortcuts and linked folders** — switch “Follow shortcuts and linked folders”, with a one-line warning about junctions.
10. **Output folder** — mono path box.
11. **Feature tour** — “Start feature walkthrough”.
12. **Version & updates** — installed version, “Check for updates (GitHub)”.
13. **Crash logging** — switch, “Open crash logs folder”. State that audio and project content are never logged.
14. **Where your data is stored** — mono path, “Show in folder”.

---

## 22. Theme Lab bubble

Comic speech bubble anchored under the theme pill, tail pointing at it. Not the settings drawer.

- Title “Theme Lab”, close.
- Mode: Dark, Light, AMOLED.
- Style: Minimal, Ableton Like, Classic, Bloo Wireframe.
- Accent dots for the active style.
- Choosing a swatch updates the whole app immediately, including this bubble.

---

## 23. Audition reverb panel

Small floating panel from the Verb gear. Not a full page.

- Title “Audition reverb”. “Settings stay with you between sessions”. Reset.
- Sliders: decay time, room size, pre-delay, low cut, high cut.
- Mix as a rotary knob with a percent readout.
- Full-width button into Slowed + Reverb Studio.
- Hint: click Verb to bypass, right-click to reopen.

## 24. Audition clipper panel

Sibling panel from the Clip gear.

- Title “Audition clipper”. Reset.
- Canvas: live transfer curve from −1 to +1.
- Curve pills: Hard, Tanh, Cubic, Atan, Quintic.
- Drive (0 to +18 dB) and ceiling (−6 to 0 dB).
- Hint: click Clip to bypass, right-click to reopen.

---

## 25. Camelot harmonic wheel & scale inspector

Large modal from the project keyboard.

- Title “Camelot Harmonic Wheel & Scale Inspector”. Subtitle: project name, detected key, concert pitch if not 440.
- Left: the 24-key Camelot wheel. Inner ring minor (A codes), outer ring major (B codes). Selected key highlighted. Neighbours (perfect fifth, relative major/minor) marked as compatible.
- Right inspector: Camelot badge, key name, thaat or mode name, piano, fretboard, compatible-key chips, play scale, drag MIDI.
- Close and Escape.

## 26. Assign project colour

Small modal. Palette of swatches plus a custom colour input. Preview dot. Save and cancel. The colour tints that project’s row tag and, in Ableton style, the project accent.

## 27. Assign project genre

Searchable list grouped by category. Current genre marked. Clear genre. Choosing one updates the genre pills on the project.

## 28. Time signature & Indian tala

Grid of meters (4/4, 3/4, 6/8, 7/8, 5/4, 12/8, and further tala meters already in the product). Each cell can show the tala name. Selecting one updates the project chip and the metronome.

## 29. Scale-modulation strip and section modal

Strip sits in the transport, above the waveform, only after an analysis finds key changes. Coloured segments proportional to time. Label: key and clock range. Click seeks. Double-click or right-click opens the section modal.

Modal: section title, time range, key, how it moved from the previous section (type and semitone shift). “Relative raagas & scales in this section” as cards. Play and drag MIDI for that section.

## 30. Sort menu and search-tips bubble

Small popovers. Sort: the eight options with the active one checked and an up/down glyph. Search tips: the five filter examples from the top bar. Both dismiss on outside click and Escape.

## 31. Feature tour

Spotlight overlay, not a separate page. Three tours share one chrome: a dim scrim, a highlight ring, a card with step title, short body, Back, Next, skip, and “3 of 8”.

**App tour:** Smart search, Collections, Tools suite, Transport, Drag and drop, Themes.

**Project tour:** Overview and open-in-DAW, scale keyboard, raaga phrases and MIDI drag, renders, format drag pills, on-demand analysis, stems, player and reverb.

**Per-tool tours:** one card sequence for Randomizer, Scale detector, Renamer, Strip silence, Audio finishing, Vocal split and rebuild, Sample cleanup, Disk insights, ID3. Each card points at the real control on that page.

## 32. Confirm, crash, and toasts

- **Confirm modal:** title, plain explanation, Cancel, and a primary action that can be destructive (red) or safe. Used before linking duplicates, writing tags, and similar.
- **Crash recovery:** appears after a bad shutdown. Short explanation, “Open the report”, “Dismiss”. No audio was recorded.
- **Toasts:** title plus one line. Error toasts look distinct from success. They do not cover the transport controls.

## 33. Mini player window

Separate always-on-top window, about 360×180, no OS traffic lights beyond the in-window buttons. Drag the header to move it.

- Header: status dot, track title (or “No audio loaded”), minimize-main-window, restore main window, hide mini player.
- Subline: project name.
- Waveform with a playhead. Click and drag to seek.
- Play/pause, “Repeat” toggle, time.
- “Drag” pill that drags the current file into a DAW track or a folder.

---

## States to show for every file-processing screen

Design at least these frames when you explore a tool: empty (no folder or no file), ready, busy (spinner and a status sentence), success (what was written and where), and a single-row error. Processing screens need a disabled primary button while work is running.

## Out of scope

Do not add accounts, cloud libraries, collaboration, a mixer, a piano-roll editor, or a plugin host. Drag-out targets are the user’s DAW and their folders. The app already has the features above; the job is a clearer, more beautiful layout of those features.
