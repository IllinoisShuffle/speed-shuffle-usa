/**
 * The "Speed Shuffle" custom menu, general sheet-lookup helpers used
 * across every file, and manual test/diagnostic helpers run from the
 * Apps Script editor.
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
      'installSyncTrigger'
    )
    .addItem(
      'Pause Automatic Sync',
      'pauseSyncTrigger'
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
   TEST HELPERS
   ========================================================= */

/*
 * Safe test of registration ingest.
 *
 * Run once:
 * - adds Jack to Master
 * - adds Jack to Brooklyn
 * - hide_publicly is unchecked (visible, once completed)
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
      last_name:
        'Brooks',
      club:
        'brooklyn',
      registered_at:
        '2026-09-15',
      attempt_status:
        'registered',
      email:
        'jack.brooks@example.com'
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
    email: 'tito.test@example.com',
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
      last_name:
        'Reyes',
      club:
        'st-pete',
      registered_at:
        '2026-09-15',
      attempt_status:
        'registered',
      email:
        'sunny.reyes@example.com'
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

function FIX_uncheckAllClubHidePublicly() {
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
          cols.HIDE,
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
    'Club hide_publicly boxes cleared.\n\n' +
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
