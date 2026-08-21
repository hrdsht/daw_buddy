'use strict';

/**
 * World Musical Traditions & Scales Library
 * 
 * Provides authentic scale structures, degrees, cultural metadata, 
 * ascending/descending phrasing, mood descriptors, and matching algorithms for:
 *   - Indian Classical (Hindustani Raagas & Carnatic Melakartas)
 *   - Middle Eastern, Arabic & Egyptian (Maqamat & Scales)
 *   - East Asian & Chinese (5 Core Pentatonic Modes & Regional Scales)
 *   - Western Classical, Modal & Jazz (Modes & Modern Synthetic Scales)
 *   - Mediterranean & Latin (Flamenco, Andalusian, Gypsy Minor)
 *   - Celtic & Nordic Folk
 */

export type ScaleTraditionId = 
  | 'all'
  | 'indian'
  | 'arabic'
  | 'chinese'
  | 'western'
  | 'mediterranean'
  | 'celtic';

export interface WorldRegion {
  id: ScaleTraditionId;
  name: string;
  nativeName?: string;
  tag: string;
  flag: string;
  lat: number;
  lng: number;
  description: string;
  sampleInstruments: string[];
  scaleCount: number;
}

export const WORLD_REGIONS: WorldRegion[] = [
  {
    id: 'indian',
    name: 'India & South Asia',
    nativeName: 'भारतीय शास्त्रीय संगीत',
    tag: 'IND',
    flag: '🇮🇳',
    lat: 20.5937,
    lng: 78.9629,
    description: 'Indian Classical Raagas, Thaats, Sargam notes (Sa Re Ga Ma Pa Dha Ni), Aarohana & Avarohana phrasing.',
    sampleInstruments: ['Sitar', 'Tanpura', 'Bansuri', 'Tabla', 'Sarangi'],
    scaleCount: 16
  },
  {
    id: 'arabic',
    name: 'Arabia & Egypt / Middle East',
    nativeName: 'المقامات الموسيقية',
    tag: 'ARA',
    flag: '🇪🇬',
    lat: 26.8206,
    lng: 30.8025,
    description: 'Arabic & Egyptian Maqamat, Jins tetrachords, passionate micro-inflections, Sayr melodies, and Tarab aesthetic.',
    sampleInstruments: ['Oud', 'Ney', 'Qanun', 'Riq', 'Darbuka'],
    scaleCount: 12
  },
  {
    id: 'chinese',
    name: 'China & East Asia',
    nativeName: '五声与传统宫调',
    tag: 'EAS',
    flag: '🇨🇳',
    lat: 35.8617,
    lng: 104.1954,
    description: 'Five Ancient Chinese Modes (Gong 宫, Shang 商, Jiao 角, Zhi 徵, Yu 羽), pentatonic harmony, and Japanese modes.',
    sampleInstruments: ['Guzheng', 'Erhu', 'Dizi', 'Pipa', 'Koto'],
    scaleCount: 12
  },
  {
    id: 'western',
    name: 'Western & Modern Jazz',
    nativeName: 'Western Harmony & Modes',
    tag: 'WST',
    flag: '🌐',
    lat: 48.8566,
    lng: 2.3522,
    description: 'Diatonic Greek modes (Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian), Blues, Bebop, and Jazz.',
    sampleInstruments: ['Piano', 'Guitar', 'Strings', 'Brass', 'Synthesizer'],
    scaleCount: 14
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean & Spain',
    nativeName: 'Flamenco & Mediterráneo',
    tag: 'MED',
    flag: '🇪🇸',
    lat: 40.4637,
    lng: -3.7492,
    description: 'Spanish Gypsy, Flamenco Phrygian Dominant, Andalusian cadence, and Hungarian/Balkan Gypsy minor modes.',
    sampleInstruments: ['Flamenco Guitar', 'Castanets', 'Cajón', 'Bouzouki', 'Accordion'],
    scaleCount: 8
  },
  {
    id: 'celtic',
    name: 'Celtic & Nordic Folk',
    nativeName: 'Celtic & Nordic',
    tag: 'CLT',
    flag: '🇮🇪',
    lat: 53.4129,
    lng: -8.2439,
    description: 'Traditional modal folk, Scottish Highland, Irish Dorian/Mixolydian hybrids, and Swedish folk minors.',
    sampleInstruments: ['Uilleann Pipes', 'Fiddle', 'Tin Whistle', 'Bodhrán', 'Celtic Harp'],
    scaleCount: 6
  }
];

export interface WorldScale {
  id: string;
  name: string;
  nativeName?: string;
  tradition: ScaleTraditionId;
  subCategory?: string;
  degrees: number[]; // semitone intervals from tonic (0-11)
  ascendingPhrase?: number[]; // pitch intervals for ascent
  descendingPhrase?: number[]; // pitch intervals for descent
  phraseNotation?: {
    ascending: string;
    descending: string;
  };
  sargamOrNames?: string;
  mood?: string;
  timeOfDay?: string;
  suggestedRhythm?: string;
  description: string;
}

export const WORLD_SCALES_DATABASE: WorldScale[] = [
  /* =========================================================================
     1. INDIAN CLASSICAL (Raagas & Thaats)
     ========================================================================= */
  {
    id: 'bhairav',
    name: 'Raag Bhairav',
    nativeName: 'राग भैरव',
    tradition: 'indian',
    subCategory: 'Bhairav Thaat',
    degrees: [0, 1, 4, 5, 7, 8, 11],
    ascendingPhrase: [0, 1, 4, 5, 7, 8, 11, 12],
    descendingPhrase: [12, 11, 8, 7, 5, 4, 1, 0],
    phraseNotation: {
      ascending: 'S r G m P d N Ṡ',
      descending: 'Ṡ N d P m G r S'
    },
    sargamOrNames: 'S r G m P d N',
    mood: 'Devotional, Majestic, Awakening & Peaceful',
    timeOfDay: 'Early Morning (Dawn / Sunrise)',
    suggestedRhythm: 'Teental (16 beats) / Ektaal (12 beats)',
    description: 'One of the most foundational morning ragas in Hindustani music, known for its solemn oscillating komal rishabh (♭2) and komal dhaivat (♭6).'
  },
  {
    id: 'bhairavi',
    name: 'Raag Bhairavi',
    nativeName: 'राग भैरवी',
    tradition: 'indian',
    subCategory: 'Bhairavi Thaat',
    degrees: [0, 1, 3, 5, 7, 8, 10],
    ascendingPhrase: [0, 1, 3, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 3, 1, 0],
    phraseNotation: {
      ascending: 'S r g m P d n Ṡ',
      descending: 'Ṡ n d P m g r S'
    },
    sargamOrNames: 'S r g m P d n',
    mood: 'Emotional, Sweet, Romantic & Concluding',
    timeOfDay: 'Morning / Concert Finale',
    suggestedRhythm: 'Keherwa (8 beats) / Dadra (6 beats)',
    description: 'The queen of Indian melodies. All four notes (re, ga, dha, ni) are flat (komal), creating an deeply emotional and soulful atmosphere.'
  },
  {
    id: 'yaman',
    name: 'Raag Yaman / Kalyan',
    nativeName: 'राग यमन / कल्याण',
    tradition: 'indian',
    subCategory: 'Kalyan Thaat',
    degrees: [0, 2, 4, 6, 7, 9, 11],
    ascendingPhrase: [11 - 12, 2, 4, 6, 7, 9, 11, 12],
    descendingPhrase: [12, 11, 9, 7, 6, 4, 2, 0],
    phraseNotation: {
      ascending: "'N R G M P D N Ṡ",
      descending: 'Ṡ N D P M G R S'
    },
    sargamOrNames: 'S R G M P D N (Tivra Ma)',
    mood: 'Joyful, Serene, Expansive & Romantic',
    timeOfDay: 'Early Evening (Sunset - 9 PM)',
    suggestedRhythm: 'Teental (16 beats) / Roopak (7 beats)',
    description: 'Major scale with a sharp fourth (Tivra Ma / #4). Represents the evening twilight with deep warmth and luminous clarity.'
  },
  {
    id: 'todi',
    name: 'Raag Todi (Miyan Ki Todi)',
    nativeName: 'राग तोड़ी',
    tradition: 'indian',
    subCategory: 'Todi Thaat',
    degrees: [0, 1, 3, 6, 7, 8, 11],
    ascendingPhrase: [0, 1, 3, 6, 7, 8, 11, 12],
    descendingPhrase: [12, 11, 8, 7, 6, 3, 1, 0],
    phraseNotation: {
      ascending: 'S r g M P d N Ṡ',
      descending: 'Ṡ N d P M g r S'
    },
    sargamOrNames: 'S r g M P d N',
    mood: 'Contemplative, Poignant, Intense & Heroic',
    timeOfDay: 'Late Morning (8 AM - 11 AM)',
    suggestedRhythm: 'Jhaptal (10 beats) / Teental',
    description: 'An iconic raga featuring both flat second (r), flat third (g), sharp fourth (M), flat sixth (d), and natural seventh (N).'
  },
  {
    id: 'marwa',
    name: 'Raag Marwa',
    nativeName: 'राग मारवा',
    tradition: 'indian',
    subCategory: 'Marwa Thaat',
    degrees: [0, 1, 4, 6, 9, 11],
    ascendingPhrase: [0, 1, 4, 6, 9, 11, 12],
    descendingPhrase: [12, 11, 9, 6, 4, 1, 0],
    phraseNotation: {
      ascending: 'S r G M D N Ṡ',
      descending: 'Ṡ N D M G r S'
    },
    sargamOrNames: 'S r G M D N (No Pa)',
    mood: 'Anxious, Haunting, Yearning & Unsettling',
    timeOfDay: 'Sunset (Sandhiprakash)',
    suggestedRhythm: 'Jhaptal (10 beats) / Teental',
    description: 'Completely omits the fifth (Pa) while featuring a prominent komal re (♭2) and tivra ma (#4), evoking twilight solitude.'
  },
  {
    id: 'charukesi',
    name: 'Raag Charukesi',
    nativeName: 'राग चारुकेशी',
    tradition: 'indian',
    subCategory: 'Melakarta 26',
    degrees: [0, 2, 4, 5, 7, 8, 10],
    ascendingPhrase: [0, 2, 4, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 4, 2, 0],
    phraseNotation: {
      ascending: 'S R G m P d n Ṡ',
      descending: 'Ṡ n d P m G R S'
    },
    sargamOrNames: 'S R G m P d n',
    mood: 'Heart-melting, Bittersweet & Compassionate',
    timeOfDay: 'Evening / Anytime',
    suggestedRhythm: 'Mishra Chapu (7/8) / Keherwa (4/4)',
    description: 'Major upper tetrachord with minor lower tetrachord (Major with ♭6 and ♭7), celebrated for its poignant emotional pull.'
  },
  {
    id: 'shivaranjani',
    name: 'Raag Shivaranjani',
    nativeName: 'राग शिवरंजनी',
    tradition: 'indian',
    subCategory: 'Pentatonic / Kafi Thaat',
    degrees: [0, 2, 3, 7, 9],
    ascendingPhrase: [0, 2, 3, 7, 9, 12],
    descendingPhrase: [12, 9, 7, 3, 2, 0],
    phraseNotation: {
      ascending: 'S R g P D Ṡ',
      descending: 'Ṡ D P g R S'
    },
    sargamOrNames: 'S R g P D',
    mood: 'Tearful, Heartfelt, Melancholic & Devotional',
    timeOfDay: 'Midnight / Anytime',
    suggestedRhythm: 'Dadra (6/8) / Keherwa (4/4)',
    description: 'A deeply expressive 5-note pentatonic scale with a minor 3rd (komal ga) paired with a major 6th (shuddh Dha).'
  },
  {
    id: 'malkauns',
    name: 'Raag Malkauns',
    nativeName: 'राग मालकौंस',
    tradition: 'indian',
    subCategory: 'Bhairavi Thaat (Audav)',
    degrees: [0, 3, 5, 8, 10],
    ascendingPhrase: [0, 3, 5, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 5, 3, 0],
    phraseNotation: {
      ascending: 'S g m d n Ṡ',
      descending: 'Ṡ n d m g S'
    },
    sargamOrNames: 'S g m d n (No Re/Pa)',
    mood: 'Meditative, Deep, Mystical & Serious',
    timeOfDay: 'Late Night (12 AM - 3 AM)',
    suggestedRhythm: 'Teental (16 beats) / Ektaal (12 beats)',
    description: 'One of the oldest and most spiritual meditative ragas, using 5 notes: Sa, komal ga, ma, komal dha, and komal ni.'
  },

  /* =========================================================================
     2. ARABIC & EGYPTIAN / MIDDLE EASTERN (Maqamat)
     ========================================================================= */
  {
    id: 'maqam_hijaz',
    name: 'Maqam Hijaz',
    nativeName: 'مقام حجاز',
    tradition: 'arabic',
    subCategory: 'Hijaz Family',
    degrees: [0, 1, 4, 5, 7, 8, 10],
    ascendingPhrase: [0, 1, 4, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 4, 1, 0],
    phraseNotation: {
      ascending: '1 ♭2 3 4 5 ♭6 ♭7 8',
      descending: '8 ♭7 ♭6 5 4 3 ♭2 1'
    },
    sargamOrNames: 'Dukah, Hijaz, Jaharkah, Nawa, Husayni, Ajam, Kordan',
    mood: 'Mystical, Passionate, Solemn & Desert Grandeur',
    timeOfDay: 'Evening & Night',
    suggestedRhythm: 'Maqsoum (4/4) / Wahda (4/4) / Malfuf (2/4)',
    description: 'The defining sound of traditional Arabic and Egyptian music. Uses the distinctive augmented 2nd interval between ♭2 and 3.'
  },
  {
    id: 'maqam_bayati',
    name: 'Maqam Bayati',
    nativeName: 'مقام بياتي',
    tradition: 'arabic',
    subCategory: 'Bayati Family',
    degrees: [0, 1, 3, 5, 7, 8, 10], // 12-TET approximation of half-flat 2
    ascendingPhrase: [0, 1, 3, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 3, 1, 0],
    phraseNotation: {
      ascending: '1 𝄳2 ♭3 4 5 ♭6 ♭7 8',
      descending: '8 ♭7 ♭6 5 4 ♭3 𝄳2 1'
    },
    sargamOrNames: 'Dukah, Sikah, Jaharkah, Nawa, Husayni, Ajam, Kordan',
    mood: 'Warm, Nostalgic, Soulful & Tarab (Ecstasy)',
    timeOfDay: 'Anytime / Dusk',
    suggestedRhythm: 'Baladi (4/4) / Saidi (4/4) / Samai Thaqil (10/8)',
    description: 'The most popular Maqam across Egypt and the Levant. Filled with warmth, gentle longing, and melodic depth.'
  },
  {
    id: 'maqam_kurd',
    name: 'Maqam Kurd',
    nativeName: 'مقام كُرد',
    tradition: 'arabic',
    subCategory: 'Kurd Family (Phrygian)',
    degrees: [0, 1, 3, 5, 7, 8, 10],
    ascendingPhrase: [0, 1, 3, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 3, 1, 0],
    phraseNotation: {
      ascending: '1 ♭2 ♭3 4 5 ♭6 ♭7 8',
      descending: '8 ♭7 ♭6 5 4 ♭3 ♭2 1'
    },
    sargamOrNames: 'Kurd, Hijaz Kar, Nawa, Husayni',
    mood: 'Dramatic, Romantic, Yearning & Powerful',
    timeOfDay: 'Night',
    suggestedRhythm: 'Ayyub (2/4) / Maqsoum (4/4)',
    description: 'Directly corresponds to the Phrygian mode with pure semitones. Highly favored in modern Arabic pop and cinematic scores.'
  },
  {
    id: 'maqam_nahawand',
    name: 'Maqam Nahawand',
    nativeName: 'مقام نهاوند',
    tradition: 'arabic',
    subCategory: 'Nahawand Family (Harmonic Minor)',
    degrees: [0, 2, 3, 5, 7, 8, 11],
    ascendingPhrase: [0, 2, 3, 5, 7, 8, 11, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 4 5 ♭6 7 8',
      descending: '8 ♭7 ♭6 5 4 ♭3 2 1'
    },
    sargamOrNames: 'Nahawand, Hijaz, Kordan',
    mood: 'Elegant, Bittersweet, Noble & Theatrical',
    timeOfDay: 'Evening',
    suggestedRhythm: 'Samai (10/8) / Wahda (4/4)',
    description: 'Ascends with a harmonic minor 7th and descends with a natural minor ♭7, creating a rich East-meets-West cinematic blend.'
  },
  {
    id: 'maqam_rast',
    name: 'Maqam Rast',
    nativeName: 'مقام راست',
    tradition: 'arabic',
    subCategory: 'Rast Family',
    degrees: [0, 2, 4, 5, 7, 9, 10], // Rast with neutral intervals approximated in 12-TET
    ascendingPhrase: [0, 2, 4, 5, 7, 9, 11, 12],
    descendingPhrase: [12, 10, 9, 7, 5, 4, 2, 0],
    phraseNotation: {
      ascending: '1 2 3 4 5 6 7 8',
      descending: '8 ♭7 6 5 4 3 2 1'
    },
    sargamOrNames: 'Rast, Dukah, Sikah, Jaharkah, Nawa, Husayni, Auj, Kordan',
    mood: 'Authoritative, Pride, Grounded & Festive',
    timeOfDay: 'Daytime / Celebrations',
    suggestedRhythm: 'Masmoudi Kabir (8/4) / Daza (4/4)',
    description: 'The fundamental benchmark of Arabic music theory. Embodies majesty, balance, and classical dignity.'
  },
  {
    id: 'egyptian_suspended',
    name: 'Ancient Egyptian Suspended',
    nativeName: 'السلم المصري القديم',
    tradition: 'arabic',
    subCategory: 'Egyptian Pentatonic',
    degrees: [0, 2, 5, 7, 10],
    ascendingPhrase: [0, 2, 5, 7, 10, 12],
    descendingPhrase: [12, 10, 7, 5, 2, 0],
    phraseNotation: {
      ascending: '1 2 4 5 ♭7 8',
      descending: '8 ♭7 5 4 2 1'
    },
    sargamOrNames: 'Suspended Pentatonic (1, 2, 4, 5, ♭7)',
    mood: 'Ancient, Floating, Hypnotic & Timeless',
    timeOfDay: 'Night / Meditation',
    suggestedRhythm: 'Zar Rhythm / Malfuf (2/4)',
    description: 'A beautiful 5-tone scale without 3rds, preserving the open, suspended resonance of ancient Egyptian flutes and harps.'
  },
  {
    id: 'double_harmonic_arabic',
    name: 'Double Harmonic (Byzantine / Hijaz Kar)',
    nativeName: 'مقام حجاز كار',
    tradition: 'arabic',
    subCategory: 'Hijaz Kar',
    degrees: [0, 1, 4, 5, 7, 8, 11],
    ascendingPhrase: [0, 1, 4, 5, 7, 8, 11, 12],
    descendingPhrase: [12, 11, 8, 7, 5, 4, 1, 0],
    phraseNotation: {
      ascending: '1 ♭2 3 4 5 ♭6 7 8',
      descending: '8 7 ♭6 5 4 3 ♭2 1'
    },
    sargamOrNames: 'Double Harmonic Major',
    mood: 'Exotic, Dramatic, Searing & Mysterious',
    timeOfDay: 'Midnight',
    suggestedRhythm: 'Ciftetelli (8/4) / Chobi (4/4)',
    description: 'Contains two augmented second intervals (between ♭2-3 and ♭6-7), creating one of the most recognizable Middle Eastern sounds in world cinema.'
  },

  /* =========================================================================
     3. CHINA & EAST ASIA (Ancient Pentatonics & Regional Modes)
     ========================================================================= */
  {
    id: 'gong_diao',
    name: 'Gong Diao (宫调 - Palace Mode)',
    nativeName: '宫调 (Gōng Diào)',
    tradition: 'chinese',
    subCategory: 'Major Pentatonic (1 2 3 5 6)',
    degrees: [0, 2, 4, 7, 9],
    ascendingPhrase: [0, 2, 4, 7, 9, 12],
    descendingPhrase: [12, 9, 7, 4, 2, 0],
    phraseNotation: {
      ascending: '宫(1) 商(2) 角(3) 徵(5) 羽(6) 宫(8)',
      descending: '宫(8) 羽(6) 徵(5) 角(3) 商(2) 宫(1)'
    },
    sargamOrNames: 'Gōng, Shāng, Jiǎo, Zhǐ, Yǔ',
    mood: 'Noble, Grand, Peaceful & Harmonious',
    timeOfDay: 'Morning / Spring',
    suggestedRhythm: 'Baban (8 beats) / Flowing 4/4',
    description: 'The root and emperor of the five Chinese pentatonic modes. Associated with the earth element, centered balance, and imperial majesty.'
  },
  {
    id: 'shang_diao',
    name: 'Shang Diao (商调 - Merchant Mode)',
    nativeName: '商调 (Shāng Diào)',
    tradition: 'chinese',
    subCategory: 'Dorian Pentatonic (1 2 4 5 ♭7)',
    degrees: [0, 2, 5, 7, 10],
    ascendingPhrase: [0, 2, 5, 7, 10, 12],
    descendingPhrase: [12, 10, 7, 5, 2, 0],
    phraseNotation: {
      ascending: '商(1) 角(2) 徵(4) 羽(5) 宫(♭7) 商(8)',
      descending: '商(8) 宫(♭7) 羽(5) 徵(4) 角(2) 商(1)'
    },
    sargamOrNames: 'Shāng, Jiǎo, Zhǐ, Yǔ, Gōng',
    mood: 'Resolute, Solemn, Martial & Crisp',
    timeOfDay: 'Autumn / Twilight',
    suggestedRhythm: 'Flowing 4/4 / 2/4',
    description: 'Associated with the metal element and autumn. Carries a noble, crisp, and solemn energy widely heard in Guzheng and Pipa classics.'
  },
  {
    id: 'jiao_diao',
    name: 'Jiao Diao (角调 - Horn Mode)',
    nativeName: '角调 (Jiǎo Diào)',
    tradition: 'chinese',
    subCategory: 'Phrygian Pentatonic (1 ♭3 4 ♭6 ♭7)',
    degrees: [0, 3, 5, 8, 10],
    ascendingPhrase: [0, 3, 5, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 5, 3, 0],
    phraseNotation: {
      ascending: '角(1) 徵(♭3) 羽(4) 宫(♭6) 商(♭7) 角(8)',
      descending: '角(8) 商(♭7) 宫(♭6) 羽(4) 徵(♭3) 角(1)'
    },
    sargamOrNames: 'Jiǎo, Zhǐ, Yǔ, Gōng, Shāng',
    mood: 'Vibrant, Pastoral, Vegetative & Fresh',
    timeOfDay: 'Dawn / Spring',
    suggestedRhythm: 'Pastoral 6/8 / 3/4',
    description: 'Associated with the wood element and the reawakening of spring. Evokes mountain mists, flowing rivers, and bamboo forests.'
  },
  {
    id: 'zhi_diao',
    name: 'Zhi Diao (徵调 - Feather Mode)',
    nativeName: '徵调 (Zhǐ Diào)',
    tradition: 'chinese',
    subCategory: 'Mixolydian Pentatonic (1 2 4 5 6)',
    degrees: [0, 2, 5, 7, 9],
    ascendingPhrase: [0, 2, 5, 7, 9, 12],
    descendingPhrase: [12, 9, 7, 5, 2, 0],
    phraseNotation: {
      ascending: '徵(1) 羽(2) 宫(4) 商(5) 角(6) 徵(8)',
      descending: '徵(8) 角(6) 商(5) 宫(4) 羽(2) 徵(1)'
    },
    sargamOrNames: 'Zhǐ, Yǔ, Gōng, Shāng, Jiǎo',
    mood: 'Lively, Passionate, Warm & Uplifting',
    timeOfDay: 'Noon / Summer',
    suggestedRhythm: 'Joyful 2/4 / 4/4',
    description: 'Associated with the fire element and summer warmth. Bright, joyful, and fluid, celebrating life and festivities.'
  },
  {
    id: 'yu_diao',
    name: 'Yu Diao (羽调 - Wings Mode)',
    nativeName: '羽调 (Yǔ Diào)',
    tradition: 'chinese',
    subCategory: 'Minor Pentatonic (1 ♭3 4 5 ♭7)',
    degrees: [0, 3, 5, 7, 10],
    ascendingPhrase: [0, 3, 5, 7, 10, 12],
    descendingPhrase: [12, 10, 7, 5, 3, 0],
    phraseNotation: {
      ascending: '羽(1) 宫(♭3) 商(4) 角(5) 徵(♭7) 羽(8)',
      descending: '羽(8) 徵(♭7) 角(5) 商(4) 宫(♭3) 羽(1)'
    },
    sargamOrNames: 'Yǔ, Gōng, Shāng, Jiǎo, Zhǐ',
    mood: 'Introspective, Melancholic, Deep & Serene',
    timeOfDay: 'Night / Winter',
    suggestedRhythm: 'Slow Meditative 4/4',
    description: 'Associated with the water element and stillness. The classic Chinese minor mode expressing deep poetry, longing, and reflective tranquility.'
  },
  {
    id: 'hirajoshi_japan',
    name: 'Hirajōshi (平調子 - Japanese)',
    nativeName: '平調子 (Hirajōshi)',
    tradition: 'chinese',
    subCategory: 'Japanese Koto Mode',
    degrees: [0, 2, 3, 7, 8],
    ascendingPhrase: [0, 2, 3, 7, 8, 12],
    descendingPhrase: [12, 8, 7, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 5 ♭6 8',
      descending: '8 ♭6 5 ♭3 2 1'
    },
    sargamOrNames: '1, 2, ♭3, 5, ♭6',
    mood: 'Haunting, Elegant, Dramatic & Zen',
    timeOfDay: 'Night / Autumn',
    suggestedRhythm: 'Free tempo / 4/4',
    description: 'The definitive Japanese tuning adapted from shamisen and koto traditions, featuring exquisite semitone drops (♭3 to 2, ♭6 to 5).'
  },
  {
    id: 'insen_japan',
    name: 'Insen (陰旋 - Japanese Dark Mode)',
    nativeName: '陰旋法 (Insen-pō)',
    tradition: 'chinese',
    subCategory: 'Japanese Traditional',
    degrees: [0, 1, 5, 7, 10],
    ascendingPhrase: [0, 1, 5, 7, 10, 12],
    descendingPhrase: [12, 10, 7, 5, 1, 0],
    phraseNotation: {
      ascending: '1 ♭2 4 5 ♭7 8',
      descending: '8 ♭7 5 4 ♭2 1'
    },
    sargamOrNames: '1, ♭2, 4, 5, ♭7',
    mood: 'Mysterious, Ethereal, Samurai & Shadows',
    timeOfDay: 'Midnight',
    suggestedRhythm: 'Minimal 4/4 / Taiko pulse',
    description: 'A traditional Japanese in-scale used in shakuhachi flute meditations and theatrical Noh/Kabuki drama.'
  },

  /* =========================================================================
     4. WESTERN CLASSICAL & JAZZ (Diatonic Greek Modes & Modern Scales)
     ========================================================================= */
  {
    id: 'major_ionian',
    name: 'Major (Ionian Mode)',
    nativeName: 'Ionian Mode',
    tradition: 'western',
    subCategory: 'Diatonic Mode I',
    degrees: [0, 2, 4, 5, 7, 9, 11],
    ascendingPhrase: [0, 2, 4, 5, 7, 9, 11, 12],
    descendingPhrase: [12, 11, 9, 7, 5, 4, 2, 0],
    phraseNotation: {
      ascending: 'Do Re Mi Fa Sol La Ti Do',
      descending: 'Do Ti La Sol Fa Mi Re Do'
    },
    sargamOrNames: '1 2 3 4 5 6 7',
    mood: 'Bright, Uplifting, Triumphant & Clear',
    timeOfDay: 'Daytime',
    suggestedRhythm: '4/4 / 3/4',
    description: 'The bedrock of Western tonal harmony. Direct, joyful, balanced, and consonant.'
  },
  {
    id: 'dorian_mode',
    name: 'Dorian Mode',
    nativeName: 'Dorian Mode',
    tradition: 'western',
    subCategory: 'Diatonic Mode II',
    degrees: [0, 2, 3, 5, 7, 9, 10],
    ascendingPhrase: [0, 2, 3, 5, 7, 9, 10, 12],
    descendingPhrase: [12, 10, 9, 7, 5, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 4 5 6 ♭7 8',
      descending: '8 ♭7 6 5 4 ♭3 2 1'
    },
    sargamOrNames: 'Minor with Natural 6th',
    mood: 'Sophisticated, Jazzy, Soulful & Cool',
    timeOfDay: 'Night / Late Evening',
    suggestedRhythm: 'Funk / Soul / Jazz 4/4',
    description: 'Minor scale with a raised natural 6th degree. The hallmark of modal jazz (Miles Davis "So What") and French impressionism.'
  },
  {
    id: 'lydian_mode',
    name: 'Lydian Mode',
    nativeName: 'Lydian Mode',
    tradition: 'western',
    subCategory: 'Diatonic Mode IV',
    degrees: [0, 2, 4, 6, 7, 9, 11],
    ascendingPhrase: [0, 2, 4, 6, 7, 9, 11, 12],
    descendingPhrase: [12, 11, 9, 7, 6, 4, 2, 0],
    phraseNotation: {
      ascending: '1 2 3 #4 5 6 7 8',
      descending: '8 7 6 5 #4 3 2 1'
    },
    sargamOrNames: 'Major with Sharp 4th',
    mood: 'Dreamy, Cinematic, Floating & Futuristic',
    timeOfDay: 'Anytime / Fantasy',
    suggestedRhythm: 'Cinematic 4/4 / 5/4',
    description: 'Major scale with a raised 4th (#4). Famous in Hollywood film scores, space themes, and progressive rock.'
  },
  {
    id: 'mixolydian_mode',
    name: 'Mixolydian Mode',
    nativeName: 'Mixolydian Mode',
    tradition: 'western',
    subCategory: 'Diatonic Mode V',
    degrees: [0, 2, 4, 5, 7, 9, 10],
    ascendingPhrase: [0, 2, 4, 5, 7, 9, 10, 12],
    descendingPhrase: [12, 10, 9, 7, 5, 4, 2, 0],
    phraseNotation: {
      ascending: '1 2 3 4 5 6 ♭7 8',
      descending: '8 ♭7 6 5 4 3 2 1'
    },
    sargamOrNames: 'Dominant 7th Scale',
    mood: 'Bluesy, Groovy, Classic Rock & Triumphant',
    timeOfDay: 'Afternoon / Evening',
    suggestedRhythm: 'Classic Rock 4/4 / Shuffle',
    description: 'Major scale with a flat 7th (♭7). The primary scale of rock, blues-rock, Afrobeat, and jam bands.'
  },
  {
    id: 'minor_aeolian',
    name: 'Natural Minor (Aeolian)',
    nativeName: 'Aeolian Mode',
    tradition: 'western',
    subCategory: 'Diatonic Mode VI',
    degrees: [0, 2, 3, 5, 7, 8, 10],
    ascendingPhrase: [0, 2, 3, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 4 5 ♭6 ♭7 8',
      descending: '8 ♭7 ♭6 5 4 ♭3 2 1'
    },
    sargamOrNames: '1 2 ♭3 4 5 ♭6 ♭7',
    mood: 'Emotional, Sad, Epic & Melancholic',
    timeOfDay: 'Evening / Night',
    suggestedRhythm: '4/4 / 6/8',
    description: 'The standard natural minor scale across Western pop, EDM, classical, and hip-hop production.'
  },
  {
    id: 'harmonic_minor',
    name: 'Harmonic Minor',
    nativeName: 'Harmonic Minor',
    tradition: 'western',
    subCategory: 'Classical / Neo-Classical',
    degrees: [0, 2, 3, 5, 7, 8, 11],
    ascendingPhrase: [0, 2, 3, 5, 7, 8, 11, 12],
    descendingPhrase: [12, 11, 8, 7, 5, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 4 5 ♭6 7 8',
      descending: '8 7 ♭6 5 4 ♭3 2 1'
    },
    sargamOrNames: 'Minor with Major 7th',
    mood: 'Dramatic, Dark, Baroque & Searing',
    timeOfDay: 'Midnight',
    suggestedRhythm: 'Classical 4/4 / 3/4 / Metal',
    description: 'Minor scale with a raised 7th degree, giving it a passionate leading tone and distinctive augmented 2nd interval between ♭6 and 7.'
  },
  {
    id: 'melodic_minor',
    name: 'Melodic Minor (Jazz Minor)',
    nativeName: 'Melodic Minor',
    tradition: 'western',
    subCategory: 'Modern Jazz & Classical',
    degrees: [0, 2, 3, 5, 7, 9, 11],
    ascendingPhrase: [0, 2, 3, 5, 7, 9, 11, 12],
    descendingPhrase: [12, 11, 9, 7, 5, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 4 5 6 7 8',
      descending: '8 7 6 5 4 ♭3 2 1'
    },
    sargamOrNames: 'Minor with Natural 6th & 7th',
    mood: 'Sleek, Modern, Sophisticated & Luminous',
    timeOfDay: 'Late Night Jazz',
    suggestedRhythm: 'Jazz Swing / Bebop 4/4',
    description: 'The foundation of modern jazz harmony and altered scales. Features a minor 3rd with major 6th and 7th degrees.'
  },
  {
    id: 'phrygian_mode',
    name: 'Phrygian Mode',
    nativeName: 'Phrygian Mode',
    tradition: 'western',
    subCategory: 'Diatonic Mode III',
    degrees: [0, 1, 3, 5, 7, 8, 10],
    ascendingPhrase: [0, 1, 3, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 3, 1, 0],
    phraseNotation: {
      ascending: '1 ♭2 ♭3 4 5 ♭6 ♭7 8',
      descending: '8 ♭7 ♭6 5 4 ♭3 ♭2 1'
    },
    sargamOrNames: 'Minor with Flat 2nd',
    mood: 'Tense, Ominous, Dark & Intense',
    timeOfDay: 'Night',
    suggestedRhythm: 'Heavy Rock / Trap / Metal 4/4',
    description: 'Minor scale with a dark minor 2nd (♭2). Essential for heavy metal, trap beats, and suspenseful film cues.'
  },
  {
    id: 'locrian_mode',
    name: 'Locrian Mode',
    nativeName: 'Locrian Mode',
    tradition: 'western',
    subCategory: 'Diatonic Mode VII',
    degrees: [0, 1, 3, 5, 6, 8, 10],
    ascendingPhrase: [0, 1, 3, 5, 6, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 6, 5, 3, 1, 0],
    phraseNotation: {
      ascending: '1 ♭2 ♭3 4 ♭5 ♭6 ♭7 8',
      descending: '8 ♭7 ♭6 ♭5 4 ♭3 ♭2 1'
    },
    sargamOrNames: 'Diminished Tonic Mode',
    mood: 'Unstable, Dissonant, Haunting & Chaotic',
    timeOfDay: 'Midnight / Horror',
    suggestedRhythm: 'Experimental / Industrial 4/4',
    description: 'Contains a diminished fifth (♭5) on the tonic. The darkest and most unresolved mode of the diatonic system.'
  },
  {
    id: 'pentatonic_minor',
    name: 'Minor Pentatonic',
    nativeName: 'Minor Pentatonic',
    tradition: 'western',
    subCategory: 'Universal Folk & Rock',
    degrees: [0, 3, 5, 7, 10],
    ascendingPhrase: [0, 3, 5, 7, 10, 12],
    descendingPhrase: [12, 10, 7, 5, 3, 0],
    phraseNotation: {
      ascending: '1 ♭3 4 5 ♭7 8',
      descending: '8 ♭7 5 4 ♭3 1'
    },
    sargamOrNames: '1 ♭3 4 5 ♭7',
    mood: 'Bold, Punchy, Timeless & Catchy',
    timeOfDay: 'Anytime',
    suggestedRhythm: 'Rock / Pop / Hip-Hop 4/4',
    description: 'The five most versatile and instantly recognizable notes in popular guitar solos, blues licks, and synth leads.'
  },
  {
    id: 'pentatonic_major',
    name: 'Major Pentatonic',
    nativeName: 'Major Pentatonic',
    tradition: 'western',
    subCategory: 'Country, Gospel & Pop',
    degrees: [0, 2, 4, 7, 9],
    ascendingPhrase: [0, 2, 4, 7, 9, 12],
    descendingPhrase: [12, 9, 7, 4, 2, 0],
    phraseNotation: {
      ascending: '1 2 3 5 6 8',
      descending: '8 6 5 3 2 1'
    },
    sargamOrNames: '1 2 3 5 6',
    mood: 'Warm, Soulful, Uplifting & Pastoral',
    timeOfDay: 'Sunrise / Daytime',
    suggestedRhythm: 'Gospel / Country / Acoustic 4/4',
    description: 'Pure consonant warmth with no harsh half-steps. Widely used across Americana, gospel, and soul melodies.'
  },
  {
    id: 'diminished_scale',
    name: 'Diminished (Whole-Half Octatonic)',
    nativeName: 'Octatonic Scale',
    tradition: 'western',
    subCategory: '20th-Century Classical & Jazz',
    degrees: [0, 2, 3, 5, 6, 8, 9, 11],
    ascendingPhrase: [0, 2, 3, 5, 6, 8, 9, 11, 12],
    descendingPhrase: [12, 11, 9, 8, 6, 5, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 4 ♭5 ♭6 6 7 8',
      descending: '8 7 6 ♭6 ♭5 4 ♭3 2 1'
    },
    sargamOrNames: 'Symmetrical 8-Tone Scale',
    mood: 'Suspenseful, Complex, Film Noir & Symmetrical',
    timeOfDay: 'Night / Thriller',
    suggestedRhythm: 'Jazz / Film Noir 4/4',
    description: 'Alternating whole and half steps, creating 8 symmetrical notes prized by Stravinsky, Ravel, and jazz improvisers.'
  },
  {
    id: 'whole_tone_scale',
    name: 'Whole Tone Scale',
    nativeName: 'Whole Tone (Hexatonic)',
    tradition: 'western',
    subCategory: 'French Impressionism',
    degrees: [0, 2, 4, 6, 8, 10],
    ascendingPhrase: [0, 2, 4, 6, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 6, 4, 2, 0],
    phraseNotation: {
      ascending: '1 2 3 #4 #5 ♭7 8',
      descending: '8 ♭7 #5 #4 3 2 1'
    },
    sargamOrNames: '6 Symmetrical Whole Steps',
    mood: 'Dreamlike, Weightless, Impressionist & Floating',
    timeOfDay: 'Dream / Fantasy',
    suggestedRhythm: 'Free Floating 4/4 / 3/4',
    description: 'Consists entirely of whole steps with no tonal center, creating the iconic dream-sequence sound made famous by Debussy.'
  },
  {
    id: 'blues_scale',
    name: 'Blues Scale (Hexatonic)',
    nativeName: 'Blues Scale',
    tradition: 'western',
    subCategory: 'American Roots',
    degrees: [0, 3, 5, 6, 7, 10],
    ascendingPhrase: [0, 3, 5, 6, 7, 10, 12],
    descendingPhrase: [12, 10, 7, 6, 5, 3, 0],
    phraseNotation: {
      ascending: '1 ♭3 4 ♭5 5 ♭7 8',
      descending: '8 ♭7 5 ♭5 4 ♭3 1'
    },
    sargamOrNames: 'Minor Pentatonic + Blue Note (♭5)',
    mood: 'Gritty, Expressive, Raw & Soulful',
    timeOfDay: 'Night',
    suggestedRhythm: '12-Bar Blues Shuffle / 4/4',
    description: 'The cornerstone of Blues, Rock and Roll, Funk, and R&B, powered by the tension and release of the diminished 5th "blue note".'
  },

  /* =========================================================================
     5. MEDITERRANEAN & LATIN (Flamenco & Gypsy Scales)
     ========================================================================= */
  {
    id: 'flamenco_mode',
    name: 'Flamenco Mode (Spanish Phrygian Dominant)',
    nativeName: 'Modo Flamenco / Frigio Mayor',
    tradition: 'mediterranean',
    subCategory: 'Andalusian / Flamenco',
    degrees: [0, 1, 4, 5, 7, 8, 10],
    ascendingPhrase: [0, 1, 4, 5, 7, 8, 10, 12],
    descendingPhrase: [12, 10, 8, 7, 5, 4, 1, 0],
    phraseNotation: {
      ascending: '1 ♭2 3 4 5 ♭6 ♭7 8',
      descending: '8 ♭7 ♭6 5 4 3 ♭2 1'
    },
    sargamOrNames: '5th Mode of Harmonic Minor',
    mood: 'Fiery, Passionate, Dramatic & Gypsy',
    timeOfDay: 'Night / Duende',
    suggestedRhythm: 'Bulerías (12/8) / Soleá / Tangos',
    description: 'The unmistakable heart of Spanish Flamenco guitar playing, featuring the iconic major 3rd over a flat 2nd.'
  },
  {
    id: 'hungarian_gypsy_minor',
    name: 'Gypsy Minor (Hungarian Minor)',
    nativeName: 'Magyar / Gypsy Minor',
    tradition: 'mediterranean',
    subCategory: 'Eastern Mediterranean / Balkan',
    degrees: [0, 2, 3, 6, 7, 8, 11],
    ascendingPhrase: [0, 2, 3, 6, 7, 8, 11, 12],
    descendingPhrase: [12, 11, 8, 7, 6, 3, 2, 0],
    phraseNotation: {
      ascending: '1 2 ♭3 #4 5 ♭6 7 8',
      descending: '8 7 ♭6 5 #4 ♭3 2 1'
    },
    sargamOrNames: 'Double Harmonic Minor (#4, 7)',
    mood: 'Haunting, Virtuosic, Tempestuous & Tragic',
    timeOfDay: 'Midnight',
    suggestedRhythm: 'Czardas / Fast 2/4 / Balkan 7/8',
    description: 'Contains two augmented 2nds (between ♭3-#4 and ♭6-7). Celebrated in Liszt and Brahms Hungarian rhapsodies.'
  },

  /* =========================================================================
     6. CELTIC & FOLK
     ========================================================================= */
  {
    id: 'celtic_pentatonic',
    name: 'Celtic Pentatonic (Scottish / Irish)',
    nativeName: 'Celtic Pentatonic',
    tradition: 'celtic',
    subCategory: 'Gaelic Folk',
    degrees: [0, 2, 4, 7, 9],
    ascendingPhrase: [0, 2, 4, 7, 9, 12],
    descendingPhrase: [12, 9, 7, 4, 2, 0],
    phraseNotation: {
      ascending: '1 2 3 5 6 8',
      descending: '8 6 5 3 2 1'
    },
    sargamOrNames: 'Gaelic Pentatonic',
    mood: 'Open, Rolling Hills, Nostalgic & Epic',
    timeOfDay: 'Morning / Mist',
    suggestedRhythm: 'Irish Reel (4/4) / Jig (6/8)',
    description: 'The foundation of Irish and Scottish folk melodies, ballads, bagpipe piobaireachd, and sea shanties.'
  }
];

export interface ScoredWorldScale extends WorldScale {
  score: number;
  matchPercent: number;
}

/**
 * Matches a 12-bin Chroma vector against World Scales according to the user's active tradition preferences.
 */
export function findMatchingWorldScales(
  chroma: Float64Array,
  tonicPc: number,
  selectedTraditions: ScaleTraditionId[] | ScaleTraditionId | 'all' = 'all',
  topN = 8
): ScoredWorldScale[] {
  const isAll = selectedTraditions === 'all' || (Array.isArray(selectedTraditions) && selectedTraditions.includes('all'));
  const allowedArray = Array.isArray(selectedTraditions) ? selectedTraditions : [selectedTraditions];
  const allowedSet = isAll ? null : new Set(allowedArray);

  const candidates = isAll
    ? WORLD_SCALES_DATABASE
    : WORLD_SCALES_DATABASE.filter((s) => allowedSet?.has(s.tradition));

  const scored: ScoredWorldScale[] = candidates.map((scale) => {
    const inScale = new Set(scale.degrees.map((d) => (tonicPc + d) % 12));
    let inside = 0;
    let outside = 0;
    for (let pc = 0; pc < 12; pc += 1) {
      if (inScale.has(pc)) inside += chroma[pc];
      else outside += chroma[pc];
    }
    const total = inside + outside || 1;
    const coverage = inside / total;
    const score = Math.max(0, coverage - outside * 1.6);
    const matchPercent = Math.round(Math.min(99, Math.max(35, score * 100)));

    return {
      ...scale,
      score,
      matchPercent
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Returns a clean MIDI byte array containing an ascending + descending sequence for any world scale.
 */
export function generateWorldScaleMidi(
  tonicPc: number,
  ascendingDegrees: number[],
  descendingDegrees?: number[],
  options: { bpm?: number; octave?: number; noteDurationTicks?: number } = {}
): Uint8Array {
  const bpm = options.bpm || 120;
  const octave = options.octave || 4;
  const rootMidi = octave * 12 + ((tonicPc % 12 + 12) % 12);
  const durTicks = options.noteDurationTicks || 240; // eighth note at 480 PPQ

  const asc = ascendingDegrees.length > 0 ? ascendingDegrees : [0, 2, 4, 5, 7, 9, 11, 12];
  const desc = descendingDegrees && descendingDegrees.length > 0 ? descendingDegrees : [...asc].reverse();

  const notesToPlay: number[] = [
    ...asc.map((d) => rootMidi + d),
    ...desc.slice(1).map((d) => rootMidi + d)
  ];

  const trackEvents: number[] = [];
  // Set Tempo meta event (FF 51 03 tt tt tt)
  const mpqn = Math.round(60000000 / bpm);
  trackEvents.push(0x00, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff);

  for (const midiNote of notesToPlay) {
    const clampedMidi = Math.max(12, Math.min(115, midiNote));
    // Note On delta = 0
    trackEvents.push(0x00, 0x90, clampedMidi, 0x5a); // velocity 90
    // Note Off delta = durTicks
    trackEvents.push(...encodeVarLen(durTicks), 0x80, clampedMidi, 0x00);
  }

  // End of Track meta event
  trackEvents.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, // MThd
    0x00, 0x00, 0x00, 0x06, // length 6
    0x00, 0x00,             // format 0 (single track)
    0x00, 0x01,             // 1 track
    0x01, 0xe0              // 480 PPQ
  ];

  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    (trackEvents.length >> 24) & 0xff,
    (trackEvents.length >> 16) & 0xff,
    (trackEvents.length >> 8) & 0xff,
    trackEvents.length & 0xff
  ];

  return new Uint8Array([...header, ...trackHeader, ...trackEvents]);
}

function encodeVarLen(value: number): number[] {
  const bytes: number[] = [];
  let v = value & 0x7f;
  while ((value >>= 7) > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v = value & 0x7f;
  }
  bytes.unshift(v);
  return bytes;
}
