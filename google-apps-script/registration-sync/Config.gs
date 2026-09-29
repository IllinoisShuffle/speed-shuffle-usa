/**
 * Speed Shuffle — Score Tracking System
 * Bound to: ADMIN - Speed Shuffle Score Tracker
 *
 * This project is split across several .gs files for readability.
 * Apps Script merges every file in a project into one shared global
 * scope at runtime — there is no import/export, and function
 * declarations are visible across files regardless of load order.
 * Config.gs (this file) holds every top-level constant; every other
 * file is organized by responsibility:
 *   Config.gs   - constants (this file)
 *   Admin.gs    - menu, onEdit, one-time tools, test helpers
 *   Columns.gs  - header-name column resolution
 *   Repair.gs   - sheet formatting/protection setup ("Repair All Sheets")
 *   Sync.gs     - club -> master sync + its time trigger
 *   Ingest.gs   - Tito webhook (doPost) + registration upsert
 *   ErrorLog.gs - the "System Errors" sheet + email alerting
 *
 * CANONICAL COLUMN ORDER (what prepareAllSheets() lays down
 * on a fresh or reset sheet):
 * A first_name
 * B last_name               ← full name, protected (see note below)
 * C club
 * D registered_at
 * E attempt_status          ← club editable
 * F end_1_score             ← club editable
 * G end_2_score             ← club editable
 * H end_3_score             ← club editable
 * I end_4_score             ← club editable
 * J total_score             ← formula, protected
 * K hide_publicly           ← Master-only checkbox, opt-out
 *                              default FALSE (visible once completed)
 *                              Lauren checks it to hide one specific
 *                              completed player; nothing else ever
 *                              touches this column
 * L registration_id        ← stable identity key, protected
 * M email                   ← protected
 *
 * Club admins edit only E:I.
 *
 * This sheet is the operational record for running the event — it
 * intentionally holds real identity data (full last name, email) that
 * the club and tournament staff need to check people in, resolve
 * disputes, and make contact. That is a separate concern from the
 * public results website, which only ever wants a first name + last
 * initial and must never see email. Keeping the full data here and
 * having the *website's own query* derive/redact what it publicly
 * shows (see netlify/lib/standings.ts) means this schema serves running
 * the competition, not the other way around.
 *
 * COLUMN RESOLUTION: every read/write in the Tito ingest and
 * club↔master sync paths looks up each of the 13 header names above by
 * text, via resolveColumns_(), rather than assuming the letters above.
 * A sheet whose columns have been reordered, or that has extra columns
 * added elsewhere, still works. A sheet that is missing one of the 13
 * names (typo, deletion, accidental overwrite) fails loudly — the
 * write is refused and logged to the "System Errors" sheet instead of
 * silently landing in the wrong column. prepareAllSheets() (menu item
 * "Repair All Sheets") is stricter: it requires the canonical A:M
 * order exactly, and stops with an alert rather than reformatting a
 * sheet that's out of order.
 *
 * Club → Master sync:
 * - matched by registration_id
 * - copies attempt_status + the four end scores
 * - Master total_score recalculates
 * - hide_publicly is entirely outside the sync's scope — it never
 *   reads or writes that column, in either direction
 *
 * Public visibility (hide_publicly) is opt-out, not opt-in:
 * - new registration = unchecked (visible, once completed)
 * - a completed registrant is visible on the public site the moment
 *   attempt_status flips to completed — nothing else has to happen
 * - Lauren checks hide_publicly to hide one specific completed player
 * - nothing ever re-checks or un-checks it automatically, so there is
 *   no "future syncs force it back" case to guard against
 */


/* =========================================================
   CONFIG
   ========================================================= */

var SS_MENU = 'Speed Shuffle';

var MASTER_SHEET = 'MASTER';
var CLUB_DATA_SHEET = 'Players';
var SYSTEM_ERROR_SHEET = 'System Errors';

var PREFORMAT_ROWS = 1000;
var LAST_DATA_ROW = 1000;
var DATA_ROWS = LAST_DATA_ROW - 1; // rows 2:1000

var LOCK_WAIT_MS = 30000;

/*
 * notifySystemFailure_ (ErrorLog.gs) throttles to at most one email
 * per `source` per cooldown window, so a persistent failure re-hit by
 * the 1-minute syncFromClubsNow trigger can't flood INGEST_ALERT_EMAIL
 * with one message per run. The System Errors sheet still gets every
 * occurrence — only the email is throttled.
 */
var ALERT_EMAIL_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
var ALERT_LAST_SENT_PROPERTY_PREFIX = 'alertLastSent:';

/*
 * Pause Automatic Sync (Sync.gs) sets this Script Property rather than
 * deleting the installed trigger -- ScriptApp.getProjectTriggers() only
 * returns triggers created by the *currently executing user's own
 * account*, so a trigger installed by one person can be invisible (and
 * undeletable) to everyone else with edit access, even though the
 * trigger keeps firing. A Script Property is project-wide, not
 * per-user, so pausing/resuming works regardless of who originally ran
 * "Install Automatic Sync".
 */
var SYNC_PAUSED_PROPERTY = 'syncPaused';

var STATUS_VALUES = [
  'registered',
  'completed',
  'cancelled'
];

/*
 * Parallel arrays: HEADER_ORDER[i] is the exact header text sheets
 * must contain somewhere in row 1; HEADER_KEYS[i] is the logical name
 * used everywhere else in this script to refer to it, independent of
 * its actual column letter.
 */
var HEADER_ORDER = [
  'first_name',
  'last_name',
  'club',
  'registered_at',
  'attempt_status',
  'end_1_score',
  'end_2_score',
  'end_3_score',
  'end_4_score',
  'total_score',
  'hide_publicly',
  'registration_id',
  'email'
];

var HEADER_KEYS = [
  'FIRST',
  'LAST_NAME',
  'CLUB',
  'REGISTERED',
  'STATUS',
  'E1',
  'E2',
  'E3',
  'E4',
  'TOTAL',
  'HIDE',
  'REG_ID',
  'EMAIL'
];

var CLUBS = [
  {
    id: 'beachside',
    label: 'Beachside Social',
    workbookId: '1k4DGRCloxptOybFFmmcjswKFiH2WXjiX5qF34lmwqCE'
  },
  {
    id: 'chicago',
    label: 'Chicago',
    workbookId: '13122dv3IACbTO3aY7ry6R9k9-dTOJXTIvXwxqwHQcdA'
  },
  {
    id: 'brooklyn',
    label: 'New York / Brooklyn',
    workbookId: '1krKP408NhN4A8gLMb_4hLfnswur1ERbW4tKhfL7tQT4'
  },
  {
    id: 'st-pete',
    label: 'St. Pete',
    workbookId: '1W9Y9lGO9mMFPQImO7eOuXKrEGv1LXxQ6FDE3hcQutoI'
  },
  {
    id: 'tampa',
    label: 'Tampa',
    workbookId: '1d_q0LS9oenMLV77d2UDZ012_jGDBv3onDMAs0MLt3hU'
  }
];
