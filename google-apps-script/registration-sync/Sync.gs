/**
 * Club -> Master sync, plus the 10-minute time trigger that runs it
 * automatically. Copies attempt_status + the four end scores from
 * each club sheet to the matching MASTER row, matched by
 * registration_id. Never creates rows and never copies
 * public_display from a club sheet. Shares LockService.getScriptLock()
 * with addRegistration() in Ingest.gs so a Tito webhook landing
 * mid-sync can't interleave and corrupt a row.
 *
 * MASTER reads/writes are batched per club, one call per sync-owned
 * column (STATUS, E1-E4, and PUBLIC), instead of one getValue/setValue
 * pair per matched row. Each column is read fresh right before a
 * club's rows are applied to it and written back in full immediately
 * after — so a club's update is durably committed before the next
 * club runs (matching the old row-by-row commit granularity: one
 * club's broken data can't roll back an already-applied club), while
 * turning what used to be ~6 round trips per matched registrant into
 * 10 round trips per club (STATUS/E1-E4 always; PUBLIC is read/written
 * only if this club actually has a first-time transition to completed
 * this run — it's never sourced from the club sheet, so there's
 * nothing to snapshot otherwise), regardless of registrant count.
 */


/* =========================================================
   CLUB → MASTER SYNC
   ========================================================= */

function syncFromClubsNow() {
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

    /*
     * One bulk snapshot per sync-owned MASTER column, read fresh right
     * before this club's rows are applied — so it reflects whatever
     * an earlier club in this same run already wrote. Each column is
     * read/written on its own resolved index, never assuming STATUS
     * through PUBLIC are contiguous.
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

    /*
     * public_display is never read from the club sheet and never
     * inspected for its current value — it's only ever force-set to
     * true on a first transition into completed. So unlike the five
     * columns above, there's nothing to snapshot until a transition
     * actually happens: read it lazily, on the first one found in
     * this club's rows, and only write it back if at least one did.
     */
    var masterPublic = null;

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

      var incomingStatus =
        String(
          row[clubCols.STATUS - 1] || ''
        )
          .trim()
          .toLowerCase();

      var previousStatus =
        String(
          masterStatus[i][0] || ''
        )
          .trim()
          .toLowerCase();

      /*
       * Copy only attempt_status + the four end scores, into the
       * in-memory column snapshots — written back to the sheet once,
       * after every row in this club has been applied.
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
        if (!masterPublic) {
          masterPublic =
            master
              .getRange(
                2,
                masterCols.PUBLIC,
                masterRowCount,
                1
              )
              .getValues();
        }

        masterPublic[i][0] = true;
      }

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

    if (masterPublic) {
      master
        .getRange(
          2,
          masterCols.PUBLIC,
          masterRowCount,
          1
        )
        .setValues(masterPublic);
    }
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

    notifySystemFailure_(
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

function installSyncTrigger() {
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
    .everyMinutes(10)
    .create();

  safeAlert_(
    'Automatic club → Master sync installed for every 10 minutes.'
  );
}
