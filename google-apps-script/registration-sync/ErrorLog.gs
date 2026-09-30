/**
 * The "System Errors" sheet, plus a console.error that Cloud Logging
 * picks up for the GCP alerting policy. Apps Script Web Apps always
 * answer HTTP 200 to doPost regardless of what the handler returns,
 * so Tito can never detect an ingest failure and retry it.
 * logSystemError_ is the substitute: a durable, human-visible record
 * of any registration or sync attempt that failed, so it can be
 * noticed and replayed by hand. Used by both Ingest.gs (doPost) and
 * Sync.gs (syncFromClubsNow), sharing one sheet and distinguished by
 * the `source` column.
 */

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
  // console.error (not Logger.log) is what Cloud Logging actually
  // ingests now that this project is on a standard GCP project.
  console.error(
    '[' +
    source +
    '] ' +
    String(
      (err && err.message) ||
      err
    )
  );

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
