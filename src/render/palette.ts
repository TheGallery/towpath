// The painted look's colours.

export const COLOURS = {
  grass: '#a4cd7c',
  water: '#5b95ab',
  waterDeep: '#3f6f82',
  waterLight: '#c4e3ea',
  verge: '#93b768',
  bank: '#6f7f50',
  towpath: '#dcc9a0',
  towpathEdge: '#b3a07a',
  coping: '#e6dfcf',
  copingEdge: '#a59c8b',
  road: '#a8a296',
  roadVerge: '#c9b88f',
  stone: '#cdbfa4',
  stoneDark: '#a99a7e',
  hedge: '#41763a',
  hedgeLight: '#5a9447',
  wood: '#4f7f3f',
  roofRed: '#a5523c',
  roofSlate: '#6b6e73',
  garden: '#b9d98f',
  ink: '#2b3a3f',
  paper: '#f3ead4',
  skin: '#e2b48c',
  brass: '#c9a227',
  route: '#c0392b',
} as const;

/** The map view's guidebook colours. */
export const MAP_COLOURS = {
  paper: '#f3ead4',
  hedge: '#ddd0ad',
  water: '#2f6f88',
  pond: '#bcd9e2',
  pondEdge: '#8fb6c4',
  wood: '#d3e2b5',
  woodEdge: '#a9c08a',
  tree: '#b9cf98',
  road: '#fffaf0',
  roadEdge: '#b9a98a',
  house: '#c3b49a',
  towpath: '#8a7a5a',
  moorings: '#3f8a4f',
  pub: '#a8402f',
} as const;

export interface Livery {
  readonly roof: string;
  readonly side: string;
}

/** Paint schemes for boats, picked by number. */
export const LIVERIES: readonly Livery[] = [
  { roof: '#7a2e3a', side: '#2f4f86' },
  { roof: '#e8dcc0', side: '#2f6b4a' },
  { roof: '#3a3a3a', side: '#c9962b' },
  { roof: '#2f4f86', side: '#e8dcc0' },
  { roof: '#b8433a', side: '#24543a' },
  { roof: '#e8dcc0', side: '#7a2e3a' },
];

/** Your own boat. */
export const YOUR_BOAT: Livery & { steerer: string } = { roof: '#2f6b4a', side: '#b8433a', steerer: '#e9c46a' };

/** The other boat that uses the lock before you. */
export const OTHER_BOAT: Livery & { steerer: string } = { roof: '#e8dcc0', side: '#2f4f86', steerer: '#a8402f' };

export const livery = (n: number): Livery => LIVERIES[((n % LIVERIES.length) + LIVERIES.length) % LIVERIES.length];

/** What people on the towpath wear, and their dogs' coats, picked by number. */
export const WALKER_COATS: readonly string[] = ['#3f5f8a', '#a8402f', '#6b4a7a', '#2f6b4a', '#c9962b', '#5b6763', '#8a5a3a'];
export const JOGGER_TOPS: readonly string[] = ['#e76f51', '#2a9d8f', '#e9c46a', '#d1495b'];
export const HEADS: readonly string[] = ['#8b5a2b', '#3a312b', '#d9c9a0', '#b8433a', '#2f4f86', '#6b6e73'];
export const DOG_COATS: readonly (readonly [string, string])[] = [
  ['#8b5a2b', '#5e3c1c'],
  ['#2b2b2b', '#1a1a1a'],
  ['#6b4a35', '#3a2a1e'],
  ['#c9962b', '#8b5a2b'],
  ['#f2efe6', '#2b2b2b'],
];

/** One of a list, picked by any whole number. */
export const pick = <T>(list: readonly T[], n: number): T => list[((n % list.length) + list.length) % list.length];

/** A colour part way between two hex colours. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = parse(a);
  const y = parse(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
