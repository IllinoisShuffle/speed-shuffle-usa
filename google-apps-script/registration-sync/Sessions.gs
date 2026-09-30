/**
 * Club -> Master SESSIONS sync. Run as a second phase inside
 * syncFromClubsNow_() (Sync.gs), sharing its lock, 10-minute trigger,
 * and Pause/Install menu items — there is no separate schedule for
 * this. See the "SESSIONS SHEET" block in Config.gs for the schema
 * and the reason it's a separate per-club tab (never a shared tab in
 * the ADMIN workbook).
 *
 * Unlike the score sync, this has no registration_id-equivalent
 * identity to match rows on, so MASTER's Sessions tab isn't merged —
 * it's fully rebuilt from the current contents of all five club
 * Sessions tabs on every run. A row a club deletes from their own
 * sheet disappears from MASTER on the next sync; this is the correct
 * behavior for a schedule (there is nothing here worth preserving the
 * way a submitted score is).
 */


/* =========================================================
   CLUB → MASTER SESSIONS SYNC
   ========================================================= */

function syncSessionsFromClubs_() {
  // Auto-creates the tab (with headers) if it doesn't exist yet -- no
  // manual setup step.
  var master =
    ensureMasterSessionsSheet_();

  /*
   * A tab that already exists but has a missing/renamed/duplicated
   * required header is real data drift (not the auto-create case
   * above) — let this throw out to the caller (syncFromClubsNow_ in
   * Sync.gs), which logs it once under source: session_sync.
   */
  var masterCols =
    resolveColumnsFor_(
      master,
      SESSIONS_HEADER_ORDER,
      SESSIONS_HEADER_KEYS
    );

  var combined = [];
  var skippedClubs = [];

  CLUBS.forEach(function(club) {
    var sheet;
    var cols;

    /*
     * ensureClubSessionsSheet_ auto-creates a missing tab, so the only
     * way this throws is real data drift on a tab that already exists
     * (missing/renamed/duplicated required header). One club's broken
     * headers should not take down the sync for the other four — skip
     * it, log it, keep going. Same isolation as the score sync in
     * Sync.gs.
     */
    try {
      sheet =
        ensureClubSessionsSheet_(
          club.id
        );

      cols =
        resolveColumnsFor_(
          sheet,
          SESSIONS_HEADER_ORDER,
          SESSIONS_HEADER_KEYS
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
        'session_sync:' + club.id,
        '',
        err
      );

      return;
    }

    var lastRow =
      Math.max(
        sheet.getLastRow(),
        2
      );

    if (lastRow < 2) {
      return;
    }

    var readWidth =
      Math.max(
        cols.DATE,
        cols.START,
        cols.END,
        cols.NOTE
      );

    var rows =
      sheet
        .getRange(
          2,
          1,
          lastRow - 1,
          readWidth
        )
        .getValues();

    rows.forEach(function(row) {
      var date =
        String(
          row[cols.DATE - 1] || ''
        ).trim();

      if (!date) {
        return;
      }

      /*
       * The club id always comes from this club's own CLUBS config
       * entry, never from the sheet's own "club" cell — a club
       * editing its own Sessions tab has no way to write a row into
       * MASTER under a different club's name.
       */
      combined.push({
        club: club.id,
        date: date,
        start: row[cols.START - 1],
        end: row[cols.END - 1],
        note: row[cols.NOTE - 1]
      });
    });
  });

  var masterLastRow =
    Math.max(
      master.getLastRow(),
      2
    );

  var clearWidth =
    Math.max(
      master.getLastColumn(),
      SESSIONS_HEADER_ORDER.length
    );

  if (masterLastRow > 1) {
    master
      .getRange(
        2,
        1,
        masterLastRow - 1,
        clearWidth
      )
      .clearContent();
  }

  if (combined.length) {
    master
      .getRange(
        2,
        masterCols.CLUB,
        combined.length,
        1
      )
      .setValues(
        combined.map(function(s) { return [s.club]; })
      );

    master
      .getRange(
        2,
        masterCols.DATE,
        combined.length,
        1
      )
      .setValues(
        combined.map(function(s) { return [s.date]; })
      );

    master
      .getRange(
        2,
        masterCols.START,
        combined.length,
        1
      )
      .setValues(
        combined.map(function(s) { return [s.start]; })
      );

    master
      .getRange(
        2,
        masterCols.END,
        combined.length,
        1
      )
      .setValues(
        combined.map(function(s) { return [s.end]; })
      );

    master
      .getRange(
        2,
        masterCols.NOTE,
        combined.length,
        1
      )
      .setValues(
        combined.map(function(s) { return [s.note]; })
      );
  }

  if (skippedClubs.length) {
    Logger.log(
      'Session sync skipped clubs (header problem): ' +
      skippedClubs.join('; ')
    );
  }

  return {
    written: combined.length,
    skippedClubs: skippedClubs
  };
}
