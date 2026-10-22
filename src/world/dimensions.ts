// Sizes shared by the rules and the drawing. A world unit is about a quarter
// of a metre, so the 74-unit boat is a 58-foot narrowboat.

export const METRES_PER_UNIT = 0.24;

export const BOAT_LENGTH = 74;
export const BOAT_BEAM = 10;

/** Width of open water in the canal. */
export const CANAL_WIDTH = 44;

/** How far a lock's stonework reaches either side of its middle, past the gates. */
export const LOCK_REACH = 122;

/** Width of the water through a lock: a narrowboat's beam and a little room either side. */
export const LOCK_WIDTH = 18;

/** How far either side of a lock's middle its canal runs straight: through the lock, and past the landings where boats wait for it. */
export const LOCK_STRAIGHT = 260;

/** The radius of a basin's rounded corners. */
export const BASIN_CORNER = 26;

/** How far the towpath's centre is from the canal's centre line, on the right-hand side. */
export const TOWPATH_OFFSET = 33;

/** How far a road bridge's deck reaches either side of the canal's centre line, where it meets the road. */
export const BRIDGE_DECK = 56;

/** How far a moored boat's centre is from the canal's centre line. */
export const MOORED_OFFSET = 17;

/** World units per second at a given speed in miles per hour, and back. */
export const unitsPerSecond = (mph: number): number => (mph * 0.44704) / METRES_PER_UNIT;
export const milesPerHour = (unitsPerSec: number): number => (unitsPerSec * METRES_PER_UNIT) / 0.44704;
