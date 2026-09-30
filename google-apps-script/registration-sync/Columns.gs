/**
 * Header-name column resolution, shared by every other file in this
 * project (Repair.gs, Sync.gs, Ingest.gs, Admin.gs). Nothing outside
 * this file should assume a column's letter — resolveColumns_() is
 * the only thing that knows where a column "actually is" on a given
 * sheet. See the top-of-project comment in Config.gs for why.
 */


/* =========================================================
   HEADER-NAME COLUMN RESOLUTION
   ========================================================= */

/*
 * Reads row 1 of `sheet` and returns { FIRST: n, LAST_NAME: n, ... } mapping
 * each HEADER_KEYS entry to the actual 1-based column number where its
 * HEADER_ORDER text currently lives — wherever that is, in whatever
 * order. Throws a descriptive Error if a required header is missing or
 * duplicated. This is the only thing in the script that knows where a
 * column "actually is"; nothing else should assume a fixed letter.
 */
function resolveColumns_(sheet) {
  return resolveColumnsFor_(sheet, HEADER_ORDER, HEADER_KEYS);
}


/*
 * Same as resolveColumns_(), generalized to any header list — used for
 * the Sessions sheets (SESSIONS_HEADER_ORDER/SESSIONS_HEADER_KEYS),
 * which have their own, unrelated schema. resolveColumns_() is just
 * this called with the registration project's own HEADER_ORDER/
 * HEADER_KEYS, so every existing caller is unaffected.
 */
function resolveColumnsFor_(sheet, headerOrder, headerKeys) {
  var lastColumn =
    sheet.getLastColumn();

  if (lastColumn < headerOrder.length) {
    lastColumn = headerOrder.length;
  }

  var headerRow =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0];

  var location =
    '"' +
    sheet.getName() +
    '" (' +
    sheet.getParent().getName() +
    ')';

  var indexByName = {};

  headerRow.forEach(function(value, i) {
    var name =
      String(value || '').trim();

    if (!name) {
      return;
    }

    if (
      indexByName.hasOwnProperty(name)
    ) {
      throw new Error(
        'Sheet ' +
        location +
        ' has a duplicate header: "' +
        name +
        '".'
      );
    }

    indexByName[name] = i + 1;
  });

  var cols = {};
  var missing = [];

  headerOrder.forEach(function(name, i) {
    var key = headerKeys[i];

    if (
      indexByName.hasOwnProperty(name)
    ) {
      cols[key] = indexByName[name];
    } else {
      missing.push(name);
    }
  });

  if (missing.length) {
    throw new Error(
      'Sheet ' +
      location +
      ' is missing required header(s): ' +
      missing.join(', ') +
      '.'
    );
  }

  return cols;
}


/*
 * Like resolveColumns_(), but also requires the 13 headers to be in
 * the exact canonical A:M order. Only prepareAllSheets() uses this —
 * it's a repair tool, not a live data path, so it's allowed to be
 * stricter and simply refuse to touch a sheet whose columns have
 * already drifted, rather than guessing how to fix it.
 */
function assertCanonicalColumnOrder_(sheet) {
  var cols =
    resolveColumns_(sheet);

  var inOrder =
    HEADER_KEYS.every(function(key, i) {
      return cols[key] === i + 1;
    });

  if (!inOrder) {
    throw new Error(
      'Sheet "' +
      sheet.getName() +
      '" (' +
      sheet.getParent().getName() +
      ') has all required headers, but not in the canonical A:M order. ' +
      'Restore the original column order before repairing, or reorder ' +
      'the columns by hand — this tool will not do it automatically.'
    );
  }

  return cols;
}


/*
 * Writes the canonical header row on a sheet whose row 1 is entirely
 * blank (brand-new club/master sheet). Does nothing — and does not
 * overwrite anything — if row 1 already has content of any kind.
 */
function bootstrapCanonicalHeadersIfBlank_(sheet) {
  ensureMinimumColumns_(
    sheet,
    HEADER_ORDER.length
  );

  var firstRow =
    sheet
      .getRange(
        1,
        1,
        1,
        HEADER_ORDER.length
      )
      .getValues()[0];

  var isBlank =
    firstRow.every(function(value) {
      return (
        String(value || '').trim() === ''
      );
    });

  if (!isBlank) {
    return;
  }

  sheet
    .getRange(
      1,
      1,
      1,
      HEADER_ORDER.length
    )
    .setValues([
      HEADER_ORDER
    ]);
}


function columnToLetter_(column) {
  var letter = '';

  while (column > 0) {
    var remainder =
      (column - 1) % 26;

    letter =
      String.fromCharCode(
        65 + remainder
      ) + letter;

    column =
      Math.floor(
        (column - 1) / 26
      );
  }

  return letter;
}


function ensureMinimumRows_(
  sheet,
  lastRow
) {
  var currentRows =
    sheet.getMaxRows();

  if (currentRows < lastRow) {
    sheet.insertRowsAfter(
      currentRows,
      lastRow - currentRows
    );
  }
}


function ensureMinimumColumns_(
  sheet,
  columnCount
) {
  var currentCols =
    sheet.getMaxColumns();

  if (currentCols < columnCount) {
    sheet.insertColumnsAfter(
      currentCols,
      columnCount - currentCols
    );
  }
}
