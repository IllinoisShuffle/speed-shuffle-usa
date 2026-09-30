/**
 * console.error → Cloud Logging (the GCP alerting policy reads this,
 * every source) plus the "Failed Webhooks" sheet (tito_ingest only —
 * the one source that carries a payload worth replaying by hand).
 * Apps Script Web Apps always answer HTTP 200 to doPost regardless of
 * what the handler returns, so Tito can never detect an ingest
 * failure and retry it; the sheet row is the substitute, a durable
 * record of the failed ticket JSON so it can be noticed and replayed.
 * club_sync* failures (Sync.gs) never carried a payload here in the
 * first place, so they're Cloud Logging only — nothing lost by
 * skipping the sheet for them.
 */

function ensureFailedWebhooksSheet_() {
  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var sheet =
    ss.getSheetByName(
      FAILED_WEBHOOKS_SHEET
    );

  if (!sheet) {
    sheet =
      ss.insertSheet(
        FAILED_WEBHOOKS_SHEET
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
  // ingests now that this project is on a standard GCP project. Every
  // source goes here, so the tech team's GCP alert sees all of them.
  console.error(
    '[' +
    source +
    '] ' +
    String(
      (err && err.message) ||
      err
    )
  );

  // Only tito_ingest carries a payload worth preserving for a manual
  // replay -- club_sync* failures are config/data problems on the
  // sheet itself, not something you replay from a saved payload.
  if (source !== 'tito_ingest') {
    return;
  }

  try {
    ensureFailedWebhooksSheet_()
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
