/**
 * The "System Errors" sheet + optional email alert. Apps Script Web
 * Apps always answer HTTP 200 to doPost regardless of what the
 * handler returns, so Tito can never detect an ingest failure and
 * retry it. logSystemError_ / notifySystemFailure_ are the substitute:
 * a durable, human-visible record of any registration or sync attempt
 * that failed, so it can be noticed and replayed by hand. Used by
 * both Ingest.gs (doPost) and Sync.gs (syncFromClubsNow), sharing one
 * sheet and distinguished by the `source` column.
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


/*
 * Optional: set the INGEST_ALERT_EMAIL script property to get a
 * mail notification per failure. Left unset, failures are still
 * recorded in the System Errors sheet — someone just has to go
 * look. Wrapped in its own try/catch so a mail-quota error can
 * never mask the original failure.
 */
function notifySystemFailure_(
  source,
  rawContents,
  err
) {
  try {
    var alertEmail =
      PropertiesService
        .getScriptProperties()
        .getProperty(
          'INGEST_ALERT_EMAIL'
        );

    if (!alertEmail) {
      return;
    }

    MailApp.sendEmail(
      alertEmail,
      'Speed Shuffle: ' +
      source +
      ' failed',
      'Error: ' +
      String(
        (err && err.message) ||
        err
      ) +
      (
        rawContents
          ? '\n\nPayload:\n' +
            String(
              rawContents
            ).slice(0, 5000)
          : ''
      )
    );
  } catch (mailErr) {
    Logger.log(
      'Failed to send failure email: ' +
      mailErr
    );
  }
}
