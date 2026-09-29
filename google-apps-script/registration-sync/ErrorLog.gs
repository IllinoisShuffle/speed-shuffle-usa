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


/*
 * Optional: set the INGEST_ALERT_EMAIL script property to get a
 * mail notification per failure. Left unset, failures are still
 * recorded in the System Errors sheet — someone just has to go
 * look. Wrapped in its own try/catch so a mail-quota error can
 * never mask the original failure.
 *
 * Throttled per `source` (see shouldSendAlertEmail_ below) so a
 * single persistent failure re-hit by the 1-minute sync trigger can't
 * flood the inbox — the System Errors sheet row above still happens
 * on every occurrence regardless.
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

    if (
      !shouldSendAlertEmail_(
        source
      )
    ) {
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


/*
 * Per-source cooldown gate for notifySystemFailure_. Keyed off the
 * same `source` string callers already pass (e.g. 'tito_ingest',
 * 'club_sync', 'club_sync:<club id>', 'club_sync:unmatched_ids'), so
 * unrelated failure types don't suppress each other's alerts — a
 * broken club sheet doesn't silence a genuinely new Tito ingest
 * failure, and vice versa. The last-sent time per source lives in
 * Script Properties (not a sheet) so it survives across executions
 * without adding sheet-write contention to the failure path.
 *
 * Returns true (and records "sent now") the first time a source
 * fails, then false for any further failure of that same source
 * within ALERT_EMAIL_COOLDOWN_MS. Every occurrence still gets its own
 * System Errors row via logSystemError_ regardless of this return
 * value — only the email is throttled.
 */
function shouldSendAlertEmail_(
  source
) {
  var props =
    PropertiesService
      .getScriptProperties();

  var key =
    ALERT_LAST_SENT_PROPERTY_PREFIX +
    source;

  var lastSent =
    Number(
      props.getProperty(key)
    ) || 0;

  var now = Date.now();

  if (
    now - lastSent <
    ALERT_EMAIL_COOLDOWN_MS
  ) {
    return false;
  }

  props.setProperty(
    key,
    String(now)
  );

  return true;
}
