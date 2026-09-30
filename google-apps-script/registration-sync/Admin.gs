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
      'Sync Scores & Sessions From Clubs Now',
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


function ensureMasterSessionsSheet_() {
  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var sheet =
    ss.getSheetByName(
      SESSIONS_SHEET
    );

  if (!sheet) {
    throw new Error(
      'Sessions sheet not found in ADMIN workbook. Create a tab named "' +
      SESSIONS_SHEET +
      '" with headers: ' +
      SESSIONS_HEADER_ORDER.join(', ') +
      '.'
    );
  }

  return sheet;
}


/*
 * Each club's own Sessions tab lives in their own workbook, alongside
 * their Players tab — never a shared tab in the ADMIN workbook, for
 * the same reason club managers only ever get edit access to their
 * own workbook's Players tab (see Config.gs). Unlike
 * ensureClubPlayersSheet_(), there is no "first sheet" fallback: a
 * brand-new Sessions tab has no legacy name to fall back to, so a
 * missing one is always a clear, loud error naming exactly what to
 * create.
 */
function ensureClubSessionsSheet_(clubId) {
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

  var sheet =
    clubSs.getSheetByName(
      SESSIONS_SHEET
    );

  if (!sheet) {
    throw new Error(
      'Sessions sheet not found for club: ' +
      clubId +
      '. Create a tab named "' +
      SESSIONS_SHEET +
      '" with headers: ' +
      SESSIONS_HEADER_ORDER.join(', ') +
      '.'
    );
  }

  return sheet;
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
/*
 * Run this from the Apps Script code editor's Run button (select
 * verifySystem, click Run), not the Speed Shuffle menu -- it isn't on
 * that menu. Results go to console.log, visible both in this editor's
 * own execution transcript and in Cloud Logging (Stackdriver) for
 * later, rather than a SpreadsheetApp.getUi() alert: that alert used to
 * block until dismissed, and since it renders on the *Sheet's* tab --
 * not this editor's -- while running from here, it was easy to miss
 * entirely and let Apps Script kill the whole execution for exceeding
 * its 6-minute time budget while it sat waiting for a click nobody saw.
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
    console.log(
      'verifySystem: checking ' +
      club.label +
      '...'
    );

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
      'Exactly one sync trigger owned by your own account ' +
      '(ScriptApp.getProjectTriggers() cannot see triggers ' +
      'installed by a different account -- see Outstanding risks ' +
      'in the README)'
    );
  } else {
    problems.push(
      'Expected exactly one syncFromClubsNow trigger owned by your ' +
      'own account; found ' +
      syncTriggers.length
    );
  }

  console.log(
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
