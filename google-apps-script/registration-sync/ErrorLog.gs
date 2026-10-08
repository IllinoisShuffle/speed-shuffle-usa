/**
 * console.error → Cloud Logging (the GCP alerting policies read this,
 * every source; transient sync blips go out as console.warn instead —
 * see isTransientSyncError_) plus the "Failed Webhooks" sheet (tito_ingest only —
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
  // console.* (not Logger.log) is what Cloud Logging actually ingests
  // now that this project is on a standard GCP project. ERROR is what
  // the tech team's GCP alerts fire on; a transient sync hiccup goes
  // out as WARNING instead -- still in Cloud Logging, but no email,
  // since the next 10-minute sync run retries it anyway.
  var message =
    '[' +
    source +
    '] ' +
    String(
      (err && err.message) ||
      err
    );

  if (isTransientSyncError_(source, err)) {
    console.warn(message);
  } else {
    console.error(message);
  }

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


/*
 * Google-side blips (Drive/Sheets timeouts, the generic "server error
 * occurred", lock contention) that the recurring sync trigger recovers
 * from on its own next run. Never true for tito_ingest: a failed
 * webhook is a dropped registration, so it always stays ERROR.
 */
function isTransientSyncError_(
  source,
  err
) {
  if (source === 'tito_ingest') {
    return false;
  }

  var text =
    String(
      (err && err.message) ||
      err
    );

  return TRANSIENT_SYNC_ERROR_PATTERNS.some(
    function(pattern) {
      return pattern.test(text);
    }
  );
}
