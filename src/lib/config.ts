export type Stage = 'before' | 'during' | 'final';

function resolveStage(): Stage {
  // import.meta.env.PUBLIC_* is inlined by Vite (Astro pages + the browser
  // bundle); process.env is the fallback for the Netlify function, which is
  // bundled by esbuild outside Vite. `typeof process` never throws even when
  // the global is undefined, so this stays safe in the browser.
  const fromVite: string | undefined = (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_STAGE;
  const fromNode: string | undefined = typeof process !== 'undefined' ? process.env.PUBLIC_STAGE : undefined;
  const raw = fromVite ?? fromNode;
  return raw === 'during' || raw === 'final' ? raw : 'before';
}

export const stage: Stage = resolveStage();

export const tournamentConfig = {
  stage,
  showScores: stage === 'final',
  payoutPositions: 10,
};

export const registrationUrl = 'https://ti.to/ilsa/speedshuffle2026';
export const tournamentContactEmail = 'USAspeed@illinoisshuffleboard.org';

// The competition runs October 1–31. `end` is the exclusive cutoff: midnight
// Central at the close of October 31, the latest time zone among the clubs.
export const tournamentDates = {
  boardOpensLabel: 'October 1',
  start: '2026-10-01T00:00:00-04:00' as string | null,
  end: '2026-11-01T00:00:00-05:00' as string | null,
};
