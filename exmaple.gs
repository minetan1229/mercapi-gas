var MERCAPI_EXAMPLE_SEARCH_SHEET = '検索';
var MERCAPI_EXAMPLE_LOG_SHEET = 'log';
var MERCAPI_EXAMPLE_TEMP_SHEET = 'Temporary';
var MERCAPI_EXAMPLE_TRIGGER_FUNCTION = 'runMercapiSearches';
var MERCAPI_EXAMPLE_MAX_TRACKED_ITEMS = 50;

function setupMercapiSearchTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === MERCAPI_EXAMPLE_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger(MERCAPI_EXAMPLE_TRIGGER_FUNCTION)
    .timeBased()
    .everyMinutes(5)
    .create();
}

function runMercapiSearches() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var searchSheet = mercapiGetOrCreateSheet_(ss, MERCAPI_EXAMPLE_SEARCH_SHEET, [
    'keyword',
    'min_price',
    'max_price',
  ]);
  var logSheet = mercapiGetOrCreateSheet_(ss, MERCAPI_EXAMPLE_LOG_SHEET, [
    'timestamp',
    'keyword',
    'min_price',
    'max_price',
    'item_id',
    'item_name',
    'price',
    'status',
    'updated',
    'url',
  ]);
  var tempSheet = mercapiGetOrCreateSheet_(ss, MERCAPI_EXAMPLE_TEMP_SHEET, [
    'search_key',
    'item_tokens',
    'updated_at',
  ]);

  var searches = mercapiLoadSearchRows_(searchSheet);
  if (!searches.length) return;

  var tempIndex = mercapiLoadTempIndex_(tempSheet);
  var mercapi = new Mercapi();
  var now = new Date();
  var newItems = [];
  var logRows = [];

  for (var i = 0; i < searches.length; i++) {
    var search = searches[i];
    var results = mercapi.search(search.keyword, {
      price_min: search.min_price || 0,
      price_max: search.max_price || 0,
      sort_by: SearchRequestData.SortBy.SORT_CREATED_TIME,
      sort_order: SearchRequestData.SortOrder.ORDER_DESC,
    });
    var items = (results.items || []).slice(0, MERCAPI_EXAMPLE_MAX_TRACKED_ITEMS);
    var tempEntry = tempIndex[search.key];
    var previousTokens = tempEntry ? tempEntry.tokens : null;

    if (previousTokens) {
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var updatedAt = mercapiItemTimestamp_(item);
        if (!mercapiHasSameToken_(previousTokens, item.id_, updatedAt)) {
          var url = mercapiBuildItemUrl_(item.id_);
          newItems.push({
            keyword: search.keyword,
            min_price: search.min_price,
            max_price: search.max_price,
            item: item,
            url: url,
          });
          logRows.push([
            now,
            search.keyword,
            search.min_price || '',
            search.max_price || '',
            item.id_,
            item.name,
            item.price,
            item.status,
            item.updated || item.created || '',
            url,
          ]);
        }
      }
    }

    mercapiUpdateTempRow_(tempSheet, tempEntry ? tempEntry.row : null, search.key, items, now);
  }

  if (logRows.length) {
    mercapiAppendRows_(logSheet, logRows);
  }

  if (newItems.length) {
    mercapiSendNotification_(newItems);
  }
}

function mercapiLoadSearchRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var keyword = String(values[i][0] || '').trim();
    if (!keyword) continue;
    var minPrice = mercapiNormalizePrice_(values[i][1]);
    var maxPrice = mercapiNormalizePrice_(values[i][2]);
    if (minPrice !== null && maxPrice !== null && maxPrice < minPrice) {
      var temp = minPrice;
      minPrice = maxPrice;
      maxPrice = temp;
    }
    rows.push({
      keyword: keyword,
      min_price: minPrice,
      max_price: maxPrice,
      key: mercapiBuildSearchKey_(keyword, minPrice, maxPrice),
    });
  }
  return rows;
}

function mercapiNormalizePrice_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && !isNaN(value)) {
    return Math.max(0, Math.floor(value));
  }
  var cleaned = String(value).replace(/[^\d]/g, '');
  if (!cleaned) return null;
  var numeric = Number(cleaned);
  return isNaN(numeric) ? null : Math.max(0, Math.floor(numeric));
}

function mercapiBuildSearchKey_(keyword, minPrice, maxPrice) {
  return [keyword, minPrice || '', maxPrice || ''].join('|');
}

function mercapiGetOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (headers && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function mercapiLoadTempIndex_(sheet) {
  var data = sheet.getDataRange().getValues();
  var index = {};
  if (data.length < 2) return index;
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    if (!key) continue;
    index[key] = {
      row: i + 1,
      tokens: mercapiParseTokens_(data[i][1]),
    };
  }
  return index;
}

function mercapiParseTokens_(value) {
  var tokens = String(value || '').split(',');
  var map = {};
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i].trim();
    if (!token) continue;
    var parts = token.split('@');
    var id = parts[0];
    if (!id) continue;
    var timestamp = parts.length > 1 ? Number(parts[1]) : null;
    map[id] = isNaN(timestamp) ? null : timestamp;
  }
  return map;
}

function mercapiUpdateTempRow_(sheet, row, key, items, now) {
  var tokens = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    tokens.push(item.id_ + '@' + mercapiItemTimestamp_(item));
  }
  var payload = [[key, tokens.join(','), now]];
  if (row) {
    sheet.getRange(row, 1, 1, 3).setValues(payload);
    return;
  }
  sheet.appendRow([key, tokens.join(','), now]);
}

function mercapiItemTimestamp_(item) {
  var date = item.updated || item.created;
  return date ? date.getTime() : '';
}

function mercapiHasSameToken_(tokenMap, id, timestamp) {
  if (!tokenMap || !tokenMap.hasOwnProperty(id)) return false;
  return String(tokenMap[id] || '') === String(timestamp || '');
}

function mercapiAppendRows_(sheet, rows) {
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
}

function mercapiBuildItemUrl_(itemId) {
  return 'https://jp.mercari.com/item/' + itemId;
}

function mercapiSendNotification_(items) {
  var recipient = Session.getEffectiveUser().getEmail();
  if (!recipient) return;
  var subject = 'Mercari updates: ' + items.length;
  var lines = [];
  for (var i = 0; i < items.length; i++) {
    var entry = items[i];
    var item = entry.item;
    lines.push(
      entry.keyword +
        ' | ' +
        item.name +
        ' | ' +
        item.price +
        ' | ' +
        entry.url
    );
  }
  MailApp.sendEmail(recipient, subject, lines.join('\n'));
}
