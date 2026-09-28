/**
 * Speed Shuffle — Score Tracking System
 * Bound to: ADMIN - Speed Shuffle Score Tracker
 *
 * CANONICAL COLUMN ORDER (what "Prepare / Repair All Sheets" lays down
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
 * silently landing in the wrong column. "Prepare / Repair All Sheets"
 * is stricter: it requires the canonical A:L order exactly, and stops
 * with an alert rather than reformatting a sheet that's out of order.
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


/* =========================================================
   MENU / GENERAL HELPERS
   ========================================================= */

function onOpen() {
  SpreadsheetApp
    .getUi()
    .createMenu(SS_MENU)
    .addItem(
      'Sync From Clubs Now',
      'syncFromClubsNow'
    )
    .addItem(
      'Prepare / Repair All Sheets',
      'prepareAllSheets'
    )
    .addItem(
      'Install 1-Minute Sync Trigger',
      'installOneMinuteSyncTrigger'
    )
    .addItem(
      'Normalize Master Public Display',
      'normalizeMasterPublicDisplay'
    )
    .addToUi();
}


function safeAlert_(message) {
  try {
    SpreadsheetApp
      .getUi()
      .alert(String(message));
  } catch (err) {
    Logger.log(String(message));
  }
}


function ensureMasterSheet_() {
  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var master =
    ss.getSheetByName(MASTER_SHEET);

  if (!master) {
    throw new Error(
      'MASTER sheet not found in ADMIN workbook.'
    );
  }

  return master;
}


function getClubById_(clubId) {
  for (var i = 0; i < CLUBS.length; i++) {
    if (CLUBS[i].id === clubId) {
      return CLUBS[i];
    }
  }

  return null;
}


function ensureClubPlayersSheet_(clubId) {
  var club =
    getClubById_(clubId);

  if (!club) {
    throw new Error(
      'Unknown club ID: ' + clubId
    );
  }

  var clubSs =
    SpreadsheetApp.openById(
      club.workbookId
    );

  var players =
    clubSs.getSheetByName(
      CLUB_DATA_SHEET
    ) ||
    clubSs.getSheets()[0];

  if (!players) {
    throw new Error(
      'Players sheet not found for club: ' +
      clubId
    );
  }

  return players;
}


/* =========================================================
   HEADER-NAME COLUMN RESOLUTION
   ========================================================= */

/*
 * Reads row 1 of `sheet` and returns { FIRST: n, LAST: n, ... } mapping
 * each HEADER_KEYS entry to the actual 1-based column number where its
 * HEADER_ORDER text currently lives — wherever that is, in whatever
 * order. Throws a descriptive Error if a required header is missing or
 * duplicated. This is the only thing in the script that knows where a
 * column "actually is"; nothing else should assume a fixed letter.
 */
function resolveColumns_(sheet) {
  var lastColumn =
    sheet.getLastColumn();

  if (lastColumn < HEADER_ORDER.length) {
    lastColumn = HEADER_ORDER.length;
  }

  var headerRow =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0];

  var location =
    '"' +
    sheet.getName() +
    '" (' +
    sheet.getParent().getName() +
    ')';

  var indexByName = {};

  headerRow.forEach(function(value, i) {
    var name =
      String(value || '').trim();

    if (!name) {
      return;
    }

    if (
      indexByName.hasOwnProperty(name)
    ) {
      throw new Error(
        'Sheet ' +
        location +
        ' has a duplicate header: "' +
        name +
        '".'
      );
    }

    indexByName[name] = i + 1;
  });

  var cols = {};
  var missing = [];

  HEADER_ORDER.forEach(function(name, i) {
    var key = HEADER_KEYS[i];

    if (
      indexByName.hasOwnProperty(name)
    ) {
      cols[key] = indexByName[name];
    } else {
      missing.push(name);
    }
  });

  if (missing.length) {
    throw new Error(
      'Sheet ' +
      location +
      ' is missing required header(s): ' +
      missing.join(', ') +
      '.'
    );
  }

  return cols;
}


/*
 * Like resolveColumns_(), but also requires the 12 headers to be in
 * the exact canonical A:L order. Only "Prepare / Repair All Sheets"
 * uses this — it's a repair tool, not a live data path, so it's
 * allowed to be stricter and simply refuse to touch a sheet whose
 * columns have already drifted, rather than guessing how to fix it.
 */
function assertCanonicalColumnOrder_(sheet) {
  var cols =
    resolveColumns_(sheet);

  var inOrder =
    HEADER_KEYS.every(function(key, i) {
      return cols[key] === i + 1;
    });

  if (!inOrder) {
    throw new Error(
      'Sheet "' +
      sheet.getName() +
      '" (' +
      sheet.getParent().getName() +
      ') has all required headers, but not in the canonical A:L order. ' +
      'Restore the original column order before repairing, or reorder ' +
      'the columns by hand — this tool will not do it automatically.'
    );
  }

  return cols;
}


/*
 * Writes the canonical header row on a sheet whose row 1 is entirely
 * blank (brand-new club/master sheet). Does nothing — and does not
 * overwrite anything — if row 1 already has content of any kind.
 */
function bootstrapCanonicalHeadersIfBlank_(sheet) {
  ensureMinimumColumns_(
    sheet,
    HEADER_ORDER.length
  );

  var firstRow =
    sheet
      .getRange(
        1,
        1,
        1,
        HEADER_ORDER.length
      )
      .getValues()[0];

  var isBlank =
    firstRow.every(function(value) {
      return (
        String(value || '').trim() === ''
      );
    });

  if (!isBlank) {
    return;
  }

  sheet
    .getRange(
      1,
      1,
      1,
      HEADER_ORDER.length
    )
    .setValues([
      HEADER_ORDER
    ]);
}


function columnToLetter_(column) {
  var letter = '';

  while (column > 0) {
    var remainder =
      (column - 1) % 26;

    letter =
      String.fromCharCode(
        65 + remainder
      ) + letter;

    column =
      Math.floor(
        (column - 1) / 26
      );
  }

  return letter;
}


/* =========================================================
   SHEET PREPARATION / REPAIR
   ========================================================= */

function prepareAllSheets() {
  try {
    var master =
      ensureMasterSheet_();

    preparePlayerSheet_(
      master,
      false
    );

    CLUBS.forEach(function(club) {
      var players =
        ensureClubPlayersSheet_(
          club.id
        );

      preparePlayerSheet_(
        players,
        true
      );
    });

    SpreadsheetApp.flush();

    safeAlert_(
      'Preparation complete.\n\n' +
      'E2:E1000 = status dropdown\n' +
      'F2:I1000 = score entry\n' +
      'J2:J1000 = formula\n' +
      'K2:K1000 = checkbox only\n' +
      'L = registration_id\n' +
      'M:U cleared'
    );
  } catch (err) {
    safeAlert_(
      'Preparation stopped: ' +
      (
        (err && err.message) ||
        err
      ) +
      '\n\nNothing further was modified. Fix the header issue ' +
      'named above and re-run.'
    );
  }
}


function preparePlayerSheet_(
  sheet,
  isClub
) {
  if (!sheet) {
    throw new Error(
      'Missing sheet.'
    );
  }

  bootstrapCanonicalHeadersIfBlank_(
    sheet
  );

  var cols =
    assertCanonicalColumnOrder_(
      sheet
    );

  ensureMinimumRows_(
    sheet,
    LAST_DATA_ROW
  );

  ensureMinimumColumns_(
    sheet,
    21
  );

  /*
   * Preserve existing public_display values before
   * rebuilding checkbox validation.
   */
  var kRange =
    sheet.getRange(
      2,
      cols.PUBLIC,
      DATA_ROWS,
      1
    );

  var oldK =
    kRange.getValues();

  /*
   * Clear accidental checkbox/data validation
   * from A:J.
   */
  var aToJ =
    sheet.getRange(
      2,
      1,
      DATA_ROWS,
      10
    );

  try {
    aToJ.removeCheckboxes();
  } catch (err) {}

  aToJ.clearDataValidations();

  /*
   * Rebuild K cleanly.
   */
  try {
    kRange.removeCheckboxes();
  } catch (err) {}

  kRange.clearDataValidations();

  /*
   * registration_id must never be a checkbox.
   */
  var lRange =
    sheet.getRange(
      2,
      cols.REG_ID,
      DATA_ROWS,
      1
    );

  try {
    lRange.removeCheckboxes();
  } catch (err) {}

  lRange.clearDataValidations();

  /*
   * M:U unused.
   */
  var mToU =
    sheet.getRange(
      1,
      13,
      sheet.getMaxRows(),
      9
    );

  try {
    mToU.removeCheckboxes();
  } catch (err) {}

  mToU.clearDataValidations();
  mToU.clearContent();
  mToU.clearFormat();

  /*
   * attempt_status = dropdown.
   */
  var statusRule =
    SpreadsheetApp
      .newDataValidation()
      .requireValueInList(
        STATUS_VALUES,
        true
      )
      .setAllowInvalid(false)
      .build();

  sheet
    .getRange(
      2,
      cols.STATUS,
      DATA_ROWS,
      1
    )
    .setDataValidation(
      statusRule
    );

  /*
   * end_1..end_4 = numeric scores.
   */
  var scoreRule =
    SpreadsheetApp
      .newDataValidation()
      .requireNumberGreaterThanOrEqualTo(0)
      .setAllowInvalid(false)
      .build();

  sheet
    .getRange(
      2,
      cols.E1,
      DATA_ROWS,
      4
    )
    .setDataValidation(
      scoreRule
    );

  /*
   * total_score. Canonical order is asserted above, so end_1..end_4
   * are guaranteed contiguous immediately left of this column.
   */
  sheet
    .getRange(
      2,
      cols.TOTAL,
      DATA_ROWS,
      1
    )
    .setFormulaR1C1(
      '=IF(COUNTA(RC[-4]:RC[-1])=0,"",SUM(RC[-4]:RC[-1]))'
    );

  /*
   * public_display = only checkbox column.
   */
  kRange.insertCheckboxes();

  var newK =
    oldK.map(function(row) {
      var value = row[0];

      if (
        value === true ||
        value === 'TRUE' ||
        value === 'true'
      ) {
        return [true];
      }

      if (
        value === false ||
        value === 'FALSE' ||
        value === 'false'
      ) {
        return [false];
      }

      /*
       * Blank/new rows default hidden.
       */
      return [false];
    });

  kRange.setValues(newK);

  applyProtections_(
    sheet,
    isClub,
    cols
  );
}


function ensureMinimumRows_(
  sheet,
  lastRow
) {
  var currentRows =
    sheet.getMaxRows();

  if (currentRows < lastRow) {
    sheet.insertRowsAfter(
      currentRows,
      lastRow - currentRows
    );
  }
}


function ensureMinimumColumns_(
  sheet,
  columnCount
) {
  var currentCols =
    sheet.getMaxColumns();

  if (currentCols < columnCount) {
    sheet.insertColumnsAfter(
      currentCols,
      columnCount - currentCols
    );
  }
}


function applyProtections_(
  sheet,
  isClub,
  cols
) {
  /*
   * Remove existing range protections on
   * this sheet, then rebuild canonical ones.
   */
  sheet
    .getProtections(
      SpreadsheetApp
        .ProtectionType
        .RANGE
    )
    .forEach(function(protection) {
      try {
        protection.remove();
      } catch (err) {}
    });

  protectRange_(
    sheet.getRange(
      1,
      1,
      1,
      HEADER_ORDER.length
    ),
    'Header A:L'
  );

  protectRange_(
    sheet.getRange(
      2,
      cols.FIRST,
      DATA_ROWS,
      4
    ),
    'Identity A:D'
  );

  protectRange_(
    sheet.getRange(
      2,
      cols.TOTAL,
      DATA_ROWS,
      1
    ),
    'total_score J'
  );

  protectRange_(
    sheet.getRange(
      2,
      cols.REG_ID,
      DATA_ROWS,
      1
    ),
    'registration_id L'
  );

  /*
   * public_display is protected on club sheets only.
   * Master public_display stays editable for Lauren.
   */
  if (isClub) {
    protectRange_(
      sheet.getRange(
        2,
        cols.PUBLIC,
        DATA_ROWS,
        1
      ),
      'public_display K — Master controlled'
    );
  }
}


function protectRange_(
  range,
  description
) {
  var protection =
    range
      .protect()
      .setDescription(
        description
      )
      .setWarningOnly(false);

  var editors =
    protection.getEditors();

  if (editors.length) {
    protection.removeEditors(
      editors
    );
  }

  if (
    protection.canDomainEdit &&
    protection.canDomainEdit()
  ) {
    protection.setDomainEdit(
      false
    );
  }
}


/* =========================================================
   CLUB → MASTER SYNC
   ========================================================= */

function syncFromClubsNow() {
  var lock =
    LockService.getScriptLock();

  lock.waitLock(
    LOCK_WAIT_MS
  );

  try {
    syncFromClubsNow_();
  } catch (err) {
    logSystemError_(
      'club_sync',
      '',
      err
    );

    notifySystemFailure_(
      'club_sync',
      '',
      err
    );
  } finally {
    lock.releaseLock();
  }
}


function syncFromClubsNow_() {
  var master =
    ensureMasterSheet_();

  /*
   * If MASTER's own headers are broken, nothing below can work —
   * let this throw out to the caller, which logs/notifies once.
   */
  var masterCols =
    resolveColumns_(master);

  var masterLastRow =
    Math.max(
      master.getLastRow(),
      2
    );

  var masterIds =
    master
      .getRange(
        2,
        masterCols.REG_ID,
        masterLastRow - 1,
        1
      )
      .getValues();

  var masterRowById = {};

  masterIds.forEach(
    function(row, index) {
      var registrationId =
        String(
          row[0] || ''
        ).trim();

      if (registrationId) {
        masterRowById[
          registrationId
        ] = index + 2;
      }
    }
  );

  var updated = 0;
  var missing = [];
  var skippedClubs = [];

  CLUBS.forEach(function(club) {
    var players;
    var clubCols;

    /*
     * One club's broken headers should not take down the sync
     * for the other four — skip it, log it, keep going.
     */
    try {
      players =
        ensureClubPlayersSheet_(
          club.id
        );

      clubCols =
        resolveColumns_(
          players
        );
    } catch (err) {
      skippedClubs.push(
        club.label +
        ': ' +
        (
          (err && err.message) ||
          err
        )
      );

      logSystemError_(
        'club_sync:' + club.id,
        '',
        err
      );

      notifySystemFailure_(
        'club_sync:' + club.id,
        '',
        err
      );

      return;
    }

    var lastRow =
      Math.max(
        players.getLastRow(),
        2
      );

    if (lastRow < 2) {
      return;
    }

    var readWidth =
      Math.max(
        clubCols.STATUS,
        clubCols.E1,
        clubCols.E2,
        clubCols.E3,
        clubCols.E4,
        clubCols.REG_ID
      );

    var rows =
      players
        .getRange(
          2,
          1,
          lastRow - 1,
          readWidth
        )
        .getValues();

    rows.forEach(function(row) {
      var registrationId =
        String(
          row[clubCols.REG_ID - 1] || ''
        ).trim();

      if (!registrationId) {
        return;
      }

      var masterRow =
        masterRowById[
          registrationId
        ];

      if (!masterRow) {
        missing.push(
          club.id +
          ': ' +
          registrationId
        );

        return;
      }

      var incomingStatus =
        String(
          row[clubCols.STATUS - 1] || ''
        )
          .trim()
          .toLowerCase();

      var previousStatus =
        String(
          master
            .getRange(
              masterRow,
              masterCols.STATUS
            )
            .getValue() || ''
        )
          .trim()
          .toLowerCase();

      /*
       * Copy only attempt_status + the four end scores.
       * Each field is written to its own resolved column, since
       * the two sheets' column orders are not assumed to match.
       */
      master
        .getRange(
          masterRow,
          masterCols.STATUS
        )
        .setValue(
          row[clubCols.STATUS - 1]
        );

      master
        .getRange(
          masterRow,
          masterCols.E1
        )
        .setValue(
          row[clubCols.E1 - 1]
        );

      master
        .getRange(
          masterRow,
          masterCols.E2
        )
        .setValue(
          row[clubCols.E2 - 1]
        );

      master
        .getRange(
          masterRow,
          masterCols.E3
        )
        .setValue(
          row[clubCols.E3 - 1]
        );

      master
        .getRange(
          masterRow,
          masterCols.E4
        )
        .setValue(
          row[clubCols.E4 - 1]
        );

      /*
       * Auto-publish only on FIRST
       * transition into completed.
       *
       * If Lauren manually unchecks public_display
       * afterward, future syncs leave it alone.
       */
      if (
        previousStatus !== 'completed' &&
        incomingStatus === 'completed'
      ) {
        master
          .getRange(
            masterRow,
            masterCols.PUBLIC
          )
          .setValue(true);
      }

      updated++;
    });
  });

  SpreadsheetApp.flush();

  var message =
    'Club → Master sync complete. ' +
    'Updated rows: ' +
    updated;

  if (missing.length) {
    message +=
      '. Missing Master IDs: ' +
      missing.join(', ');
  }

  if (skippedClubs.length) {
    message +=
      '. Skipped clubs (header problem): ' +
      skippedClubs.join('; ');
  }

  Logger.log(message);
}


/* =========================================================
   AUTOMATIC 1-MINUTE TRIGGER
   ========================================================= */

function installOneMinuteSyncTrigger() {
  var handlerName =
    'syncFromClubsNow';

  ScriptApp
    .getProjectTriggers()
    .forEach(function(trigger) {
      var handler =
        trigger.getHandlerFunction();

      if (
        handler === handlerName ||
        handler === 'FIX_syncFromClubsNow' ||
        handler === 'syncFromClubs'
      ) {
        ScriptApp.deleteTrigger(
          trigger
        );
      }
    });

  ScriptApp
    .newTrigger(
      handlerName
    )
    .timeBased()
    .everyMinutes(1)
    .create();

  safeAlert_(
    'Automatic club → Master sync installed for every 1 minute.'
  );
}


/* =========================================================
   MASTER MANUAL EDIT BEHAVIOR
   ========================================================= */

function onEdit(e) {
  if (
    !e ||
    !e.range
  ) {
    return;
  }

  var sheet =
    e.range.getSheet();

  if (
    sheet.getName() !==
    MASTER_SHEET
  ) {
    return;
  }

  if (
    e.range.getRow() < 2 ||
    e.range.getNumRows() !== 1 ||
    e.range.getNumColumns() !== 1
  ) {
    return;
  }

  var cols;

  try {
    cols =
      resolveColumns_(sheet);
  } catch (err) {
    /*
     * Header problem: skip this convenience behavior quietly
     * rather than alert on every keystroke. The Tito/sync paths
     * are what actually surface a broken MASTER sheet.
     */
    return;
  }

  /*
   * Only status edits.
   */
  if (
    e.range.getColumn() !==
    cols.STATUS
  ) {
    return;
  }

  var status =
    String(
      e.value || ''
    )
      .trim()
      .toLowerCase();

  if (
    status === 'completed'
  ) {
    sheet
      .getRange(
        e.range.getRow(),
        cols.PUBLIC
      )
      .setValue(true);
  }
}


/* =========================================================
   REGISTRATION INGEST / TITO TARGET
   ========================================================= */

function addRegistration(
  registration
) {
  if (!registration) {
    throw new Error(
      'Registration payload is required.'
    );
  }

  var registrationId =
    String(
      registration.registration_id || ''
    ).trim();

  if (!registrationId) {
    throw new Error(
      'registration_id is required.'
    );
  }

  var clubId =
    String(
      registration.club || ''
    )
      .trim()
      .toLowerCase();

  var club =
    getClubById_(clubId);

  if (!club) {
    throw new Error(
      'Unknown club: ' +
      clubId
    );
  }

  /*
   * Shared with syncFromClubsNow() so a club sync mid-run
   * can't interleave with this write and corrupt a row.
   */
  var lock =
    LockService.getScriptLock();

  lock.waitLock(
    LOCK_WAIT_MS
  );

  try {
    var master =
      ensureMasterSheet_();

    var clubSheet =
      ensureClubPlayersSheet_(
        clubId
      );

    var fields =
      buildRegistrationFields_(
        registration,
        clubId
      );

    var masterRow =
      upsertRegistrationRow_(
        master,
        fields,
        true
      );

    var clubRow =
      upsertRegistrationRow_(
        clubSheet,
        fields,
        false
      );

    SpreadsheetApp.flush();

    return {
      registration_id:
        registrationId,
      club:
        clubId,
      master_row:
        masterRow,
      club_row:
        clubRow
    };
  } finally {
    lock.releaseLock();
  }
}


function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(
      JSON.stringify(obj)
    )
    .setMimeType(
      ContentService
        .MimeType
        .JSON
    );
}


function assertIngestToken_(e) {
  var expected =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        'REGISTRATION_INGEST_TOKEN'
      );

  var supplied =
    e &&
    e.parameter &&
    e.parameter.token
      ? String(e.parameter.token)
      : '';

  if (
    !expected ||
    supplied !== expected
  ) {
    throw new Error('Unauthorized');
  }
}


function resolveClubFromRelease_(
  releaseSlug,
  releaseTitle
) {
  var hay =
    (
      String(releaseSlug || '') +
      ' ' +
      String(releaseTitle || '')
    ).toLowerCase();

  for (
    var i = 0;
    i < CLUBS.length;
    i++
  ) {
    if (
      hay.indexOf(
        CLUBS[i].id
      ) !== -1
    ) {
      return CLUBS[i].id;
    }
  }

  if (
    hay.indexOf('new york') !== -1 ||
    hay.indexOf('brooklyn') !== -1
  ) {
    return 'brooklyn';
  }

  if (
    hay.indexOf('st. pete') !== -1 ||
    hay.indexOf('st pete') !== -1
  ) {
    return 'st-pete';
  }

  if (
    hay.indexOf('beach') !== -1
  ) {
    return 'beachside';
  }

  return '';
}


function splitName_(name) {
  var parts =
    String(name || '')
      .trim()
      .split(/\s+/)
      .filter(String);

  if (!parts.length) {
    return {
      first_name: 'Unknown',
      last_initial: ''
    };
  }

  if (parts.length === 1) {
    return {
      first_name: parts[0],
      last_initial: ''
    };
  }

  return {
    first_name: parts[0],
    last_initial:
      parts[
        parts.length - 1
      ].charAt(0)
  };
}


function ticketFromPayload_(payload) {
  if (
    !payload ||
    typeof payload !== 'object'
  ) {
    return null;
  }

  if (
    payload._type === 'ticket' ||
    payload.slug ||
    payload.release_slug
  ) {
    return payload;
  }

  if (
    payload.data &&
    payload.data.object
  ) {
    return payload.data.object;
  }

  if (payload.ticket) {
    return payload.ticket;
  }

  return null;
}


function mapTitoPayloadToRegistration_(
  payload,
  webhookEvent
) {
  if (
    payload.registration_id &&
    payload.club &&
    payload.first_name !== undefined
  ) {
    return payload;
  }

  var ticket =
    ticketFromPayload_(payload);

  if (!ticket) {
    return null;
  }

  var registrationId =
    String(
      ticket.slug || ''
    ).trim();

  if (!registrationId) {
    throw new Error(
      'Tito ticket payload is missing slug (registration_id).'
    );
  }

  var release =
    ticket.release || {};

  var releaseSlug =
    String(
      ticket.release_slug ||
      release.slug ||
      ''
    ).trim();

  var releaseTitle =
    String(
      ticket.release_title ||
      release.title ||
      ''
    ).trim();

  var clubId =
    resolveClubFromRelease_(
      releaseSlug,
      releaseTitle
    );

  if (!clubId) {
    throw new Error(
      'Could not map Tito release to club: ' +
      releaseSlug +
      ' / ' +
      releaseTitle
    );
  }

  var firstName =
    String(
      ticket.first_name || ''
    ).trim();

  var lastName =
    String(
      ticket.last_name || ''
    ).trim();

  var names =
    firstName
      ? {
          first_name: firstName,
          last_initial:
            lastName.charAt(0)
        }
      : splitName_(ticket.name);

  var state =
    String(
      ticket.state_name ||
      ticket.state ||
      ''
    ).toLowerCase();

  var voided =
    (
      webhookEvent &&
      /voided|cancelled/i.test(
        webhookEvent
      )
    ) ||
    state.indexOf('void') !== -1 ||
    state.indexOf('cancel') !== -1;

  var registeredAt =
    String(
      ticket.updated_at ||
      ticket.created_at ||
      ''
    ).slice(0, 10);

  return {
    registration_id:
      registrationId,
    first_name:
      names.first_name,
    last_initial:
      names.last_initial,
    club: clubId,
    registered_at:
      registeredAt || undefined,
    attempt_status:
      voided
        ? 'cancelled'
        : 'registered'
  };
}


/*
 * Apps Script Web Apps always answer HTTP 200, regardless of what
 * doPost returns — there is no way to make Tito's own webhook retry
 * trigger on failure. logSystemError_ / notifySystemFailure_ below
 * are the substitute: a durable, human-visible record of any
 * registration that failed to apply, so it can be replayed by hand.
 */
function doPost(e) {
  var contents =
    e &&
    e.postData &&
    e.postData.contents
      ? e.postData.contents
      : '{}';

  try {
    assertIngestToken_(e);
  } catch (authErr) {
    /*
     * Unauthorized requests are not logged/emailed: the public
     * webhook URL will draw scanner noise, and attacker-supplied
     * bodies shouldn't get written into a tournament sheet.
     */
    return jsonResponse_({
      ok: false,
      error: String(
        authErr.message ||
        authErr
      )
    });
  }

  try {
    var payload =
      JSON.parse(contents);

    var registration =
      mapTitoPayloadToRegistration_(
        payload,
        ''
      );

    if (!registration) {
      return jsonResponse_({
        ok: true,
        skipped: true
      });
    }

    var result =
      addRegistration(
        registration
      );

    return jsonResponse_({
      ok: true,
      result: result
    });

  } catch (err) {
    logSystemError_(
      'tito_ingest',
      contents,
      err
    );

    notifySystemFailure_(
      'tito_ingest',
      contents,
      err
    );

    return jsonResponse_({
      ok: false,
      error: String(
        err.message ||
        err
      )
    });
  }
}


function ensureSystemErrorSheet_() {
  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var sheet =
    ss.getSheetByName(
      SYSTEM_ERROR_SHEET
    );

  if (!sheet) {
    sheet =
      ss.insertSheet(
        SYSTEM_ERROR_SHEET
      );

    sheet
      .getRange(
        1,
        1,
        1,
        4
      )
      .setValues([[
        'timestamp',
        'source',
        'error',
        'payload'
      ]]);
  }

  return sheet;
}


function logSystemError_(
  source,
  rawContents,
  err
) {
  try {
    ensureSystemErrorSheet_()
      .appendRow([
        new Date(),
        source,
        String(
          (err && err.message) ||
          err
        ),
        String(
          rawContents || ''
        ).slice(0, 5000)
      ]);
  } catch (loggingErr) {
    Logger.log(
      'Failed to log system error: ' +
      loggingErr
    );
  }
}


/*
 * Optional: set the INGEST_ALERT_EMAIL script property to get a
 * mail notification per failure. Left unset, failures are still
 * recorded in the System Errors sheet — someone just has to go
 * look. Wrapped in its own try/catch so a mail-quota error can
 * never mask the original failure.
 */
function notifySystemFailure_(
  source,
  rawContents,
  err
) {
  try {
    var alertEmail =
      PropertiesService
        .getScriptProperties()
        .getProperty(
          'INGEST_ALERT_EMAIL'
        );

    if (!alertEmail) {
      return;
    }

    MailApp.sendEmail(
      alertEmail,
      'Speed Shuffle: ' +
      source +
      ' failed',
      'Error: ' +
      String(
        (err && err.message) ||
        err
      ) +
      (
        rawContents
          ? '\n\nPayload:\n' +
            String(
              rawContents
            ).slice(0, 5000)
          : ''
      )
    );
  } catch (mailErr) {
    Logger.log(
      'Failed to send failure email: ' +
      mailErr
    );
  }
}


function buildRegistrationFields_(
  registration,
  clubId
) {
  var status =
    String(
      registration.attempt_status ||
      'registered'
    )
      .trim()
      .toLowerCase();

  if (
    STATUS_VALUES.indexOf(
      status
    ) === -1
  ) {
    status = 'registered';
  }

  return {
    registration_id:
      String(
        registration.registration_id || ''
      ).trim(),

    first_name:
      String(
        registration.first_name || ''
      ).trim(),

    last_initial:
      String(
        registration.last_initial || ''
      ).trim(),

    club: clubId,

    registered_at:
      registration.registered_at ||
      Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      ),

    attempt_status: status,

    end_1_score:
      registration.end_1_score !== undefined
        ? registration.end_1_score
        : '',

    end_2_score:
      registration.end_2_score !== undefined
        ? registration.end_2_score
        : '',

    end_3_score:
      registration.end_3_score !== undefined
        ? registration.end_3_score
        : '',

    end_4_score:
      registration.end_4_score !== undefined
        ? registration.end_4_score
        : ''
  };
}


/*
 * Upserts one registration into `sheet` (either MASTER or a club
 * Players sheet), matched by registration_id. Every field is written
 * to its own resolved column — the two sheets involved in a single
 * addRegistration() call are not assumed to share a column order.
 */
function upsertRegistrationRow_(
  sheet,
  fields,
  isMaster
) {
  var registrationId =
    fields.registration_id;

  if (!registrationId) {
    throw new Error(
      'Cannot write registration without registration_id.'
    );
  }

  var cols =
    resolveColumns_(sheet);

  var existingRow =
    findRegistrationRow_(
      sheet,
      cols,
      registrationId
    );

  var targetRow =
    existingRow ||
    findFirstEmptyRegistrationRow_(
      sheet,
      cols
    );

  /*
   * Preserve public_display if this is an existing
   * Master registration.
   *
   * New registrations default false.
   */
  var publicValue = false;

  if (
    isMaster &&
    existingRow
  ) {
    publicValue =
      sheet
        .getRange(
          existingRow,
          cols.PUBLIC
        )
        .getValue() === true;
  }

  sheet
    .getRange(
      targetRow,
      cols.FIRST
    )
    .setValue(
      fields.first_name
    );

  sheet
    .getRange(
      targetRow,
      cols.LAST
    )
    .setValue(
      fields.last_initial
    );

  sheet
    .getRange(
      targetRow,
      cols.CLUB
    )
    .setValue(
      fields.club
    );

  sheet
    .getRange(
      targetRow,
      cols.REGISTERED
    )
    .setValue(
      fields.registered_at
    );

  sheet
    .getRange(
      targetRow,
      cols.STATUS
    )
    .setValue(
      fields.attempt_status
    );

  sheet
    .getRange(
      targetRow,
      cols.E1
    )
    .setValue(
      fields.end_1_score
    );

  sheet
    .getRange(
      targetRow,
      cols.E2
    )
    .setValue(
      fields.end_2_score
    );

  sheet
    .getRange(
      targetRow,
      cols.E3
    )
    .setValue(
      fields.end_3_score
    );

  sheet
    .getRange(
      targetRow,
      cols.E4
    )
    .setValue(
      fields.end_4_score
    );

  /*
   * total_score formula, built from explicit cell references
   * rather than a colon range — end_1..end_4 are not assumed to
   * be contiguous on a sheet whose columns have been reordered.
   */
  var endRefs = [
    columnToLetter_(cols.E1) + targetRow,
    columnToLetter_(cols.E2) + targetRow,
    columnToLetter_(cols.E3) + targetRow,
    columnToLetter_(cols.E4) + targetRow
  ].join(',');

  sheet
    .getRange(
      targetRow,
      cols.TOTAL
    )
    .setFormula(
      '=IF(COUNTA(' +
      endRefs +
      ')=0,"",SUM(' +
      endRefs +
      '))'
    );

  sheet
    .getRange(
      targetRow,
      cols.PUBLIC
    )
    .setValue(
      publicValue
    );

  sheet
    .getRange(
      targetRow,
      cols.REG_ID
    )
    .setValue(
      registrationId
    );

  return targetRow;
}


function findRegistrationRow_(
  sheet,
  cols,
  registrationId
) {
  var lastRow =
    Math.max(
      sheet.getLastRow(),
      2
    );

  var numRows =
    lastRow - 1;

  if (
    numRows <= 0
  ) {
    return null;
  }

  var ids =
    sheet
      .getRange(
        2,
        cols.REG_ID,
        numRows,
        1
      )
      .getValues();

  for (
    var i = 0;
    i < ids.length;
    i++
  ) {
    if (
      String(
        ids[i][0] || ''
      ).trim() ===
      registrationId
    ) {
      return i + 2;
    }
  }

  return null;
}


function findFirstEmptyRegistrationRow_(
  sheet,
  cols
) {
  ensureMinimumRows_(
    sheet,
    LAST_DATA_ROW
  );

  var ids =
    sheet
      .getRange(
        2,
        cols.REG_ID,
        DATA_ROWS,
        1
      )
      .getValues();

  for (
    var i = 0;
    i < ids.length;
    i++
  ) {
    if (
      !String(
        ids[i][0] || ''
      ).trim()
    ) {
      return i + 2;
    }
  }

  throw new Error(
    'No empty registration rows remain through row ' +
    LAST_DATA_ROW +
    '.'
  );
}


/* =========================================================
   ONE-TIME MASTER PUBLIC DISPLAY NORMALIZATION
   ========================================================= */

/*
 * Use this ONLY as a one-time migration.
 *
 * It sets:
 * completed → checked
 * registered/cancelled/blank → unchecked
 *
 * Do NOT keep rerunning this once Lauren begins
 * manually hiding completed players.
 */
function normalizeMasterPublicDisplay() {
  try {
    var master =
      ensureMasterSheet_();

    var cols =
      resolveColumns_(master);

    var statuses =
      master
        .getRange(
          2,
          cols.STATUS,
          DATA_ROWS,
          1
        )
        .getValues();

    var registrationIds =
      master
        .getRange(
          2,
          cols.REG_ID,
          DATA_ROWS,
          1
        )
        .getValues();

    var publicValues = [];

    for (
      var i = 0;
      i < DATA_ROWS;
      i++
    ) {
      var status =
        String(
          statuses[i][0] || ''
        )
          .trim()
          .toLowerCase();

      var registrationId =
        String(
          registrationIds[i][0] || ''
        ).trim();

      if (!registrationId) {
        publicValues.push([
          false
        ]);

        continue;
      }

      publicValues.push([
        status === 'completed'
      ]);
    }

    master
      .getRange(
        2,
        cols.PUBLIC,
        DATA_ROWS,
        1
      )
      .setValues(
        publicValues
      );

    SpreadsheetApp.flush();

    safeAlert_(
      'Master public_display normalized.\n\n' +
      'Completed = checked\n' +
      'Registered/cancelled/blank = unchecked'
    );
  } catch (err) {
    safeAlert_(
      'Normalization stopped: ' +
      (
        (err && err.message) ||
        err
      )
    );
  }
}


/* =========================================================
   TEST HELPERS
   ========================================================= */

/*
 * Safe test of registration ingest.
 *
 * Run once:
 * - adds Jack to Master
 * - adds Jack to Brooklyn
 * - public_display is unchecked
 *
 * Run a second time:
 * - should update same rows
 * - should NOT duplicate Jack
 */
function TEST_addBrooklynRegistration() {
  var result =
    addRegistration({
      registration_id:
        'test-ny-003',
      first_name:
        'Jack',
      last_initial:
        'B',
      club:
        'brooklyn',
      registered_at:
        '2026-09-15',
      attempt_status:
        'registered'
    });

  safeAlert_(
    'Brooklyn test registration complete.\n\n' +
    'Master row: ' +
    result.master_row +
    '\n' +
    'Club row: ' +
    result.club_row
  );
}


/*
 * Exercises Tito ticket JSON → mapTitoPayloadToRegistration_ → addRegistration.
 * Change registration_id / slug before re-running to avoid overwriting the same row.
 */
function TEST_titoBrooklynTicket() {
  var payload = {
    _type: 'ticket',
    slug: 'test-tito-brooklyn-001',
    first_name: 'Tito',
    last_name: 'Test',
    release_slug: 'brooklyn',
    release_title: 'Brooklyn Club',
    updated_at: '2026-09-23T12:00:00.000Z'
  };

  var registration =
    mapTitoPayloadToRegistration_(
      payload,
      'ticket.created'
    );

  var result =
    addRegistration(registration);

  safeAlert_(
    'Tito mapper test complete.\n\n' +
    JSON.stringify(registration, null, 2) +
    '\n\nMaster row: ' +
    result.master_row +
    '\nClub row: ' +
    result.club_row
  );
}


/*
 * Diagnostic only.
 * Does not change data.
 */
function verifySystem() {
  var problems = [];
  var ok = [];

  var master =
    ensureMasterSheet_();

  try {
    resolveColumns_(master);
    ok.push(
      'MASTER headers OK'
    );
  } catch (err) {
    problems.push(
      (err && err.message) ||
      String(err)
    );
  }

  CLUBS.forEach(function(club) {
    try {
      var players =
        ensureClubPlayersSheet_(
          club.id
        );

      resolveColumns_(
        players
      );

      ok.push(
        club.label +
        ' headers OK'
      );
    } catch (err) {
      problems.push(
        club.label +
        ': ' +
        (
          (err && err.message) ||
          err
        )
      );
    }
  });

  var syncTriggers =
    ScriptApp
      .getProjectTriggers()
      .filter(function(trigger) {
        return (
          trigger
            .getHandlerFunction() ===
          'syncFromClubsNow'
        );
      });

  if (
    syncTriggers.length === 1
  ) {
    ok.push(
      'Exactly one sync trigger installed'
    );
  } else {
    problems.push(
      'Expected exactly one syncFromClubsNow trigger; found ' +
      syncTriggers.length
    );
  }

  safeAlert_(
    'System verification\n\n' +
    'OK:\n• ' +
    (
      ok.length
        ? ok.join('\n• ')
        : '(none)'
    ) +
    '\n\nProblems:\n• ' +
    (
      problems.length
        ? problems.join('\n• ')
        : '(none)'
    )
  );
}

function TEST_addStPeteRegistration() {
  var result =
    addRegistration({
      registration_id:
        'test-sp-003',
      first_name:
        'Sunny',
      last_initial:
        'R',
      club:
        'st-pete',
      registered_at:
        '2026-09-15',
      attempt_status:
        'registered'
    });

  safeAlert_(
    'St. Pete test registration complete.\n\n' +
    'Master row: ' +
    result.master_row +
    '\n' +
    'Club row: ' +
    result.club_row
  );
}

function FIX_uncheckAllClubPublicDisplay() {
  var updated = [];
  var problems = [];

  CLUBS.forEach(function(club) {
    try {
      var players =
        ensureClubPlayersSheet_(club.id);

      var cols =
        resolveColumns_(players);

      /*
       * Keep checkbox validation in place,
       * just set every club checkbox to FALSE.
       */
      players
        .getRange(
          2,
          cols.PUBLIC,
          DATA_ROWS,
          1
        )
        .setValue(false);

      updated.push(club.label);
    } catch (err) {
      problems.push(
        club.label +
        ': ' +
        (
          (err && err.message) ||
          err
        )
      );
    }
  });

  SpreadsheetApp.flush();

  safeAlert_(
    'Club public_display boxes cleared.\n\n' +
    updated.join('\n') +
    (
      problems.length
        ? '\n\nProblems:\n' +
          problems.join('\n')
        : ''
    ) +
    '\n\nADMIN Master was not changed.'
  );
}
