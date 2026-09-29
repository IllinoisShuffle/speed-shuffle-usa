/**
 * Club -> Master sync, plus the 1-minute time trigger that runs it
 * automatically. Copies attempt_status + the four end scores from
 * each club sheet to the matching MASTER row, matched by
 * registration_id. Never creates rows and never copies
 * public_display from a club sheet. Shares LockService.getScriptLock()
 * with addRegistration() in Ingest.gs so a Tito webhook landing
 * mid-sync can't interleave and corrupt a row.
 */


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
