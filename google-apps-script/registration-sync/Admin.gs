/**
 * The "Speed Shuffle" custom menu, general sheet-lookup helpers used
 * across every file, MASTER's manual-edit convenience behavior, the
 * one-time public_display migration tool, and manual test/diagnostic
 * helpers run from the Apps Script editor.
 */


/* =========================================================
   MENU / GENERAL HELPERS
   ========================================================= */

function onOpen() {
  SpreadsheetApp
    .getUi()
    .createMenu(SS_MENU)
    .addItem(
      'Sync Scores From Clubs Now',
      'syncFromClubsNow'
    )
    .addItem(
      'Repair All Sheets (Formatting & Protections)',
      'prepareAllSheets'
    )
    .addItem(
      'Install Automatic Sync (One-Time Setup)',
      'installOneMinuteSyncTrigger'
    )
    .addItem(
      'Reset Public Display To Match Status (Overwrites Manual Changes)',
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
