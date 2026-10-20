// The prototype's one hand-made stretch. West to east the Hallam Canal climbs
// through Brook Lock to Wendle Junction, where the trip turns right down the
// Wendle Arm to a basin beside The Navigation pub. Distances are in world
// units along each canal; at cruising speed the trip takes about 15 minutes.

import type { StretchData } from './stretch';

export const HALLAM: StretchData = {
  id: 'hallam',
  name: 'The Hallam Canal at Wendle',
  seed: 2610,
  size: { width: 5600, height: 3360 },
  waterways: [
    {
      id: 'hallam',
      name: 'Hallam Canal',
      points: [
        [-196, 2492], [420, 2387], [980, 2282], [1400, 2072], [1750, 1841], [2170, 1708], [2660, 1736],
        [3080, 1761], [3430, 1652], [3850, 1400], [4270, 1162], [4760, 980], [5250, 798], [5796, 700],
      ],
      label: { at: 532, side: 1 },
    },
    {
      id: 'wendle-arm',
      name: 'Wendle Arm',
      points: [[3500, 1862], [3563, 2128], [3654, 2366], [3780, 2520], [3850, 2632], [3976, 2691]],
      leaves: { waterway: 'hallam', atPoint: 8, junction: 'Wendle Junction' },
      label: { at: 350, side: -1 },
    },
  ],
  roads: [
    { id: 'hollin-lane', name: 'Hollin Lane', points: [[784, 3444], [896, 2800], [980, 2282], [1078, 1820], [1162, 1260], [1232, -84]] },
    { id: 'mill-road', name: 'Mill Road', points: [[2884, 3444], [2968, 2800], [3038, 2240], [3080, 1761], [3150, 1260], [3262, -84]] },
  ],
  features: [
    { kind: 'bridge', id: 'hollin-bridge', name: 'Hollin Bridge', waterway: 'hallam', at: 1195, road: 'hollin-lane', labelSide: 1 },
    {
      kind: 'moorings',
      id: 'visitor-moorings',
      name: 'Visitor moorings',
      waterway: 'hallam',
      at: 1601,
      labelSide: 1,
      boats: [
        { at: 1482, facing: 1, livery: 0 },
        { at: 1601, facing: -1, livery: 1 },
        { at: 1720, facing: 1, livery: 2 },
      ],
    },
    { kind: 'lock', id: 'brook-lock', name: 'Brook Lock', waterway: 'hallam', at: 2336, uphill: 1, labelSide: -1 },
    { kind: 'bridge', id: 'mill-bridge', name: 'Mill Bridge', waterway: 'hallam', at: 3441, road: 'mill-road', labelSide: -1 },
    { kind: 'footbridge', id: 'wendle-footbridge', name: 'Footbridge', waterway: 'wendle-arm', at: 109 },
    {
      kind: 'basin',
      id: 'wendle-basin',
      name: 'Wendle Basin',
      waterway: 'wendle-arm',
      at: 1234,
      area: { x: 3752, y: 2562, width: 420, height: 189 },
      boats: [
        { at: [3900, 2595], angle: Math.PI, livery: 3 },
        { at: [4010, 2595], angle: 0, livery: 4 },
        { at: [4128, 2650], angle: Math.PI / 2, livery: 5 },
      ],
    },
  ],
  woods: [
    { name: 'Coppice Wood', centre: [4620, 2128], radius: [462, 308] },
    { name: 'Long Spinney', centre: [1344, 1204], radius: [532, 210] },
    { name: 'Hob Wood', centre: [5040, 2772], radius: [280, 196] },
  ],
  ponds: [{ name: 'Kettle Pond', centre: [2408, 2632], radius: [140, 76] }],
  villages: [{ name: 'Wendle', road: 'mill-road', from: 462, houses: 16, label: [2870, 2548] }],
  farms: [{ road: 'hollin-lane', at: 2800, side: 1 }],
  pubs: [{ name: 'The Navigation', at: [3860, 2822] }],
  mapNotes: [
    { text: 'to Hallam', at: [5320, 658] },
    { text: 'from Kingsbridge', at: [420, 2660] },
  ],
  trip: {
    from: { name: 'Kingsbridge', waterway: 'hallam', at: 322 },
    route: ['hallam', 'wendle-arm'],
    to: 'wendle-basin',
  },
};
