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
 * B last_initial
 * C club
 * D registered_at
 * E attempt_status          ← club editable
 * F end_1_score             ← club editable
 * G end_2_score             ← club editable
 * H end_3_score             ← club editable
 * I end_4_score             ← club editable
 * J total_score             ← formula, protected
 * K public_display          ← Master-only checkbox
 *                              default FALSE
 *                              auto-TRUE on first transition to completed
 * L registration_id        ← stable identity key, protected
 *
 * Club admins edit only E:I.
 *
 * COLUMN RESOLUTION: every read/write in the Tito ingest and
 * club↔master sync paths looks up each of the 12 header names above by
 * text, via resolveColumns_(), rather than assuming the letters above.
 * A sheet whose columns have been reordered, or that has extra columns
 * added elsewhere, still works. A sheet that is missing one of the 12
 * names (typo, deletion, accidental overwrite) fails loudly — the
 * write is refused and logged to the "System Errors" sheet instead of
 * silently landing in the wrong column. prepareAllSheets() (menu item
 * "Repair All Sheets") is stricter: it requires the canonical A:L
 * order exactly, and stops with an alert rather than reformatting a
 * sheet that's out of order.
 *
 * Club → Master sync:
 * - matched by registration_id
 * - copies attempt_status + the four end scores
 * - Master total_score recalculates
 * - public_display is NEVER copied from clubs
 *
 * Public display behavior:
 * - new registration = unchecked
 * - first transition to completed = checked
 * - Lauren can manually uncheck a completed player
 * - future syncs do NOT force it back on
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
  'last_initial',
  'club',
  'registered_at',
  'attempt_status',
  'end_1_score',
  'end_2_score',
  'end_3_score',
  'end_4_score',
  'total_score',
  'public_display',
  'registration_id'
];

var HEADER_KEYS = [
  'FIRST',
  'LAST',
  'CLUB',
  'REGISTERED',
  'STATUS',
  'E1',
  'E2',
  'E3',
  'E4',
  'TOTAL',
  'PUBLIC',
  'REG_ID'
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
