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

/*
 * getRange().getValues() returns a native JS Date object for any cell
 * Sheets recognizes as a date or time -- not the plain-text string the
 * public site's parser (netlify/lib/sessions.ts) requires -- regardless
 * of what the club typed or what the column's number format claims.
 * Formatting these explicitly (rather than a bare String(value)) is
 * what keeps a Date object from landing in MASTER as
 * "Wed Oct 07 2026 00:00:00 GMT..." instead of "2026-10-07", or as a
 * real date/time cell (instead of "18:00") for start/end times.
 * Already-plain-text cells pass through String(...) unchanged.
 *
 * The timeZone must be the time zone of the SPREADSHEET the Date came
 * from (its own File > Settings time zone), not Session.getScriptTimeZone().
 * Each club keeps its own workbook (Config.gs, CLUBS), so a cell read via
 * SpreadsheetApp.openById(club.workbookId) was converted from its serial
 * value into a Date using that workbook's own time zone -- reformatting
 * it with the ADMIN-bound script's time zone instead silently shifts the
 * clock time whenever a club's workbook time zone doesn't happen to match
 * the script project's. Always pass sheet.getParent().getSpreadsheetTimeZone()
 * for the sheet the value was actually read from.
 */
function formatSessionDateCell_(value, timeZone) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      timeZone,
      'yyyy-MM-dd'
    );
  }

  return String(value || '').trim();
}


function formatSessionTimeCell_(value, timeZone) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      timeZone,
      'HH:mm'
    );
  }

  return String(value || '').trim();
}


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

    /*
     * The club's own workbook (Config.gs, CLUBS) has its own File >
     * Settings time zone, independent of the ADMIN-bound script's --
     * see the comment above formatSessionDateCell_/formatSessionTimeCell_
     * for why that's the one that has to be used to format a Date read
     * from this sheet.
     */
    var clubTimeZone =
      sheet.getParent().getSpreadsheetTimeZone();

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
        formatSessionDateCell_(
          row[cols.DATE - 1],
          clubTimeZone
        );
      var start =
        formatSessionTimeCell_(
          row[cols.START - 1],
          clubTimeZone
        );
      var end =
        formatSessionTimeCell_(
          row[cols.END - 1],
          clubTimeZone
        );

      /*
       * A club filling in a date before its start/end time (a normal,
       * in-progress editing state, not an error) must not reach MASTER
       * half-finished -- the public site's parser rejects the *entire*
       * feed on any one malformed row (netlify/lib/sessions.ts), so one
       * club's incomplete row would take down every club's sessions
       * list. Same isolation principle as the header-drift skip above,
       * just for a single row instead of a whole club.
       */
      if (!date || !start || !end) {
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
        start: start,
        end: end,
        note: String(row[cols.NOTE - 1] || '').trim()
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
    /*
     * setValues() re-parses a plain string the same way typing it into
     * the UI would -- "2026-10-01" or "18:00" gets silently converted
     * into a real Date/time-of-day cell whenever the target column's
     * number format is left on "Automatic" (true for a freshly
     * auto-created tab). The public site reads this range with
     * valueRenderOption: UNFORMATTED_VALUE (netlify/lib/sheets.ts),
     * which returns the raw serial number for a cell like that instead
     * of the string -- failing every format check even though the
     * sheet displays a perfectly normal-looking date/time. Forcing
     * Plain Text on these columns before writing keeps the values
     * exactly as written, and self-heals any already-converted cell
     * the moment this (fully-rebuilding) sync next runs.
     */
    master
      .getRange(2, masterCols.DATE, combined.length, 1)
      .setNumberFormat('@');
    master
      .getRange(2, masterCols.START, combined.length, 1)
      .setNumberFormat('@');
    master
      .getRange(2, masterCols.END, combined.length, 1)
      .setNumberFormat('@');

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
