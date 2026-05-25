# mercapi-gas

Google Apps Script (GAS) only implementation of `take-kun/mercapi`.

## Features

- `Mercapi.search(query, options)`
- `Mercapi.item(id)`
- `Mercapi.profile(userId)`
- `Mercapi.items(profileId)`
- DPoP (`ES256`) header generation in GAS code only
- Search pagination helpers: `next_page()`, `prev_page()`
- Compatible with both V8 and legacy GAS runtimes (uses BigInteger.js for ECC math)

## Setup

1. Create a new Apps Script project.
2. Copy `mercapi.gs` into your project.
3. Run your script.

## Example

```javascript
function runMercariSearch() {
  var m = new Mercapi();
  var results = m.search('shrapnel');

  Logger.log('Found: ' + results.meta.num_found);
  if (results.items.length > 0) {
    var item = results.items[0];
    Logger.log(item.name + ' / ' + item.price);

    var full = item.full_item();
    Logger.log(full.description);
  }
}
```