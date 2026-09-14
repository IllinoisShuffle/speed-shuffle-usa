import { clubsById } from '../lib/clubs';
import { tournamentConfig } from '../lib/config';
import type { ClubStats, PlayerStanding } from '../lib/types';

interface Snapshot { players: PlayerStanding[]; stats: ClubStats[]; showScores: boolean; updatedAt: string }
const status = document.querySelector<HTMLElement>('#connection-status')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh-leaderboard')!;
const body = document.querySelector<HTMLTableSectionElement>('#leaderboard-body')!;
let busy = false;
let lastUpdate: string | null = null;

function cell(tag: 'th' | 'td', value: string | number, className = '') {
  const element = document.createElement(tag);
  element.textContent = String(value);
  element.className = className;
  return element;
}

function render(data: Snapshot) {
  const header = document.createElement('tr');
  for (const [name, css] of [['Rank', 'rank'], ['Player', ''], ['Club', ''], ...(data.showScores ? [['Score', 'score']] : [])]) {
    const th = cell('th', name, css); th.setAttribute('scope', 'col'); header.append(th);
  }
  document.querySelector('#leaderboard-head')!.replaceChildren(header);
  document.querySelector('#score-status')!.textContent = data.showScores ? 'Scores revealed' : 'Scores hidden';
  document.querySelector('#player-count')!.textContent = String(data.players.length);
  const rows = data.players.map(player => {
    const row = document.createElement('tr');
    row.dataset.playerId = player.id;
    const rank = cell('td', player.rank, 'rank');
    if (player.rank <= tournamentConfig.payoutPositions) {
      row.className = 'payout-row';
      const note = document.createElement('span'); note.className = 'sr-only'; note.textContent = ' · Payout position'; rank.append(note);
    }
    const name = cell('th', player.displayName, 'player-name'); name.setAttribute('scope', 'row');
    const club = clubsById[player.clubId];
    const clubCell = cell('td', '');
    const label = document.createElement('span'); label.className = 'club-label'; label.style.setProperty('--club-color', club.color);
    const dot = document.createElement('span'); dot.className = 'club-dot'; dot.setAttribute('aria-hidden', 'true');
    label.append(dot, document.createTextNode(club.shortName)); clubCell.append(label);
    row.append(rank, name, clubCell);
    if (data.showScores) { const score = cell('td', player.score ?? '—', 'score'); score.dataset.playerScore = ''; row.append(score); }
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr'); const empty = cell('td', 'No public completed results yet.');
    empty.colSpan = data.showScores ? 4 : 3; row.append(empty); rows.push(row);
  }
  body.replaceChildren(...rows);
  const list = document.querySelector('#club-standings-list')!;
  for (const stats of data.stats.toSorted((a, b) => b.completed - a.completed)) {
    const card = document.querySelector(`[data-club-card="${stats.clubId}"]`)!;
    card.querySelector('[data-registered]')!.textContent = String(stats.registered);
    card.querySelector('[data-completed]')!.textContent = String(stats.completed);
    const standing = document.querySelector(`[data-club-standing="${stats.clubId}"]`)!;
    standing.querySelector('[data-registered]')!.textContent = `${stats.registered} registered`;
    standing.querySelector('[data-completed]')!.textContent = `${stats.completed} completed`;
    const progress = standing.querySelector('progress')!;
    progress.max = Math.max(1, stats.registered); progress.value = stats.completed;
    progress.setAttribute('aria-label', `${clubsById[stats.clubId].name}: ${stats.completed} of ${stats.registered} registered players completed`);
    list.append(standing);
  }
}

async function load() {
  if (busy) return;
  busy = true; refresh.disabled = true;
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
    // Clear old standings on an error, avoiding retained scores/opted-out names.
    body.replaceChildren();
    document.querySelector('#player-count')!.textContent = '—';
    document.querySelectorAll('[data-registered], [data-completed]').forEach(element => { element.textContent = '—'; });
    document.querySelectorAll('progress').forEach(element => { element.value = 0; });
    status.textContent = `${error instanceof Error ? error.message : 'Unable to load standings.'}${lastUpdate ? ` Last successful update: ${lastUpdate}.` : ''}`;
    status.dataset.state = 'error';
  } finally { busy = false; refresh.disabled = false; }
}

refresh.addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
setInterval(() => { if (!document.hidden) void load(); }, 30000);
void load();
