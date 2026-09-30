import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SCRIPT_DIR = path.join(import.meta.dirname, '..', 'google-apps-script', 'registration-sync');

// Load order deliberately differs from the project's own file order (see
// registration-sync/README.md) to prove, like the PR #2 harness did, that
// the 7-file split has no load-order dependency -- Apps Script merges every
// file into one shared global scope regardless of order.
const FILES = ['Repair.gs', 'Admin.gs', 'Sync.gs', 'Ingest.gs', 'ErrorLog.gs', 'Columns.gs', 'Config.gs'];

type CellValue = string | number | boolean;

class FakeRange {
  sheet: FakeSheet; row: number; col: number; numRows: number; numCols: number;
  constructor(sheet: FakeSheet, row: number, col: number, numRows: number, numCols: number) {
    this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
  }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numCols; }
  getSheet() { return this.sheet; }
  getValues(): CellValue[][] {
    const out: CellValue[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowVals: CellValue[] = [];
      for (let c = 0; c < this.numCols; c++) rowVals.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(rowVals);
    }
    return out;
  }
  getValue(): CellValue { return this.sheet.cell(this.row, this.col); }
  setValue(v: CellValue) { this.sheet.setCell(this.row, this.col, v); return this; }
  setValues(vals: CellValue[][]) {
    vals.forEach((rowVals, r) => rowVals.forEach((v, c) => this.sheet.setCell(this.row + r, this.col + c, v)));
    return this;
  }
  setFormula(f: string) { this.sheet.setCell(this.row, this.col, f); return this; }
}

class FakeSheet {
  name: string; parent: FakeSpreadsheet; data = new Map<string, CellValue>(); maxRows = 1000; maxCols = 26;
  constructor(name: string, parent: FakeSpreadsheet) { this.name = name; this.parent = parent; }
  key(r: number, c: number) { return r + ':' + c; }
  cell(r: number, c: number): CellValue { const k = this.key(r, c); return this.data.has(k) ? this.data.get(k)! : ''; }
  setCell(r: number, c: number, v: CellValue) { this.data.set(this.key(r, c), v); }
  getName() { return this.name; }
  getParent() { return this.parent; }
  getLastColumn(): number {
    let max = 0;
    for (const k of this.data.keys()) { const c = Number(k.split(':')[1]); if (c > max) max = c; }
    return max;
  }
  getLastRow(): number {
    let max = 0;
    for (const k of this.data.keys()) { const r = Number(k.split(':')[0]); if (r > max) max = r; }
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after: number, count: number) { this.maxRows += count; }
  insertColumnsAfter(_after: number, count: number) { this.maxCols += count; }
  getRange(row: number, col: number, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
  appendRow(values: CellValue[]) {
    const row = this.getLastRow() + 1;
    values.forEach((v, i) => this.setCell(row, i + 1, v));
  }
  setHeaders(headers: string[]) { headers.forEach((h, i) => this.setCell(1, i + 1, h)); }
}

class FakeSpreadsheet {
  name: string; sheets = new Map<string, FakeSheet>();
  constructor(name: string) { this.name = name; }
  getName() { return this.name; }
  getSheetByName(name: string): FakeSheet | null { return this.sheets.has(name) ? this.sheets.get(name)! : null; }
  getSheets(): FakeSheet[] { return [...this.sheets.values()]; }
  insertSheet(name: string): FakeSheet { const s = new FakeSheet(name, this); this.sheets.set(name, s); return s; }
  sheet(name: string): FakeSheet { return this.sheets.has(name) ? this.sheets.get(name)! : this.insertSheet(name); }
}

type Club = { id: string; label: string; workbookId: string };
type Cols = { FIRST: number; LAST_NAME: number; CLUB: number; REGISTERED: number; STATUS: number; E1: number; E2: number; E3: number; E4: number; TOTAL: number; HIDE: number; REG_ID: number; EMAIL: number };
type Registration = Record<string, string | number | undefined>;

// The shape of the live .gs source once loaded into the vm sandbox --
// narrowed to just what the tests below actually call.
type RegistrationSyncApi = {
  HEADER_ORDER: string[];
  MASTER_SHEET: string;
  CLUB_DATA_SHEET: string;
  FAILED_WEBHOOKS_SHEET: string;
  resolveColumns_(sheet: FakeSheet): Cols;
  assertCanonicalColumnOrder_(sheet: FakeSheet): Cols;
  getClubById_(id: string): Club | null;
  ensureMasterSheet_(): FakeSheet;
  mapTitoPayloadToRegistration_(payload: Record<string, unknown>, webhookEvent: string): Registration;
  addRegistration(registration: Registration): { registration_id: string; club: string; master_row: number; club_row: number };
  syncFromClubsNow_(): void;
  syncFromClubsNow(): void;
  installSyncTrigger(): void;
  pauseSyncTrigger(): void;
  verifySystem(): void;
  doPost(e: { parameter?: Record<string, string>; postData?: { contents: string } }): { getContent(): string };
};

// Loads the live registration-sync .gs source into a fresh sandboxed Apps
// Script environment. Every call gets fully isolated fake Sheets state, so
// tests never leak into each other.
export function loadRegistrationSync() {
  const admin = new FakeSpreadsheet('ADMIN - Speed Shuffle Score Tracker');
  const clubSpreadsheetsById = new Map<string, FakeSpreadsheet>();
  const mail: { to: string; subject: string; body: string }[] = [];
  const properties = new Map<string, string>();
  const logs: string[] = [];
  const triggers: { getHandlerFunction(): string }[] = [];
  const source = FILES.map((f) => fs.readFileSync(path.join(SCRIPT_DIR, f), 'utf8')).join('\n;\n');

  const sandbox: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => admin,
      openById: (id: string) => {
        if (!clubSpreadsheetsById.has(id)) clubSpreadsheetsById.set(id, new FakeSpreadsheet(id));
        return clubSpreadsheetsById.get(id)!;
      },
      flush: () => {},
      getUi: () => { throw new Error('no UI in tests'); },
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (properties.has(k) ? properties.get(k) : null),
        setProperty: (k: string, v: string) => { properties.set(k, v); },
        deleteProperty: (k: string) => { properties.delete(k); },
      }),
    },
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text: string) => ({
        content: text,
        setMimeType() { return this; },
        getContent() { return this.content; },
      }),
    },
    MailApp: { sendEmail: (to: string, subject: string, body: string) => { mail.push({ to, subject, body }); } },
    Logger: { log: (msg: unknown) => { logs.push(String(msg)); } },
    console: {
      log: (msg: unknown) => { logs.push(String(msg)); },
      error: (msg: unknown) => { logs.push(String(msg)); },
      warn: (msg: unknown) => { logs.push(String(msg)); },
      info: (msg: unknown) => { logs.push(String(msg)); },
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      newTrigger: (handlerFunction: string) => ({
        timeBased() { return this; },
        everyMinutes() { return this; },
        create() {
          const trigger = { getHandlerFunction: () => handlerFunction };
          triggers.push(trigger);
          return trigger;
        },
      }),
      deleteTrigger: (trigger: { getHandlerFunction(): string }) => {
        const i = triggers.indexOf(trigger);
        if (i !== -1) triggers.splice(i, 1);
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'registration-sync.gs' });

  const fns = sandbox as unknown as RegistrationSyncApi;

  const seedMaster = (headers?: string[]): FakeSheet => {
    const sheet = admin.sheet(fns.MASTER_SHEET);
    sheet.setHeaders(headers ?? fns.HEADER_ORDER);
    return sheet;
  };

  const seedClub = (clubId: string, headers?: string[]): FakeSheet => {
    const club = fns.getClubById_(clubId)!;
    const ss = (sandbox.SpreadsheetApp as { openById(id: string): FakeSpreadsheet }).openById(club.workbookId);
    const sheet = ss.sheet(fns.CLUB_DATA_SHEET);
    sheet.setHeaders(headers ?? fns.HEADER_ORDER);
    return sheet;
  };

  const clubSheet = (clubId: string): FakeSheet => {
    const club = fns.getClubById_(clubId)!;
    return (sandbox.SpreadsheetApp as { openById(id: string): FakeSpreadsheet }).openById(club.workbookId).getSheetByName(fns.CLUB_DATA_SHEET)!;
  };

  const failedWebhooks = (): FakeSheet | null => admin.getSheetByName(fns.FAILED_WEBHOOKS_SHEET);

  return { fns, admin, mail, properties, logs, triggers, seedMaster, seedClub, clubSheet, failedWebhooks };
}
