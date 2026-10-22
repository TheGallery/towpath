// Names for a made canal, put together from parts the way English place names
// are: a start and an ending for towns and villages, and a word for each lock,
// lane and pub. A blocklist keeps the parts from ever running together into a
// word that shouldn't be there, and no name is used twice on one canal.

/** How English place names begin. */
const STARTS = [
  'Alder', 'Ash', 'Bar', 'Beck', 'Birch', 'Bram', 'Brock', 'Bud', 'Cal', 'Chal', 'Clay', 'Cold', 'Crow', 'Dun', 'Elm', 'Fen',
  'Gar', 'Hay', 'Hazel', 'Heath', 'Hol', 'Kel', 'Ket', 'Kings', 'Lang', 'Lid', 'Lox', 'Mar', 'Mel', 'Mere', 'Nether', 'Oak',
  'Ock', 'Pen', 'Rad', 'Red', 'Rush', 'Sal', 'Sand', 'Sedge', 'Shel', 'Stan', 'Stock', 'Thorn', 'Wal', 'Wel', 'Whit', 'Wil',
  'Wold', 'Wych', 'Yar',
];
/** How they end. */
const ENDINGS = [
  'bury', 'by', 'cliffe', 'combe', 'cote', 'den', 'field', 'ford', 'ham', 'hope', 'hurst', 'ley', 'low', 'more', 'over', 'shaw',
  'stead', 'stow', 'thorpe', 'ton', 'well', 'wick', 'worth',
];

export const LOCK_WORDS = ['Brook', 'Mill', 'Kiln', 'Willow', 'Heron', 'Swan', 'Church', 'Weir', 'Malt', 'Tanyard', 'Pinfold', 'Tithe', 'Kingfisher', 'Lime', 'Salt', 'Bottom', 'Toll', 'Paper', 'Forge', 'Sluice'];
export const LANE_WORDS = ['Hollin', 'Church', 'Moor', 'Stocks', 'Green', 'Pound', 'Back', 'Holloway', 'Gorse', 'Coldharbour', 'Sheep', 'Watery', 'Brickyard', 'Hob', 'Long', 'Ridgeway', 'Pack', 'Chapel'];
export const WOOD_KINDS = ['Wood', 'Wood', 'Spinney', 'Copse', 'Coppice', 'Hanger'];
export const POND_WORDS = ['Kettle', 'Duck', 'Hob', 'Marl', 'Clay', 'Moat', 'Mill'];
export const PUBS = ['The Navigation', 'The Boat Inn', 'The Anchor', 'The Swan', 'The Lock & Key', 'The Barge', 'The Wharf House', 'The Kingfisher', 'The Plough', 'The Bargee', 'The Junction Inn', 'The Cuckoo', 'The Packhorse', 'The Heron'];
export const BANK_SPOTS = ['Under the oaks', 'Beside the willows', 'Near the stile', 'Opposite the meadow', 'By the old milepost', 'Under the ash tree', 'Where the hedge dips', 'By the water point'];
export const FAR_ENDS = ['At the far end, looking over the fields', 'At the far end, by the hawthorn', 'At the far end, under the hill'];

/** Bits of words a made name must never contain, however its parts run together. */
export const BLOCKED = ['arse', 'bum', 'cock', 'crap', 'cum', 'cunt', 'dick', 'fag', 'fuck', 'knob', 'nob', 'piss', 'poo', 'rape', 'shit', 'slag', 'slut', 'tit', 'twat', 'wank', 'whore'];

/** True if a name is fit to use: nothing on the blocklist is in it. */
export const fitName = (name: string): boolean => !BLOCKED.some((b) => name.toLowerCase().includes(b));

export interface Namer {
  /** One of a list, picked at random. */
  pick<T>(list: readonly T[]): T;
  /** A town or village name not yet used on this canal. */
  place(): string;
  /** A word from a list not yet used on this canal, as for naming a lock or a lane. */
  word(list: readonly string[]): string;
}

/** Names for one canal, from a random sequence. */
export function namer(r: () => number): Namer {
  const used = new Set<string>();
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const fresh = (make: () => string): string => {
    let name = make();
    // A name already used will do once the list runs out, but one on the blocklist never will.
    for (let i = 0; !fitName(name) || (used.has(name) && i < 80); i++) name = make();
    used.add(name);
    return name;
  };
  // A start and an ending that meet on the same letter share it, as Heath and ham make Heatham, but for an l, as in Kelley.
  const join = (start: string, end: string): string => (start.endsWith(end[0]) && end[0] !== 'l' ? start + end.slice(1) : start + end);
  return {
    pick,
    place: () => fresh(() => join(pick(STARTS), pick(ENDINGS))),
    word: (list) => fresh(() => pick(list)),
  };
}
