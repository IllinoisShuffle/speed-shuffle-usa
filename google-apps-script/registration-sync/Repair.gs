/**
 * Sheet formatting/protection setup — the "Repair All Sheets" menu
 * item. Lays down data validation, the total_score formula, and range
 * protections across MASTER and all five club sheets. Unlike the
 * runtime read/write paths in Sync.gs/Ingest.gs, this tool requires
 * the canonical A:M column order exactly (assertCanonicalColumnOrder_
 * in Columns.gs) and refuses to touch a sheet that's already drifted,
 * rather than guessing how to fix it.
 */


/* =========================================================
   SHEET PREPARATION / REPAIR
   ========================================================= */

function prepareAllSheets() {
  try {
    var master =
      ensureMasterSheet_();

    preparePlayerSheet_(
      master,
      false
    );

    CLUBS.forEach(function(club) {
      var players =
        ensureClubPlayersSheet_(
          club.id
        );

      preparePlayerSheet_(
        players,
        true
      );
    });

    SpreadsheetApp.flush();

    safeAlert_(
      'Preparation complete.\n\n' +
      'E2:E1000 = status dropdown\n' +
      'F2:I1000 = score entry\n' +
      'J2:J1000 = formula\n' +
      'K2:K1000 = checkbox only\n' +
      'L = registration_id\n' +
      'M = email\n' +
      'N:U cleared'
    );
  } catch (err) {
    safeAlert_(
      'Preparation stopped: ' +
      (
        (err && err.message) ||
        err
      ) +
      '\n\nNothing further was modified. Fix the header issue ' +
      'named above and re-run.'
    );
  }
}


function preparePlayerSheet_(
  sheet,
  isClub
) {
  if (!sheet) {
    throw new Error(
      'Missing sheet.'
    );
  }

  bootstrapCanonicalHeadersIfBlank_(
    sheet
  );

  var cols =
    assertCanonicalColumnOrder_(
      sheet
    );

  ensureMinimumRows_(
    sheet,
    LAST_DATA_ROW
  );

  ensureMinimumColumns_(
    sheet,
    21
  );

  /*
   * Preserve existing hide_publicly values before
   * rebuilding checkbox validation.
   */
  var kRange =
    sheet.getRange(
      2,
      cols.HIDE,
      DATA_ROWS,
      1
    );

  var oldK =
    kRange.getValues();

  /*
   * Clear accidental checkbox/data validation
   * from A:J.
   */
  var aToJ =
    sheet.getRange(
      2,
      1,
      DATA_ROWS,
      10
    );

  try {
    aToJ.removeCheckboxes();
  } catch (err) {}

  aToJ.clearDataValidations();

  /*
   * Rebuild K cleanly.
   */
  try {
    kRange.removeCheckboxes();
  } catch (err) {}

  kRange.clearDataValidations();

  /*
   * registration_id must never be a checkbox.
   */
  var lRange =
    sheet.getRange(
      2,
      cols.REG_ID,
      DATA_ROWS,
      1
    );

  try {
    lRange.removeCheckboxes();
  } catch (err) {}

  lRange.clearDataValidations();

  /*
   * N:U unused. (M is email — left alone here, protected below.)
   */
  var nToU =
    sheet.getRange(
      1,
      14,
      sheet.getMaxRows(),
      8
    );

  try {
    nToU.removeCheckboxes();
  } catch (err) {}

  nToU.clearDataValidations();
  nToU.clearContent();
  nToU.clearFormat();

  /*
   * attempt_status = dropdown.
   */
  var statusRule =
    SpreadsheetApp
      .newDataValidation()
      .requireValueInList(
        STATUS_VALUES,
        true
      )
      .setAllowInvalid(false)
      .build();

  sheet
    .getRange(
      2,
      cols.STATUS,
      DATA_ROWS,
      1
    )
    .setDataValidation(
      statusRule
    );

  /*
   * end_1..end_4 = numeric scores.
   */
  var scoreRule =
    SpreadsheetApp
      .newDataValidation()
      .requireNumberGreaterThanOrEqualTo(0)
      .setAllowInvalid(false)
      .build();

  sheet
    .getRange(
      2,
      cols.E1,
      DATA_ROWS,
      4
    )
    .setDataValidation(
      scoreRule
    );

  /*
   * total_score. Canonical order is asserted above, so end_1..end_4
   * are guaranteed contiguous immediately left of this column.
   */
  sheet
    .getRange(
      2,
      cols.TOTAL,
      DATA_ROWS,
      1
    )
    .setFormulaR1C1(
      '=IF(COUNTA(RC[-4]:RC[-1])=0,"",SUM(RC[-4]:RC[-1]))'
    );

  /*
   * hide_publicly = only checkbox column.
   */
  kRange.insertCheckboxes();

  var newK =
    oldK.map(function(row) {
      var value = row[0];

      if (
        value === true ||
        value === 'TRUE' ||
        value === 'true'
      ) {
        return [true];
      }

      if (
        value === false ||
        value === 'FALSE' ||
        value === 'false'
      ) {
        return [false];
      }

      /*
       * Blank/new rows default to false — not hidden, i.e. visible
       * once completed. This is an opt-out column: false is the
       * common case, true is Lauren's rare manual override.
       */
      return [false];
    });

  kRange.setValues(newK);

  applyProtections_(
    sheet,
    isClub,
    cols
  );
}


function applyProtections_(
  sheet,
  isClub,
  cols
) {
  /*
   * Remove existing range protections on
   * this sheet, then rebuild canonical ones.
   */
  sheet
    .getProtections(
      SpreadsheetApp
        .ProtectionType
        .RANGE
    )
    .forEach(function(protection) {
      try {
        protection.remove();
      } catch (err) {}
    });

  protectRange_(
    sheet.getRange(
      1,
      1,
      1,
      HEADER_ORDER.length
    ),
    'Header A:M'
  );

  protectRange_(
    sheet.getRange(
      2,
      cols.FIRST,
      DATA_ROWS,
      4
    ),
    'Identity A:D'
  );

  protectRange_(
    sheet.getRange(
      2,
      cols.TOTAL,
      DATA_ROWS,
      1
    ),
    'total_score J'
  );

  protectRange_(
    sheet.getRange(
      2,
      cols.REG_ID,
      DATA_ROWS,
      1
    ),
    'registration_id L'
  );

  /*
   * email is Tito-sourced identity data, same as first_name/last_name/
   * club — protected on both Master and club sheets, not hand-edited.
   */
  protectRange_(
    sheet.getRange(
      2,
      cols.EMAIL,
      DATA_ROWS,
      1
    ),
    'email M'
  );

  /*
   * hide_publicly is protected on club sheets only.
   * Master hide_publicly stays editable for Lauren.
   */
  if (isClub) {
    protectRange_(
      sheet.getRange(
        2,
        cols.HIDE,
        DATA_ROWS,
        1
      ),
      'hide_publicly K — Master controlled'
    );
  }
}


function protectRange_(
  range,
  description
) {
  var protection =
    range
      .protect()
      .setDescription(
        description
      )
      .setWarningOnly(false);

  var editors =
    protection.getEditors();

  if (editors.length) {
    protection.removeEditors(
      editors
    );
  }

  if (
    protection.canDomainEdit &&
    protection.canDomainEdit()
  ) {
    protection.setDomainEdit(
      false
    );
  }
}
