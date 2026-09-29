import { clubs, clubsById } from '../lib/clubs';
import { tournamentConfig } from '../lib/config';
import { formatRank, prizePercentFor } from '../lib/prizes';
import type { ClubId, ClubStats, PlayerStanding } from '../lib/types';

interface Snapshot { players: PlayerStanding[]; stats: ClubStats[]; showScores: boolean; updatedAt: string }

const { stage, payoutPositions } = tournamentConfig;
const DEFAULT_VISIBLE = 12;

const status = document.querySelector<HTMLElement>('#connection-status')!;
const scoreStatus = document.querySelector<HTMLElement>('#score-status')!;
const emptyState = document.querySelector<HTMLElement>('#leaderboard-empty')!;
const content = document.querySelector<HTMLElement>('#leaderboard-content')!;
const filterRow = document.querySelector<HTMLElement>('#club-filters')!;
const body = document.querySelector<HTMLTableSectionElement>('#leaderboard-body')!;
const showAllButton = document.querySelector<HTMLButtonElement>('#show-all-players')!;
const standingsList = document.querySelector<HTMLElement>('#club-standings-list')!;

let latest: Snapshot | null = null;
let activeClub: ClubId | 'all' = 'all';
let expanded = false;
let busy = false;
let lastUpdate: string | null = null;

function cell(tag: 'th' | 'td', value: string | number, className = ''): HTMLTableCellElement {
  const element = document.createElement(tag);
  element.textContent = String(value);
  if (className) element.className = className;
  return element;
}

function clubPill(clubId: ClubId): HTMLSpanElement {
  const club = clubsById[clubId];
  const span = document.createElement('span');
  span.className = 'club-label';
  span.style.setProperty('--club-color', club.accentColor);
  span.style.setProperty('--club-ink', club.labelTextColor);
  span.textContent = club.shortName;
  return span;
}

function lockIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5A1.5 1.5 0 0 1 12.5 15h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z',
  );
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

function renderLeaderboard() {
  if (!latest) return;
  const totalPlayers = latest.players.length;

  if (totalPlayers === 0 && stage === 'before') {
    emptyState.hidden = false;
    content.hidden = true;
    return;
  }
  emptyState.hidden = true;
  content.hidden = false;

  const filtered = activeClub === 'all' ? latest.players : latest.players.filter(player => player.clubId === activeClub);
  const visibleCount = expanded ? filtered.length : Math.min(DEFAULT_VISIBLE, filtered.length);
  const rows = filtered.slice(0, visibleCount);

  const tableRows: HTMLTableRowElement[] = [];
  let payoutLineInserted = false;

  for (const player of rows) {
    if (activeClub === 'all' && !payoutLineInserted && player.rank > payoutPositions) {
      const divider = document.createElement('tr');
      divider.className = 'payout-divider';
      const td = document.createElement('td');
      td.colSpan = latest.showScores && stage === 'final' ? 5 : 4;
      td.textContent = 'Payout line';
      divider.append(td);
      tableRows.push(divider);
      payoutLineInserted = true;
    }

    const row = document.createElement('tr');
    row.dataset.playerId = player.id;
    const isPayout = player.rank <= payoutPositions;
    if (isPayout) row.className = 'payout-row';

    const rankCell = document.createElement('td');
    rankCell.className = 'rank';
    const rankInner = document.createElement('span');
    rankInner.className = isPayout ? 'rank-disc rank-disc--payout' : 'rank-disc';
    rankInner.textContent = formatRank(player.rank, latest.players);
    rankCell.append(rankInner);
    if (isPayout) {
      const note = document.createElement('span');
      note.className = 'sr-only';
      note.textContent = ' · Payout position';
      rankCell.append(note);
    }

    const nameCell = document.createElement('th');
    nameCell.setAttribute('scope', 'row');
    if (player.hidden) {
      nameCell.className = 'player-name player-name--hidden';
      nameCell.append(lockIcon(), document.createTextNode(' ' + player.displayName));
    } else {
      nameCell.className = 'player-name';
      nameCell.textContent = player.displayName;
    }

    const clubCell = document.createElement('td');
    clubCell.append(clubPill(player.clubId));

    const scoreCell = document.createElement('td');
    scoreCell.className = 'score';
    if (latest.showScores) {
      scoreCell.textContent = String(player.score ?? '—');
      scoreCell.dataset.playerScore = '';
    } else {
      scoreCell.classList.add('score--hidden');
      scoreCell.append(lockIcon(), document.createTextNode(' Hidden'));
    }

    row.append(rankCell, nameCell, clubCell, scoreCell);

    if (stage === 'final') {
      const prize = prizePercentFor(player.rank, latest.players);
      row.append(cell('td', prize !== null ? `${prize}%` : '—', 'prize'));
    }

    tableRows.push(row);
  }

  if (rows.length === 0) {
    const row = document.createElement('tr');
    const emptyCell = cell('td', 'No public completed results yet.');
    emptyCell.colSpan = stage === 'final' ? 5 : 4;
    row.append(emptyCell);
    tableRows.push(row);
  }

  body.replaceChildren(...tableRows);

  if (filtered.length > DEFAULT_VISIBLE) {
    showAllButton.hidden = false;
    showAllButton.setAttribute('aria-expanded', String(expanded));
    showAllButton.textContent = expanded ? 'Show fewer' : `Show all ${filtered.length} players`;
  } else {
    showAllButton.hidden = true;
  }

  scoreStatus.textContent = latest.showScores ? 'Scores revealed' : 'Scores hidden';
}

function renderClubStandings() {
  if (!latest) return;
  const byId = new Map(latest.stats.map(stat => [stat.clubId, stat]));
  const sorted = clubs
    .map(club => ({ club, stats: byId.get(club.id) ?? { clubId: club.id, registered: 0, completed: 0 } }))
    .toSorted((a, b) => (stage === 'before' ? b.stats.registered - a.stats.registered : b.stats.completed - a.stats.completed));

  const items: HTMLLIElement[] = [];

  for (const { club, stats } of sorted) {
    const item = document.createElement('li');
    item.style.setProperty('--club-color', club.accentColor);

    const heading = document.createElement('h4');
    heading.append(clubPill(club.id));
    item.append(heading);

    const statLine = document.createElement('p');
    statLine.className = 'standings-stat';
    statLine.textContent = stage === 'before' ? `${stats.registered} registered` : `${stats.completed} / ${stats.registered} completed`;
    item.append(statLine);

    const progress = document.createElement('progress');
    progress.max = Math.max(1, stats.registered);
    progress.value = stats.completed;
    progress.setAttribute('aria-label', `${club.name}: ${stats.completed} of ${stats.registered} registered players completed`);
    item.append(progress);

    items.push(item);
  }

  standingsList.replaceChildren(...items);
}

function updateHeroStats(data: Snapshot) {
  const totalRegistered = data.stats.reduce((sum, stat) => sum + stat.registered, 0);
  const totalCompleted = data.stats.reduce((sum, stat) => sum + stat.completed, 0);
  const set = (key: string, value: string) => {
    document.querySelector(`[data-hero-stat="${key}"]`)?.replaceChildren(document.createTextNode(value));
  };
  set('registered', String(totalRegistered));
  set('completed', String(totalCompleted));
  set('players', String(totalCompleted));
  const topScore = data.players[0] && typeof data.players[0].score === 'number' ? String(data.players[0].score) : '—';
  set('top-score', topScore);
}

function updateClubDirectory(stats: ClubStats[]) {
  for (const stat of stats) {
    const card = document.querySelector(`[data-club-card="${stat.clubId}"]`);
    if (!card) continue;
    card.querySelector('[data-registered]')?.replaceChildren(document.createTextNode(String(stat.registered)));
    card.querySelector('[data-completed]')?.replaceChildren(document.createTextNode(String(stat.completed)));
    const progress = card.querySelector('progress');
    if (progress) {
      progress.max = Math.max(1, stat.registered);
      progress.value = stat.completed;
    }
  }
}

function updateWinners(players: PlayerStanding[]) {
  const emptyEl = document.querySelector<HTMLElement>('#winners-empty');
  const podiumEl = document.querySelector<HTMLElement>('#winners-podium');
  const compactEl = document.querySelector<HTMLElement>('#winners-compact');
  if (!emptyEl || !podiumEl || !compactEl) return;

  const top10 = players.filter(player => player.rank <= 10);
  if (top10.length === 0) {
    emptyEl.hidden = false;
    podiumEl.hidden = true;
    compactEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  podiumEl.hidden = false;
  compactEl.hidden = false;

  const podiumCards: HTMLElement[] = [];
  for (const rank of [2, 1, 3]) {
    const group = top10.filter(player => player.rank === rank);
    if (!group.length) continue;
    const card = document.createElement('div');
    card.className = `podium-card podium-card--rank-${rank}`;
    card.setAttribute('role', 'listitem');
    const rankSpan = document.createElement('span');
    rankSpan.className = 'podium-rank';
    rankSpan.textContent = formatRank(rank, top10);
    card.append(rankSpan);
    for (const player of group) {
      const wrap = document.createElement('div');
      wrap.className = 'podium-player';
      const name = document.createElement('p');
      if (player.hidden) {
        name.className = 'podium-name podium-name--hidden';
        name.append(lockIcon(), document.createTextNode(' ' + player.displayName));
      } else {
        name.className = 'podium-name';
        name.textContent = player.displayName;
      }
      wrap.append(name, clubPill(player.clubId));
      if (typeof player.score === 'number') {
        const score = document.createElement('p');
        score.className = 'podium-score';
        score.textContent = String(player.score);
        wrap.append(score);
      }
      const prize = prizePercentFor(player.rank, top10);
      if (prize !== null) {
        const prizeEl = document.createElement('p');
        prizeEl.className = 'podium-prize';
        prizeEl.textContent = `${prize}% of the pool`;
        wrap.append(prizeEl);
      }
      card.append(wrap);
    }
    podiumCards.push(card);
  }
  podiumEl.replaceChildren(...podiumCards);

  const compactItems: HTMLLIElement[] = [];
  for (const player of top10.filter(entrant => entrant.rank > 3)) {
    const li = document.createElement('li');
    const rankSpan = document.createElement('span');
    rankSpan.className = 'winners-compact-rank';
    rankSpan.textContent = formatRank(player.rank, top10);
    const nameSpan = document.createElement('span');
    if (player.hidden) {
      nameSpan.className = 'winners-compact-name winners-compact-name--hidden';
      nameSpan.append(lockIcon(), document.createTextNode(' ' + player.displayName));
    } else {
      nameSpan.className = 'winners-compact-name';
      nameSpan.textContent = player.displayName;
    }
    li.append(rankSpan, nameSpan, clubPill(player.clubId));
    if (typeof player.score === 'number') {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'winners-compact-score';
      scoreSpan.textContent = String(player.score);
      li.append(scoreSpan);
    }
    const prize = prizePercentFor(player.rank, top10);
    if (prize !== null) {
      const prizeSpan = document.createElement('span');
      prizeSpan.className = 'winners-compact-prize';
      prizeSpan.textContent = `${prize}%`;
      li.append(prizeSpan);
    }
    compactItems.push(li);
  }
  compactEl.replaceChildren(...compactItems);
}

function render(data: Snapshot) {
  latest = data;
  renderLeaderboard();
  renderClubStandings();
  updateHeroStats(data);
  updateClubDirectory(data.stats);
  if (stage === 'final') updateWinners(data.players);
}

async function load() {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch('/.netlify/functions/leaderboard-data', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Leaderboard temporarily unavailable.');
    if (!Array.isArray(data.players) || !Array.isArray(data.stats) || typeof data.showScores !== 'boolean') throw new Error('Leaderboard response was not valid.');
    render(data);
    lastUpdate = new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    status.textContent = `Updated ${lastUpdate} · Refreshes every 30 seconds`;
    status.dataset.state = 'connected';
  } catch (error) {
    latest = null;
    body.replaceChildren();
    standingsList.replaceChildren();
    status.textContent = `${error instanceof Error ? error.message : 'Unable to load standings.'}${lastUpdate ? ` Last successful update: ${lastUpdate}.` : ''}`;
    status.dataset.state = 'error';
  } finally {
    busy = false;
  }
}

filterRow.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-club-filter]');
  if (!button) return;
  activeClub = button.dataset.clubFilter as ClubId | 'all';
  expanded = false;
  filterRow.querySelectorAll<HTMLButtonElement>('[data-club-filter]').forEach(pill => pill.setAttribute('aria-pressed', String(pill === button)));
  renderLeaderboard();
});

showAllButton.addEventListener('click', () => {
  expanded = !expanded;
  renderLeaderboard();
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
setInterval(() => { if (!document.hidden) void load(); }, 30000);
void load();
