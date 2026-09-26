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
export const tournamentContactEmail = 'speedshuffle@illinoisshuffleboard.org';

// Pending content (HANDOFF.md §12): real dates arrive before launch.
export const tournamentDates = {
  boardOpensLabel: 'October 1',
  start: null as string | null,
  end: null as string | null,
};
