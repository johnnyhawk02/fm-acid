// ---------- preset auto-namer ----------
// A name is either two or three real words, or one made-up word: alien syllables spliced with a spice.
// Big word pools (acid gear, weather, rocks, creatures, desserts, cosmos, Greek, spices...) so names rarely repeat.
// A last pass turns each s into z 60% of the time.
const NAMER = (() => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const chance = (p) => Math.random() < p;
  const ADJ = ['acid', 'burnt', 'melted', 'sideways', 'haunted', 'soggy', 'inverted', 'radioactive', 'fermented', 'exploded', 'backwards', 'feral',
    'damp', 'cursed', 'rusty', 'velvet', 'liquid', 'molten', 'frozen', 'hollow', 'crooked', 'electric', 'magnetic', 'toxic', 'lunar', 'solar',
    'nocturnal', 'sticky', 'greasy', 'fuzzy', 'jagged', 'wobbly', 'squelchy', 'rubber', 'chrome', 'plastic', 'neon', 'infrared', 'ultraviolet',
    'subsonic', 'sunken', 'drowned', 'feverish', 'lazy', 'nervous', 'angry', 'polite', 'sleepy', 'restless', 'forbidden', 'secret', 'lost',
    'forgotten', 'ancient', 'broken', 'bent', 'twisted', 'spiral', 'crystal', 'golden', 'silver', 'copper', 'cobalt', 'crimson', 'violet',
    'amber', 'emerald', 'obsidian', 'ivory', 'scarlet', 'ochre', 'indigo', 'saffron', 'turquoise', 'bitter', 'sour', 'salty', 'spicy', 'smoky',
    'pickled', 'candied', 'toasted', 'roasted', 'sugared', 'slippery', 'dusty', 'muddy', 'misty', 'stormy', 'humid', 'arctic', 'tropical',
    'volcanic', 'tidal', 'orbital', 'quantum', 'cosmic', 'astral', 'mutant', 'synthetic', 'analog', 'digital', 'resonant', 'detuned',
    'overdriven', 'squashed', 'stretched', 'reversed', 'mirrored', 'phantom', 'ghostly', 'savage', 'gentle', 'humble', 'royal', 'imperial',
    'rogue', 'stolen', 'borrowed', 'blessed', 'unholy', 'sacred', 'pagan', 'midnight', 'dawn', 'dusk', 'eternal', 'hungry', 'thirsty', 'dizzy',
    'giddy', 'grumpy', 'brave', 'clumsy', 'tiny', 'giant', 'infinite', 'hyper', 'mega', 'micro', 'proto', 'turbo', 'deep', 'shallow', 'wet',
    'dry', 'hot', 'cold', 'loose', 'tight', 'bouncy', 'elastic', 'warped', 'glitched', 'static', 'dynamic', 'hypnotic', 'psychic', 'strange'];
  const NOUN = [
    // acid gear
    'squelch', 'resonance', 'filter', 'cutoff', 'envelope', 'accent', 'slide', 'glide', 'diode', 'ladder', 'voltage', 'circuit', 'transistor',
    'capacitor', 'oscillator', 'sawtooth', 'pulse', 'sequencer', 'pattern', 'step', 'tempo', 'groove', 'bassline', 'feedback', 'overdrive', 'fuzz',
    'reverb', 'echo', 'delay', 'phaser', 'flanger', 'sidechain', 'warehouse', 'rave', 'strobe', 'smiley', 'acid', 'loop', 'signal', 'static',
    // nature, weather, rocks
    'thunder', 'lightning', 'monsoon', 'hailstorm', 'drizzle', 'fog', 'tornado', 'avalanche', 'glacier', 'canyon', 'swamp', 'marsh', 'bog',
    'lagoon', 'reef', 'tide', 'riptide', 'whirlpool', 'geyser', 'volcano', 'lava', 'magma', 'basalt', 'granite', 'quartz', 'obsidian', 'pumice',
    'sulphur', 'mercury', 'cobalt', 'bismuth', 'graphite', 'ember', 'cinder', 'ash', 'moss', 'lichen', 'fungus', 'spore', 'mycelium', 'thorn',
    'bramble', 'cactus', 'orchid', 'lotus', 'mangrove', 'tundra', 'dune', 'oasis', 'mirage', 'eclipse', 'aurora',
    // creatures
    'mollusc', 'octopus', 'squid', 'jellyfish', 'eel', 'lobster', 'barnacle', 'axolotl', 'newt', 'salamander', 'gecko', 'iguana', 'chameleon',
    'toad', 'beetle', 'mantis', 'hornet', 'moth', 'cicada', 'scorpion', 'tarantula', 'leech', 'slug', 'snail', 'worm', 'badger', 'otter',
    'weasel', 'ferret', 'wombat', 'platypus', 'armadillo', 'sloth', 'lemur', 'baboon', 'hyena', 'jackal', 'vulture', 'raven', 'heron', 'pelican',
    'flamingo', 'penguin', 'walrus', 'narwhal', 'kraken', 'leviathan', 'basilisk', 'griffin', 'chimera', 'wyvern', 'goblin', 'gremlin', 'imp',
    // things, places, odd bits
    'lantern', 'saxophone', 'trombone', 'accordion', 'kazoo', 'theremin', 'bagpipe', 'harmonica', 'teapot', 'kettle', 'spoon', 'ladle', 'colander',
    'umbrella', 'bicycle', 'tractor', 'submarine', 'zeppelin', 'rocket', 'satellite', 'robot', 'android', 'cyborg', 'reactor', 'turbine',
    'furnace', 'boiler', 'engine', 'piston', 'gearbox', 'antenna', 'radar', 'sonar', 'laser', 'hologram', 'mirror', 'prism', 'lens', 'compass',
    'labyrinth', 'temple', 'pyramid', 'ziggurat', 'monolith', 'obelisk', 'cathedral', 'bunker', 'lighthouse', 'harbour', 'carnival', 'circus',
    'casino', 'disco', 'basement', 'attic', 'cellar', 'garage', 'motorway', 'tunnel', 'bridge', 'factory', 'refinery', 'laboratory', 'asylum',
    'whisper', 'murmur', 'rumble', 'gurgle', 'wobble', 'bubble', 'sludge', 'goo', 'slime', 'jelly', 'custard', 'gravy', 'syrup', 'treacle',
    'marmalade', 'pickle', 'noodle', 'dumpling', 'waffle', 'pancake', 'crumpet', 'biscuit', 'pretzel', 'doughnut', 'fudge', 'toffee', 'nougat',
    // desserts
    'tiramisu', 'pavlova', 'eclair', 'baklava', 'profiterole', 'trifle', 'cheesecake', 'sorbet', 'macaron', 'strudel', 'meringue', 'parfait',
    'clafoutis', 'cannoli', 'gelato', 'souffle', 'banoffee', 'brulee', 'cobbler', 'crumble', 'flapjack', 'brownie', 'sundae', 'mousse',
    // cosmos
    'redshift', 'blueshift', 'horizon', 'quasar', 'pulsar', 'magnetar', 'baryon', 'neutrino', 'singularity', 'nebula', 'perihelion', 'aphelion',
    'parsec', 'supernova', 'wormhole', 'cepheid', 'comet', 'asteroid', 'meteor', 'galaxy', 'cosmos', 'void', 'orbit', 'equinox', 'solstice',
    'zenith', 'nadir', 'photon', 'graviton', 'muon', 'gluon', 'quark', 'boson', 'plasma', 'fractal', 'vortex', 'tesseract', 'paradox', 'entropy',
    // Greek
    'aether', 'logos', 'kairos', 'chronos', 'pneuma', 'eidolon', 'hubris', 'nous', 'telos', 'apeiron', 'kosmos', 'eros', 'thanatos', 'hypnos',
    'agora', 'oracle', 'amphora', 'odyssey', 'hydra', 'gorgon', 'elysion', 'tartaros', 'delphi', 'ithaka', 'cyclops', 'minotaur', 'siren',
    'titan', 'nemesis', 'medusa', 'icarus', 'prometheus', 'pandora', 'charon', 'styx', 'olympus', 'acropolis'];
  const SPICE = ['cinnamon', 'cardamom', 'turmeric', 'saffron', 'nutmeg', 'clove', 'cumin', 'coriander', 'fenugreek', 'paprika', 'cayenne',
    'chilli', 'pepper', 'ginger', 'galangal', 'sumac', 'zaatar', 'harissa', 'asafoetida', 'tamarind', 'anise', 'fennel', 'caraway', 'mace',
    'allspice', 'juniper', 'vanilla', 'wasabi', 'mustard', 'nigella', 'ajwain', 'mahleb', 'grains of paradise', 'lemongrass', 'kaffir', 'sansho',
    'sichuan', 'garam masala', 'ras el hanout', 'berbere', 'baharat', 'dukkah', 'chipotle', 'ancho', 'habanero', 'jalapeno', 'oregano', 'thyme',
    'rosemary', 'tarragon', 'sage', 'marjoram', 'dill', 'lovage', 'liquorice', 'myrrh', 'frankincense', 'mastic', 'pandan', 'curry'];
  // made-up syllables for the alien half
  const A_PRE = ['zor', 'qua', 'vex', 'thra', 'xil', 'oom', 'kry', 'bla', 'nyx', 'gor', 'fen', 'plu', 'yth', 'ska', 'zub', 'mor', 'quee', 'drax',
    'chth', 'xan', 'vor', 'glo', 'zha', 'kth', 'ul', 'yog', 'shub', 'nar', 'az', 'ix', 'thul', 'krel', 'vrr', 'oog', 'zee', 'phla', 'gri', 'ssk',
    'tzo', 'ka', 'xo', 'ny', 'quo', 'zim', 'bru', 'dzo', 'wub', 'ruu', 'tlo', 'mnok', 'eek', 'ozz', 'fth', 'gla', 'pt', 'hra', 'jhe', 'lyx'];
  const A_MID = ['la', 'ri', 'on', 'ex', 'ub', 'ae', 'ix', 'ol', 'ee', 'aa', 'u', 'yo', 'oz', 'ath', 'ul', 'ik', 'or', 'ei', 'uu', 'yr', 'ag', 'esh'];
  const A_END = ['th', 'x', 'nok', 'ar', 'ium', 'ozz', 'eep', 'ul', 'orb', 'ak', 'ish', 'oid', 'onoz', 'ix', 'ux', 'yth', 'aal', 'orr', 'ek',
    'oth', 'ulon', 'ax', 'iq', 'zz', 'oon', 'ra', 'ka', 'ii', 'ogg', 'esk', 'alq', 'umph', 'izz', 'ond', 'ath', 'yx'];
  const vowel = (c) => /[aeiouy]/.test(c);
  // front of one word up to a vowel, back of another from a consonant, so the joint stays sayable
  const splice = (a, b) => {
    const cuts = [...a.slice(1, -1)].map((c, i) => (vowel(c) ? i + 2 : 0)).filter(Boolean);
    const tails = [...b.slice(1)].map((c, i) => (!vowel(c) ? i + 1 : 0)).filter(i => i && i >= b.length / 3);
    return a.slice(0, cuts.length ? pick(cuts) : 2) + b.slice(tails.length ? pick(tails) : b.length >> 1);
  };
  const syll = () => pick(A_PRE) + (chance(0.6) ? pick(A_MID) : '') + pick(A_END);
  const SPICE1 = SPICE.filter(w => !w.includes(' ')); // one-word spices, for the real-word names
  const spice = () => pick(SPICE).replace(/ /g, '');
  // one made-up word: alien syllables crossed with a spice, sometimes two halves joined with a hyphen
  const alienSpice = () => {
    const r = Math.random();
    let w;
    if (r < 0.3) w = splice(spice(), syll());               // Cardamozz
    else if (r < 0.55) w = splice(syll(), spice());         // Zorameric
    else if (r < 0.75) w = pick(A_PRE) + spice();           // Xilsaffron
    else if (r < 0.9) w = spice().slice(0, 3 + Math.floor(Math.random() * 3)) + pick(A_MID) + pick(A_END); // Cumaexoid
    else w = syll();                                        // Zorlanok
    w = cap(w);
    if (chance(0.3)) w += '-' + cap(chance(0.5) ? syll() : splice(syll(), spice())); // Fenixozz-Blaoid
    return w;
  };
  const greekify = (w) => {
    const base = w.replace(/[aeiouy]+$/i, '');
    return (chance(0.3) ? pick(['proto', 'hyper', 'neo', 'pan', 'archi', 'meta']) : '') + base + pick(['os', 'ia', 'eion', 'ikon', 'ides', 'ax']);
  };
  const noun = () => (chance(0.12) ? pick(SPICE1) : chance(0.06) ? greekify(pick(NOUN)) : pick(NOUN));
  // two or three real words
  const phrase = () => {
    const r = Math.random();
    if (r < 0.25) return [pick(ADJ), noun()];
    if (r < 0.42) return [noun(), noun()];
    if (r < 0.54) return [pick(ADJ), noun(), noun()];
    if (r < 0.64) return [pick(ADJ), pick(ADJ), noun()];
    if (r < 0.74) return [noun(), pick(['of', 'in', 'on', 'for', 'and', 'from', 'versus']), noun()];
    if (r < 0.82) return [pick(SPICE1), noun()];
    if (r < 0.9) return [alienSpice().split('-')[0], noun()];
    if (r < 0.95) return [pick(ADJ), alienSpice().split('-')[0]];
    return ['the', pick(ADJ), noun()];
  };
  const zed = (t) => t.replace(/s/g, (c) => (chance(0.6) ? 'z' : c)).replace(/S/g, (c) => (chance(0.6) ? 'Z' : c));
  return (taken = {}) => {
    for (let i = 0; i < 30; i++) {
      let n;
      if (chance(0.3)) n = alienSpice();
      else {
        const w = phrase();
        if (new Set(w).size < w.length) continue; // no repeated words
        n = w.map((x, j) => (j && /^(of|in|on|for|and|from|versus)$/.test(x) ? x : cap(x))).join(' ');
      }
      n = zed(n);
      if (n.length <= 32 && !(n in taken)) return n;
    }
    return 'Preset ' + (Object.keys(taken).length + 1);
  };
})();
