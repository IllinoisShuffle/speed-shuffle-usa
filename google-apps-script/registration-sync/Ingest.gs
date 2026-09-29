/**
 * The Tito integration: doPost() is the webhook Tito calls on ticket
 * events. Verifies a shared token (assertIngestToken_), maps the Tito
 * ticket JSON to this project's registration shape
 * (mapTitoPayloadToRegistration_), and upserts one row into both
 * MASTER and the matching club sheet (addRegistration /
 * upsertRegistrationRow_), keyed on registration_id. Shares
 * LockService.getScriptLock() with syncFromClubsNow() in Sync.gs so
 * the two paths can't interleave and corrupt a row.
 */


/* =========================================================
   REGISTRATION INGEST / TITO TARGET
   ========================================================= */

function addRegistration(
  registration
) {
  if (!registration) {
    throw new Error(
      'Registration payload is required.'
    );
  }

  var registrationId =
    String(
      registration.registration_id || ''
    ).trim();

  if (!registrationId) {
    throw new Error(
      'registration_id is required.'
    );
  }

  var clubId =
    String(
      registration.club || ''
    )
      .trim()
      .toLowerCase();

  var club =
    getClubById_(clubId);

  if (!club) {
    throw new Error(
      'Unknown club: ' +
      clubId
    );
  }

  /*
   * Shared with syncFromClubsNow() so a club sync mid-run
   * can't interleave with this write and corrupt a row.
   */
  var lock =
    LockService.getScriptLock();

  lock.waitLock(
    LOCK_WAIT_MS
  );

  try {
    var master =
      ensureMasterSheet_();

    var clubSheet =
      ensureClubPlayersSheet_(
        clubId
      );

    var fields =
      buildRegistrationFields_(
        registration,
        clubId
      );

    var masterRow =
      upsertRegistrationRow_(
        master,
        fields,
        true
      );

    var clubRow =
      upsertRegistrationRow_(
        clubSheet,
        fields,
        false
      );

    SpreadsheetApp.flush();

    return {
      registration_id:
        registrationId,
      club:
        clubId,
      master_row:
        masterRow,
      club_row:
        clubRow
    };
  } finally {
    lock.releaseLock();
  }
}


function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(
      JSON.stringify(obj)
    )
    .setMimeType(
      ContentService
        .MimeType
        .JSON
    );
}


function assertIngestToken_(e) {
  var expected =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        'REGISTRATION_INGEST_TOKEN'
      );

  var supplied =
    e &&
    e.parameter &&
    e.parameter.token
      ? String(e.parameter.token)
      : '';

  if (
    !expected ||
    supplied !== expected
  ) {
    throw new Error('Unauthorized');
  }
}


function resolveClubFromRelease_(
  releaseSlug,
  releaseTitle
) {
  var hay =
    (
      String(releaseSlug || '') +
      ' ' +
      String(releaseTitle || '')
    ).toLowerCase();

  for (
    var i = 0;
    i < CLUBS.length;
    i++
  ) {
    if (
      hay.indexOf(
        CLUBS[i].id
      ) !== -1
    ) {
      return CLUBS[i].id;
    }
  }

  if (
    hay.indexOf('new york') !== -1 ||
    hay.indexOf('brooklyn') !== -1
  ) {
    return 'brooklyn';
  }

  if (
    hay.indexOf('st. pete') !== -1 ||
    hay.indexOf('st pete') !== -1
  ) {
    return 'st-pete';
  }

  if (
    hay.indexOf('beach') !== -1
  ) {
    return 'beachside';
  }

  return '';
}


function splitName_(name) {
  var parts =
    String(name || '')
      .trim()
      .split(/\s+/)
      .filter(String);

  if (!parts.length) {
    return {
      first_name: 'Unknown',
      last_initial: ''
    };
  }

  if (parts.length === 1) {
    return {
      first_name: parts[0],
      last_initial: ''
    };
  }

  return {
    first_name: parts[0],
    last_initial:
      parts[
        parts.length - 1
      ].charAt(0)
  };
}


function ticketFromPayload_(payload) {
  if (
    !payload ||
    typeof payload !== 'object'
  ) {
    return null;
  }

  if (
    payload._type === 'ticket' ||
    payload.slug ||
    payload.release_slug
  ) {
    return payload;
  }

  if (
    payload.data &&
    payload.data.object
  ) {
    return payload.data.object;
  }

  if (payload.ticket) {
    return payload.ticket;
  }

  return null;
}


function mapTitoPayloadToRegistration_(
  payload,
  webhookEvent
) {
  if (
    payload.registration_id &&
    payload.club &&
    payload.first_name !== undefined
  ) {
    return payload;
  }

  var ticket =
    ticketFromPayload_(payload);

  if (!ticket) {
    return null;
  }

  var registrationId =
    String(
      ticket.slug || ''
    ).trim();

  if (!registrationId) {
    throw new Error(
      'Tito ticket payload is missing slug (registration_id).'
    );
  }

  var release =
    ticket.release || {};

  var releaseSlug =
    String(
      ticket.release_slug ||
      release.slug ||
      ''
    ).trim();

  var releaseTitle =
    String(
      ticket.release_title ||
      release.title ||
      ''
    ).trim();

  var clubId =
    resolveClubFromRelease_(
      releaseSlug,
      releaseTitle
    );

  if (!clubId) {
    throw new Error(
      'Could not map Tito release to club: ' +
      releaseSlug +
      ' / ' +
      releaseTitle
    );
  }

  var firstName =
    String(
      ticket.first_name || ''
    ).trim();

  var lastName =
    String(
      ticket.last_name || ''
    ).trim();

  var names =
    firstName
      ? {
          first_name: firstName,
          last_initial:
            lastName.charAt(0)
        }
      : splitName_(ticket.name);

  var state =
    String(
      ticket.state_name ||
      ticket.state ||
      ''
    ).toLowerCase();

  var voided =
    (
      webhookEvent &&
      /voided|cancelled/i.test(
        webhookEvent
      )
    ) ||
    state.indexOf('void') !== -1 ||
    state.indexOf('cancel') !== -1;

  var registeredAt =
    String(
      ticket.updated_at ||
      ticket.created_at ||
      ''
    ).slice(0, 10);

  return {
    registration_id:
      registrationId,
    first_name:
      names.first_name,
    last_initial:
      names.last_initial,
    club: clubId,
    registered_at:
      registeredAt || undefined,
    attempt_status:
      voided
        ? 'cancelled'
        : 'registered'
  };
}


/*
 * Apps Script Web Apps always answer HTTP 200, regardless of what
 * doPost returns — there is no way to make Tito's own webhook retry
 * trigger on failure. logSystemError_ / notifySystemFailure_ (in
 * ErrorLog.gs) are the substitute: a durable, human-visible record of
 * any registration that failed to apply, so it can be replayed by
 * hand.
 */
function doPost(e) {
  var contents =
    e &&
    e.postData &&
    e.postData.contents
      ? e.postData.contents
      : '{}';

  try {
    assertIngestToken_(e);
  } catch (authErr) {
    /*
     * Unauthorized requests are not logged/emailed: the public
     * webhook URL will draw scanner noise, and attacker-supplied
     * bodies shouldn't get written into a tournament sheet.
     */
    return jsonResponse_({
      ok: false,
      error: String(
        authErr.message ||
        authErr
      )
    });
  }

  try {
    var payload =
      JSON.parse(contents);

    var registration =
      mapTitoPayloadToRegistration_(
        payload,
        ''
      );

    if (!registration) {
      return jsonResponse_({
        ok: true,
        skipped: true
      });
    }

    var result =
      addRegistration(
        registration
      );

    return jsonResponse_({
      ok: true,
      result: result
    });

  } catch (err) {
    logSystemError_(
      'tito_ingest',
      contents,
      err
    );

    notifySystemFailure_(
      'tito_ingest',
      contents,
      err
    );

    return jsonResponse_({
      ok: false,
      error: String(
        err.message ||
        err
      )
    });
  }
}


function buildRegistrationFields_(
  registration,
  clubId
) {
  var status =
    String(
      registration.attempt_status ||
      'registered'
    )
      .trim()
      .toLowerCase();

  if (
    STATUS_VALUES.indexOf(
      status
    ) === -1
  ) {
    status = 'registered';
  }

  return {
    registration_id:
      String(
        registration.registration_id || ''
      ).trim(),

    first_name:
      String(
        registration.first_name || ''
      ).trim(),

    last_initial:
      String(
        registration.last_initial || ''
      ).trim(),

    club: clubId,

    registered_at:
      registration.registered_at ||
      Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      ),

    attempt_status: status,

    end_1_score:
      registration.end_1_score !== undefined
        ? registration.end_1_score
        : '',

    end_2_score:
      registration.end_2_score !== undefined
        ? registration.end_2_score
        : '',

    end_3_score:
      registration.end_3_score !== undefined
        ? registration.end_3_score
        : '',

    end_4_score:
      registration.end_4_score !== undefined
        ? registration.end_4_score
        : ''
  };
}


/*
 * Upserts one registration into `sheet` (either MASTER or a club
 * Players sheet), matched by registration_id. Every field is written
 * to its own resolved column — the two sheets involved in a single
 * addRegistration() call are not assumed to share a column order.
 */
function upsertRegistrationRow_(
  sheet,
  fields,
  isMaster
) {
  var registrationId =
    fields.registration_id;

  if (!registrationId) {
    throw new Error(
      'Cannot write registration without registration_id.'
    );
  }

  var cols =
    resolveColumns_(sheet);

  var existingRow =
    findRegistrationRow_(
      sheet,
      cols,
      registrationId
    );

  var targetRow =
    existingRow ||
    findFirstEmptyRegistrationRow_(
      sheet,
      cols
    );

  /*
   * Preserve public_display if this is an existing
   * Master registration.
   *
   * New registrations default false.
   */
  var publicValue = false;

  if (
    isMaster &&
    existingRow
  ) {
    publicValue =
      sheet
        .getRange(
          existingRow,
          cols.PUBLIC
        )
        .getValue() === true;
  }

  sheet
    .getRange(
      targetRow,
      cols.FIRST
    )
    .setValue(
      fields.first_name
    );

  sheet
    .getRange(
      targetRow,
      cols.LAST
    )
    .setValue(
      fields.last_initial
    );

  sheet
    .getRange(
      targetRow,
      cols.CLUB
    )
    .setValue(
      fields.club
    );

  sheet
    .getRange(
      targetRow,
      cols.REGISTERED
    )
    .setValue(
      fields.registered_at
    );

  sheet
    .getRange(
      targetRow,
      cols.STATUS
    )
    .setValue(
      fields.attempt_status
    );

  sheet
    .getRange(
      targetRow,
      cols.E1
    )
    .setValue(
      fields.end_1_score
    );

  sheet
    .getRange(
      targetRow,
      cols.E2
    )
    .setValue(
      fields.end_2_score
    );

  sheet
    .getRange(
      targetRow,
      cols.E3
    )
    .setValue(
      fields.end_3_score
    );

  sheet
    .getRange(
      targetRow,
      cols.E4
    )
    .setValue(
      fields.end_4_score
    );

  /*
   * total_score formula, built from explicit cell references
   * rather than a colon range — end_1..end_4 are not assumed to
   * be contiguous on a sheet whose columns have been reordered.
   */
  var endRefs = [
    columnToLetter_(cols.E1) + targetRow,
    columnToLetter_(cols.E2) + targetRow,
    columnToLetter_(cols.E3) + targetRow,
    columnToLetter_(cols.E4) + targetRow
  ].join(',');

  sheet
    .getRange(
      targetRow,
      cols.TOTAL
    )
    .setFormula(
      '=IF(COUNTA(' +
      endRefs +
      ')=0,"",SUM(' +
      endRefs +
      '))'
    );

  sheet
    .getRange(
      targetRow,
      cols.PUBLIC
    )
    .setValue(
      publicValue
    );

  sheet
    .getRange(
      targetRow,
      cols.REG_ID
    )
    .setValue(
      registrationId
    );

  return targetRow;
}


function findRegistrationRow_(
  sheet,
  cols,
  registrationId
) {
  var lastRow =
    Math.max(
      sheet.getLastRow(),
      2
    );

  var numRows =
    lastRow - 1;

  if (
    numRows <= 0
  ) {
    return null;
  }

  var ids =
    sheet
      .getRange(
        2,
        cols.REG_ID,
        numRows,
        1
      )
      .getValues();

  for (
    var i = 0;
    i < ids.length;
    i++
  ) {
    if (
      String(
        ids[i][0] || ''
      ).trim() ===
      registrationId
    ) {
      return i + 2;
    }
  }

  return null;
}


function findFirstEmptyRegistrationRow_(
  sheet,
  cols
) {
  ensureMinimumRows_(
    sheet,
    LAST_DATA_ROW
  );

  var ids =
    sheet
      .getRange(
        2,
        cols.REG_ID,
        DATA_ROWS,
        1
      )
      .getValues();

  for (
    var i = 0;
    i < ids.length;
    i++
  ) {
    if (
      !String(
        ids[i][0] || ''
      ).trim()
    ) {
      return i + 2;
    }
  }

  throw new Error(
    'No empty registration rows remain through row ' +
    LAST_DATA_ROW +
    '.'
  );
}
