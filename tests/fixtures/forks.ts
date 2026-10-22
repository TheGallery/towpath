// A hand-made test stretch with more than one choice in a day. West to east
// the Ashby Canal climbs through Bottom Lock to Elm Junction, a three-way
// junction where the Kent Canal goes north and the Ferry Arm south. Straight
// on, it climbs through Top Lock to Bramble Junction, where the Mill Arm turns
// south to a basin by a pub and the main line goes on east to a bank. The
// Ferry Arm has a lock of its own past the junction, on a way the day doesn't
// follow until you choose it.

import type { StretchData } from '../../src/world/stretch';

export const FORKS: StretchData = {
  id: 'forks',
  name: 'The Ashby Canal at Elm',
  seed: 77,
  size: { width: 6600, height: 4000 },
  waterways: [
    {
      id: 'ashby',
      name: 'Ashby Canal',
      points: [
        [-200, 2100], [800, 2060], [1800, 2000], [2450, 1985], [2800, 1980], [3500, 2020], [4300, 1990], [5100, 1950], [5900, 1960], [6800, 2000],
      ],
    },
    {
      id: 'kent',
      name: 'Kent Canal',
      points: [[2880, 1680], [2950, 1280], [2900, 780], [3000, 280], [3050, -200]],
      leaves: { waterway: 'ashby', atPoint: 4, junction: 'Elm Junction' },
    },
    {
      id: 'ferry-arm',
      name: 'Ferry Arm',
      points: [[2880, 2280], [2950, 2680], [2900, 3180], [3000, 3680], [3050, 4200]],
      leaves: { waterway: 'ashby', atPoint: 4, junction: 'Elm Junction' },
    },
    {
      id: 'mill-arm',
      name: 'Mill Arm',
      points: [[5180, 2250], [5250, 2600], [5350, 2900], [5500, 3050]],
      leaves: { waterway: 'ashby', atPoint: 7, junction: 'Bramble Junction' },
    },
  ],
  roads: [],
  features: [
    { kind: 'lock', id: 'bottom-lock', name: 'Bottom Lock', waterway: 'ashby', at: 1900, uphill: 1 },
    { kind: 'footbridge', id: 'elm-footbridge', name: 'Footbridge', waterway: 'ashby', at: 2880 },
    { kind: 'footbridge', id: 'ferry-footbridge', name: 'Footbridge', waterway: 'ferry-arm', at: 110 },
    { kind: 'lock', id: 'top-lock', name: 'Top Lock', waterway: 'ashby', at: 3800, uphill: 1 },
    { kind: 'lock', id: 'ferry-lock', name: 'Ferry Lock', waterway: 'ferry-arm', at: 700, uphill: -1 },
    { kind: 'footbridge', id: 'mill-footbridge', name: 'Footbridge', waterway: 'mill-arm', at: 110 },
    {
      kind: 'basin',
      id: 'mill-basin',
      name: 'Mill Basin',
      waterway: 'mill-arm',
      at: 1180,
      area: { x: 5350, y: 2980, width: 420, height: 190 },
      boats: [{ at: [5700, 3020], angle: Math.PI, livery: 2 }],
      about: 'by The Mill pub',
      spots: [
        { name: 'By the pub garden', at: [5440, 3140], angle: 0 },
        { name: 'Along the south wall', at: [5560, 3140], angle: 0 },
        { name: 'In the far corner', at: [5680, 3140], angle: 0 },
      ],
    },
    {
      kind: 'bank',
      id: 'east-bank',
      name: 'Hob Hill bank',
      waterway: 'ashby',
      at: 6100,
      about: 'a quiet bank under the hill',
      spots: [
        { name: 'Under the willows', at: 6180 },
        { name: 'At the far end', at: 6280 },
      ],
    },
    {
      kind: 'bank',
      id: 'kent-bank',
      name: 'Kent Common',
      waterway: 'kent',
      at: 1400,
      about: 'an open common',
      spots: [
        { name: 'By the stile', at: 1480 },
        { name: 'Past the gorse', at: 1580 },
      ],
    },
    {
      kind: 'bank',
      id: 'ferry-bank',
      name: 'Ferry Meadow',
      waterway: 'ferry-arm',
      at: 1400,
      about: 'a meadow by the old ferry',
      spots: [
        { name: 'By the ferry steps', at: 1480 },
        { name: 'Along the meadow', at: 1580 },
      ],
    },
  ],
  woods: [],
  ponds: [],
  villages: [],
  farms: [],
  pubs: [{ name: 'The Mill', at: [5460, 3260] }],
  mapNotes: [],
  trip: {
    from: { name: 'Ashby Wharf', waterway: 'ashby', at: 300 },
    ways: [
      { id: 'mill', route: ['ashby', 'mill-arm'], to: 'mill-basin' },
      { id: 'east', route: ['ashby'], to: 'east-bank' },
      { id: 'north', route: ['ashby', 'kent'], to: 'kent-bank' },
      { id: 'south', route: ['ashby', 'ferry-arm'], to: 'ferry-bank' },
    ],
  },
};
