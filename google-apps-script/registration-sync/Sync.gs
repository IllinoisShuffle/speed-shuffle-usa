/**
 * Club -> Master sync, plus the 10-minute time trigger that runs it
 * automatically. Copies attempt_status + the four end scores from
 * each club sheet to the matching MASTER row, matched by
 * registration_id. Never creates rows, and never touches
 * hide_publicly in either direction — that column is entirely
 * Lauren's manual opt-out tool on MASTER; a completed registrant
 * becomes publicly visible the moment attempt_status flips to
 * completed, purely via the public site's own query (see
 * netlify/lib/standings.ts), with no action needed here. Shares
 * LockService.getScriptLock() with addRegistration() in Ingest.gs so a
 * Tito webhook landing mid-sync can't interleave and corrupt a row.
 *
 * MASTER reads/writes are batched per club, one call per sync-owned
 * column (STATUS, E1-E4), instead of one getValue/setValue pair per
 * matched row. Each column is read fresh right before a club's rows
 * are applied to it and written back in full immediately after — so a
 * club's update is durably committed before the next club runs (one
 * club's broken data can't roll back an already-applied club) — while
 * turning what used to be several round trips per matched registrant
 * into a flat 10 round trips per club, regardless of registrant count.
 */


/* =========================================================
   CLUB → MASTER SYNC
   ========================================================= */

function syncFromClubsNow() {
  if (
    PropertiesService
      .getScriptProperties()
      .getProperty(
        SYNC_PAUSED_PROPERTY
      ) === 'true'
  ) {
    return;
  }

  var lock =
    LockService.getScriptLock();

  try {
    lock.waitLock(
      LOCK_WAIT_MS
    );

    syncFromClubsNow_();
  } catch (err) {
    logSystemError_(
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

  var masterRowCount =
    masterLastRow - 1;

  var masterIds =
    master
      .getRange(
        2,
        masterCols.REG_ID,
        masterRowCount,
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

    /*
     * One bulk snapshot per sync-owned MASTER column, read fresh right
     * before this club's rows are applied — so it reflects whatever
     * an earlier club in this same run already wrote. Each column is
     * read/written on its own resolved index, never assuming STATUS
     * through E4 are contiguous.
     */
    var masterStatus =
      master
        .getRange(
          2,
          masterCols.STATUS,
          masterRowCount,
          1
        )
        .getValues();

    var masterE1 =
      master
        .getRange(
          2,
          masterCols.E1,
          masterRowCount,
          1
        )
        .getValues();

    var masterE2 =
      master
        .getRange(
          2,
          masterCols.E2,
          masterRowCount,
          1
        )
        .getValues();

    var masterE3 =
      master
        .getRange(
          2,
          masterCols.E3,
          masterRowCount,
          1
        )
        .getValues();

    var masterE4 =
      master
        .getRange(
          2,
          masterCols.E4,
          masterRowCount,
          1
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

      var i =
        masterRow - 2;

      /*
       * Copy only attempt_status + the four end scores, into the
       * in-memory column snapshots — written back to the sheet once,
       * after every row in this club has been applied. hide_publicly
       * is never touched here; see the file header comment.
       */
      masterStatus[i][0] =
        row[clubCols.STATUS - 1];

      masterE1[i][0] =
        row[clubCols.E1 - 1];

      masterE2[i][0] =
        row[clubCols.E2 - 1];

      masterE3[i][0] =
        row[clubCols.E3 - 1];

      masterE4[i][0] =
        row[clubCols.E4 - 1];

      updated++;
    });

    master
      .getRange(
        2,
        masterCols.STATUS,
        masterRowCount,
        1
      )
      .setValues(masterStatus);

    master
      .getRange(
        2,
        masterCols.E1,
        masterRowCount,
        1
      )
      .setValues(masterE1);

    master
      .getRange(
        2,
        masterCols.E2,
        masterRowCount,
        1
      )
      .setValues(masterE2);

    master
      .getRange(
        2,
        masterCols.E3,
        masterRowCount,
        1
      )
      .setValues(masterE3);

    master
      .getRange(
        2,
        masterCols.E4,
        masterRowCount,
        1
      )
      .setValues(masterE4);
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

    /*
     * A club-sheet registration_id with no matching MASTER row is
     * real data drift (typo, manual club-sheet entry, or a row
     * MASTER never got) — not a transient error, but silent
     * Logger.log-only visibility means nobody notices until someone
     * happens to read the execution transcript. Surface it the same
     * way every other sync/ingest problem is surfaced.
     */
    logSystemError_(
      'club_sync:unmatched_ids',
      '',
      new Error(
        'Club row(s) with no matching MASTER registration_id: ' +
        missing.join(', ')
      )
    );
  }

  if (skippedClubs.length) {
    message +=
      '. Skipped clubs (header problem): ' +
      skippedClubs.join('; ');
  }

  Logger.log(message);
}


/* =========================================================
   AUTOMATIC 10-MINUTE TRIGGER
   ========================================================= */

/*
 * Best-effort cleanup of old/renamed trigger handlers. Only ever finds
 * (and can only ever delete) triggers owned by the *currently executing
 * user's own account* -- ScriptApp.getProjectTriggers() cannot see
 * triggers another user installed, even with full edit access to this
 * project. installSyncTrigger()/pauseSyncTrigger() do not depend on
 * this finding anything; SYNC_PAUSED_PROPERTY (Config.gs) is what
 * actually gates syncFromClubsNow(), regardless of trigger ownership.
 */
function deleteOwnSyncTriggers_() {
  var removed = 0;

  ScriptApp
    .getProjectTriggers()
    .forEach(function(trigger) {
      var handler =
        trigger.getHandlerFunction();

      if (
        handler === 'syncFromClubsNow' ||
        handler === 'FIX_syncFromClubsNow' ||
        handler === 'syncFromClubs'
      ) {
        ScriptApp.deleteTrigger(
          trigger
        );

        removed++;
      }
    });

  return removed;
}


function installSyncTrigger() {
  deleteOwnSyncTriggers_();

  ScriptApp
    .newTrigger(
      'syncFromClubsNow'
    )
    .timeBased()
    .everyMinutes(10)
    .create();

  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      SYNC_PAUSED_PROPERTY
    );

  safeAlert_(
    'Automatic club → Master sync installed for every 10 minutes ' +
    '(and resumed, if it was paused).'
  );
}


/*
 * Pauses the club -> Master sync by setting SYNC_PAUSED_PROPERTY --
 * syncFromClubsNow() checks it first and returns immediately, before
 * even acquiring the lock. This works regardless of who originally
 * installed the trigger (see deleteOwnSyncTriggers_ above for why that
 * matters) -- e.g. to stop Cloud Logging (and the GCP alert) from
 * filling up with the same failure every run while a header/schema
 * mismatch is being fixed by hand. Does not touch MASTER/club sheet
 * data or the Tito webhook (a separate, deployment-pinned concern).
 *
 * Re-run "Install Automatic Sync (One-Time Setup)" from this same menu
 * to resume -- it clears this property in addition to reinstalling the
 * trigger, so it doubles as "resume."
 */
function pauseSyncTrigger() {
  PropertiesService
    .getScriptProperties()
    .setProperty(
      SYNC_PAUSED_PROPERTY,
      'true'
    );

  var removed =
    deleteOwnSyncTriggers_();

  safeAlert_(
    'Automatic club → Master sync paused -- it will no-op the next ' +
    'time it fires, even though the trigger itself may still be ' +
    'listed under "Triggers" (only the account that installed it can ' +
    'delete it there; this does not require that). ' +
    'Re-run "Install Automatic Sync" to resume.' +
    (
      removed
        ? ' (Also removed ' + removed + ' trigger(s) owned by your ' +
          'own account.)'
        : ''
    )
  );
}
