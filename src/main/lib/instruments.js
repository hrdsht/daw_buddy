'use strict';

/**
 * The instrument dictionary.
 *
 * One file, every category. This is the thing that does the real work —
 * exports are almost always named something, even if badly:
 *
 *   kshmr_percussion_oneshot_tabla.wav   → percs_tabla
 *   insert 6_duff_4-4.wav                → percs_duff
 *   BD_hard_02.wav                       → drums_kick
 *
 * Audio analysis is the fallback for when the name genuinely says nothing.
 * A filename is evidence; a spectrum is an inference. Prefer the evidence.
 *
 * ------------------------------------------------------------------
 * MATCHING RULES
 *
 * 1. Whole tokens only. The name is split on separators and each token is
 *    compared in full. Substring matching would find "bass" inside "bassoon"
 *    and "kick" inside "kickstart" — this codebase has already been bitten
 *    once by that, when a Linux kernel thread called oom_reaper was detected
 *    as REAPER running.
 *
 * 2. Two-word phrases are checked before single tokens, so "bass drum"
 *    resolves to a kick rather than to a bass.
 *
 * 3. Later tokens win. In "kshmr_percussion_oneshot_tabla" both "percussion"
 *    and "tabla" match; the more specific one is further right, and is also
 *    the more specific match, so it takes precedence on both counts.
 *
 * 4. Specificity beats position when they disagree. A subtype match always
 *    beats a bare category match.
 * ------------------------------------------------------------------
 *
 * Adding entries is the intended way to improve this. Corrections made in the
 * UI are written to a separate user dictionary and merged over the top, so
 * this file stays clean and updates don't wipe what someone taught it.
 */

/**
 * category → subtype → the names that mean it.
 *
 * The subtype key is what appears in the output filename, so
 * `drums.kick` produces `drums_kick_1.wav`.
 */
const DICTIONARY = {
  /* ============================================================== */
  drums: {
    kick: ['kick', 'kik', 'kck', 'bd', 'bassdrum', 'bass drum', 'kickdrum', 'bombo', 'four on the floor'],
    snare: ['snare', 'snr', 'sn', 'sd', 'caisse', 'rullante'],
    rim: ['rim', 'rimshot', 'rim shot', 'sidestick', 'side stick', 'cross stick'],
    clap: ['clap', 'claps', 'handclap', 'hand clap', 'clp'],
    snap: ['snap', 'snaps', 'fingersnap', 'finger snap'],
    hihat: ['hihat', 'hi hat', 'hh', 'hat', 'hats', 'closedhat', 'closed hat', 'openhat', 'open hat', 'chh', 'ohh', 'pedal hat'],
    tom: ['tom', 'toms', 'floortom', 'floor tom', 'racktom', 'rack tom', 'lowtom', 'hightom', 'midtom'],
    cymbal: ['cymbal', 'cymbals', 'cym'],
    crash: ['crash', 'crashes'],
    ride: ['ride', 'rides'],
    splash: ['splash'],
    china: ['china', 'chinacymbal'],
    fill: ['fill', 'fills', 'drumfill', 'drum fill'],
    loop: ['drumloop', 'drum loop', 'drumbreak', 'break', 'breakbeat'],
    kit: ['drums', 'drum', 'drummer', 'drummers', 'drumkit', 'drum kit', 'kit', 'dr']
  },

  /* ============================================================== */
  percs: {
    // South Asian
    tabla: ['tabla', 'tablas', 'baya', 'bayan', 'dayan', 'tabla baya'],
    mridangam: ['mridangam', 'mridanga', 'mrudangam', 'mridang'],
    dhol: ['dhol'],
    dholak: ['dholak', 'dholki'],
    duff: ['duff', 'daf', 'dafli', 'def'],
    kanjira: ['kanjira', 'khanjira'],
    ghatam: ['ghatam', 'ghattam'],
    pakhawaj: ['pakhawaj', 'pakhavaj'],
    khol: ['khol'],
    chenda: ['chenda', 'chende'],
    thavil: ['thavil', 'tavil'],
    morsing: ['morsing', 'mursing', 'jawharp', 'jaw harp'],
    manjira: ['manjira', 'manjeera', 'jhanj', 'taal'],

    // Latin and Afro-Cuban
    conga: ['conga', 'congas', 'tumba', 'quinto'],
    bongo: ['bongo', 'bongos'],
    timbale: ['timbale', 'timbales'],
    cajon: ['cajon', 'cajón'],
    clave: ['clave', 'claves'],
    guiro: ['guiro', 'güiro'],
    cabasa: ['cabasa', 'afuche'],
    maraca: ['maraca', 'maracas'],
    agogo: ['agogo', 'agogô', 'agogobell'],
    surdo: ['surdo'],
    pandeiro: ['pandeiro'],
    repinique: ['repinique', 'repique'],
    cuica: ['cuica', 'cuíca'],
    tamborim: ['tamborim'],

    // Middle Eastern and Mediterranean
    darbuka: ['darbuka', 'darabuka', 'doumbek', 'dumbek', 'tabl'],
    riq: ['riq', 'rik'],
    bendir: ['bendir'],
    frame: ['framedrum', 'frame drum', 'bodhran', 'bodhrán'],

    // West African
    djembe: ['djembe', 'jembe'],
    dunun: ['dunun', 'doundoun', 'djun'],
    talkingdrum: ['talkingdrum', 'talking drum', 'dundun'],
    udu: ['udu'],
    shekere: ['shekere', 'sekere'],

    // East Asian
    taiko: ['taiko', 'wadaiko'],
    tsuzumi: ['tsuzumi'],

    // General and studio
    shaker: ['shaker', 'shakers', 'shk', 'egg', 'egg shaker', 'eggshaker'],
    tambourine: ['tambourine', 'tamb', 'tambo'],
    cowbell: ['cowbell', 'cow bell', 'bell'],
    woodblock: ['woodblock', 'wood block', 'block', 'clave block'],
    click: ['click', 'metronome', 'clave click'],
    triangle: ['triangle'],
    castanet: ['castanet', 'castanets'],
    sleighbell: ['sleighbell', 'sleigh bell', 'jinglebell'],
    rainstick: ['rainstick', 'rain stick'],
    vibraslap: ['vibraslap', 'vibra slap'],
    guiro_scrape: ['scraper', 'ratchet'],
    foley: ['foley', 'foot', 'stomp', 'stomps'],
    beatbox: ['beatbox', 'beatboxing', 'vocal perc', 'mouth perc'],
    generic: ['perc', 'percs', 'percussion', 'percussive', 'prc', 'hand percussion', 'ethnic']
  },

  /* ============================================================== */
  bass: {
    sub: ['sub', 'subbass', 'sub bass', '808', 'subs'],
    plucky: ['pluck', 'plucky', 'pluckbass', 'pluck bass'],
    reese: ['reese', 'reeses'],
    growl: ['growl', 'growls', 'neuro', 'neurobass'],
    acid: ['acid', 'acidbass', '303'],
    upright: ['upright', 'doublebass', 'double bass', 'contrabass'],
    electric: ['bassguitar', 'bass guitar', 'ebass', 'fingerbass', 'slapbass', 'slap bass', 'pickbass'],
    synth: ['synthbass', 'synth bass', 'sawbass', 'squarebass'],
    generic: ['bass', 'bs', 'low', 'lowend', 'low end']
  },

  /* ============================================================== */
  keys: {
    piano: ['piano', 'pno', 'grandpiano', 'grand piano', 'uprightpiano', 'keys piano', 'keyscape'],
    rhodes: ['rhodes', 'wurli', 'wurlitzer', 'epiano', 'e piano', 'electricpiano', 'electric piano'],
    organ: ['organ', 'hammond', 'b3', 'leslie', 'churchorgan', 'harmonium', 'mellotron'],
    clav: ['clav', 'clavinet', 'clavichord'],
    harpsichord: ['harpsichord', 'cembalo'],
    celesta: ['celesta', 'celeste'],
    accordion: ['accordion', 'accordian', 'squeezebox'],
    generic: ['keys', 'key', 'keyboard', 'kb']
  },

  /* ============================================================== */
  synth: {
    lead: ['lead', 'leads', 'ld', 'supersaw', 'super saw', 'saw lead'],
    pad: ['pad', 'pads', 'warmpad', 'strings pad', 'atmos', 'atmosphere'],
    pluck: ['synthpluck', 'synth pluck', 'plk', 'pluck', 'plucks'],
    arp: ['arp', 'arps', 'arpeggio', 'arpeggiator', 'sequence', 'seq'],
    chord: ['chord', 'chords', 'stab', 'stabs', 'hit'],
    bell: ['synthbell', 'fmbell', 'bells'],
    generic: ['synth', 'syn', 'synths', 'serum', 'massive', 'sylenth', 'omnisphere', 'vital', 'spire', 'nexus']
  },

  /* ============================================================== */
  mallets: {
    xylophone: ['xylophone', 'xylo'],
    marimba: ['marimba'],
    vibraphone: ['vibraphone', 'vibes', 'vibe'],
    glockenspiel: ['glockenspiel', 'glock', 'glocken'],
    kalimba: ['kalimba', 'mbira', 'thumbpiano', 'thumb piano'],
    tubularbells: ['tubularbells', 'tubular bells', 'chimes', 'chime'],
    handpan: ['handpan', 'hang', 'hangdrum', 'tongue drum'],
    steeldrum: ['steeldrum', 'steel drum', 'steelpan', 'pan'],
    generic: ['mallet', 'mallets']
  },

  /* ============================================================== */
  guitar: {
    acoustic: ['acoustic', 'acousticguitar', 'acoustic guitar', 'steelstring', 'dreadnought'],
    nylon: ['nylon', 'nylonguitar', 'classical guitar', 'spanish guitar'],
    electric: ['electric', 'electricguitar', 'electric guitar', 'egtr', 'strat', 'tele', 'lespaul'],
    clean: ['cleanguitar', 'clean guitar', 'cleangtr'],
    distorted: ['distorted', 'distortion', 'dist', 'crunch', 'overdrive', 'heavyguitar'],
    palmmute: ['palmmute', 'palm mute', 'chug', 'chugs'],
    slide: ['slide', 'slideguitar', 'lapsteel', 'lap steel', 'pedalsteel', 'dobro'],
    twelve: ['12string', 'twelvestring'],
    ukulele: ['ukulele', 'uke'],
    banjo: ['banjo'],
    mandolin: ['mandolin', 'mando'],
    sitar: ['sitar'],
    sarod: ['sarod'],
    veena: ['veena', 'vina'],
    oud: ['oud', 'ud'],
    bouzouki: ['bouzouki'],
    generic: ['guitar', 'gtr', 'gt']
  },

  /* ============================================================== */
  strings: {
    violin: ['violin', 'vln', 'fiddle'],
    viola: ['viola', 'vla'],
    cello: ['cello', 'vc', 'violoncello'],
    contrabass: ['contrabasses', 'basses'],
    ensemble: ['stringensemble', 'string ensemble', 'orchestra', 'orch', 'section'],
    pizzicato: ['pizzicato', 'pizz'],
    tremolo: ['tremolo', 'trem'],
    staccato: ['staccato', 'stacc', 'spiccato'],
    legato: ['legato', 'sustains', 'sus'],
    harp: ['harp'],
    erhu: ['erhu'],
    sarangi: ['sarangi'],
    generic: ['strings', 'string', 'str']
  },

  /* ============================================================== */
  brass: {
    trumpet: ['trumpet', 'tpt', 'cornet', 'flugelhorn', 'flugel'],
    trombone: ['trombone', 'tbn', 'bonе', 'bone'],
    frenchhorn: ['frenchhorn', 'french horn', 'horn', 'horns', 'horny'],
    tuba: ['tuba', 'sousaphone'],
    saxophone: ['sax', 'saxophone', 'altosax', 'alto sax', 'tenorsax', 'tenor sax', 'barisax', 'soprano sax'],
    ensemble: ['brassensemble', 'brass ensemble', 'brasssection', 'brass section'],
    generic: ['brass']
  },

  /* ============================================================== */
  /* Winds — added per request. Reeds and flutes, not brass.        */
  winds: {
    flute: ['flute', 'fl', 'concertflute'],
    bansuri: ['bansuri', 'bansri', 'indian flute'],
    shakuhachi: ['shakuhachi'],
    panflute: ['panflute', 'pan flute', 'panpipe', 'panpipes', 'quena'],
    recorder: ['recorder'],
    piccolo: ['piccolo'],
    clarinet: ['clarinet', 'bassclarinet'],
    oboe: ['oboe'],
    bassoon: ['bassoon', 'contrabassoon'],
    ocarina: ['ocarina'],
    whistle: ['whistle', 'tinwhistle', 'tin whistle', 'lowwhistle'],
    harmonica: ['harmonica', 'harp blues', 'bluesharp'],
    bagpipe: ['bagpipe', 'bagpipes', 'uilleann'],
    shehnai: ['shehnai', 'shenai', 'nadaswaram', 'nagaswaram'],
    duduk: ['duduk'],
    ney: ['ney', 'nay'],
    didgeridoo: ['didgeridoo', 'didge'],
    generic: ['wind', 'winds', 'woodwind', 'woodwinds']
  },

  /* ============================================================== */
  vox: {
    lead: ['vox', 'vocal', 'vocals', 'leadvox', 'lead vocal', 'mainvox', 'vcl'],
    backing: ['backing', 'bgv', 'backingvocal', 'harmony', 'harmonies', 'doubles'],
    chop: ['vocalchop', 'vocal chop', 'chop', 'chops'],
    adlib: ['adlib', 'adlibs', 'ad lib'],
    choir: ['choir', 'chorus', 'gospel', 'aah', 'ooh'],
    spoken: ['spoken', 'dialogue', 'speech', 'vo', 'voiceover', 'narration'],
    rap: ['rap', 'verse', 'hook', 'topline'],
    generic: ['voice', 'vocalist', 'singer']
  },

  /* ============================================================== */
  fx: {
    riser: ['riser', 'rise', 'uplifter', 'buildup', 'build up', 'lift'],
    downlifter: ['downlifter', 'downshifter', 'fall', 'drop fx'],
    impact: ['impact', 'boom', 'hit fx', 'slam', 'braam'],
    woosh: ['woosh', 'whoosh', 'swoosh', 'swish'],
    sweep: ['sweep', 'noisesweep', 'noise sweep'],
    reverse: ['reverse', 'reversed', 'rev'],
    exhaust: ['exhaust', 'exhale'],
    ambience: ['ambience', 'ambient', 'roomtone', 'room tone', 'noise floor'],
    texture: ['texture', 'drone', 'soundscape'],
    siren: ['siren', 'airhorn', 'air horn'],
    vinyl: ['vinyl', 'crackle', 'tape hiss'],
    glitch: ['glitch', 'stutter', 'granular'],
    generic: ['fx', 'sfx', 'effect', 'effects', 'transition']
  }
};

/* ================================================================== */
/* Cleanup — strip before matching                                    */
/* ================================================================== */

/**
 * Render artefacts, version markers and vendor clutter. Removed so they
 * can't be mistaken for instrument names, and so the leftover name is
 * readable if nothing matches.
 */
const NOISE_TOKENS = new Set([
  'render', 'rendered', 'bounce', 'bounced', 'export', 'exported', 'print',
  'printed', 'final', 'finale', 'master', 'mastered', 'mixdown', 'mix',
  'rough', 'draft', 'wip', 'temp', 'tmp', 'copy', 'new', 'old', 'backup',
  'bak', 'audio', 'track', 'stem', 'stems', 'file', 'untitled', 'insert',
  'wav', 'mp3', 'aiff', 'flac', 'oneshot', 'one shot', 'sample', 'loop',
  'dry', 'wet', 'raw', 'processed', 'edit', 'edited', 'take', 'comp',
  'default', 'init', 'preset', 'bus', 'aux', 'sub mix', 'submix', 'group'
]);

/** Vendors and instrument hosts — noise, not instruments. */
const VENDOR_TOKENS = new Set([
  'kshmr', 'splice', 'serum', 'kontakt', 'nexus', 'omnisphere', 'sylenth',
  'massive', 'vital', 'spire', 'diva', 'battery', 'superior', 'ezdrummer',
  'addictive', 'ni', 'native', 'instruments', 'spitfire', 'orchestral',
  'tools', 'library', 'vol', 'volume', 'pack', 'kit', 'bundle'
]);

module.exports = { DICTIONARY, NOISE_TOKENS, VENDOR_TOKENS };
