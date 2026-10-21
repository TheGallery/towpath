export const GAME_TITLE = 'Towpath';

/** The tab's title: the game's name, with a bell and what's needed first when the boat is calling you. */
export const tabTitle = (call: string | null): string => (call ? `🔔 ${call} · ${GAME_TITLE}` : GAME_TITLE);
