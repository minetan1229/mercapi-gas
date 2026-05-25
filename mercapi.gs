var MERCAPI_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.3';

var MERCAPI_ENDPOINTS = {
  SEARCH: 'https://api.mercari.jp/v2/entities:search',
  ITEM: 'https://api.mercari.jp/items/get',
  PROFILE: 'https://api.mercari.jp/users/get_profile',
  ITEMS: 'https://api.mercari.jp/items/get_items',
};

function MercapiError(message) {
  this.name = 'MercapiError';
  this.message = message || 'MercapiError';
  this.stack = Error().stack;
}
MercapiError.prototype = Object.create(Error.prototype);
MercapiError.prototype.constructor = MercapiError;

function ParseAPIResponseError(message) {
  MercapiError.call(this, message || 'Failed to parse API response');
  this.name = 'ParseAPIResponseError';
}
ParseAPIResponseError.prototype = Object.create(MercapiError.prototype);
ParseAPIResponseError.prototype.constructor = ParseAPIResponseError;

function IncorrectRequestError(message) {
  MercapiError.call(this, message || 'Incorrect request');
  this.name = 'IncorrectRequestError';
}
IncorrectRequestError.prototype = Object.create(MercapiError.prototype);
IncorrectRequestError.prototype.constructor = IncorrectRequestError;

function Mercapi(options) {
  options = options || {};
  this._headers = {
    'User-Agent': options.userAgent || MERCAPI_DEFAULT_USER_AGENT,
    'X-Platform': 'web',
  };
  this._uuid = mercapiUuidV4();
  this._keyPair = mercapiGenerateP256KeyPair();
}

Mercapi.prototype.search = function (query, options) {
  options = options || {};
  var requestData = new SearchRequestData(
    new SearchConditions(
      query,
      options.categories || [],
      options.brands || [],
      options.sizes || [],
      options.price_min || 0,
      options.price_max || 0,
      options.item_conditions || [],
      options.shipping_payer || [],
      options.colors || [],
      options.shipping_methods || [],
      options.status || [],
      options.sort_by || SearchRequestData.SortBy.SORT_SCORE,
      options.sort_order || SearchRequestData.SortOrder.ORDER_DESC,
      options.exclude || ''
    ),
    options.page_token || ''
  );
  return this._searchImpl(requestData);
};

Mercapi.prototype._searchImpl = function (requestData) {
  var res = this._request('post', MERCAPI_ENDPOINTS.SEARCH, {
    payload: requestData.data(),
  });
  var results = mercapiMapSearchResults(this, res.body, requestData);
  return results;
};

Mercapi.prototype.item = function (id_) {
  var res = this._request('get', MERCAPI_ENDPOINTS.ITEM, {
    params: { id: id_ },
  });
  if (res.statusCode === 404) return null;
  return mercapiMapItem(this, (res.body && res.body.data) || {});
};

Mercapi.prototype.profile = function (id_) {
  var res = this._request('get', MERCAPI_ENDPOINTS.PROFILE, {
    params: { user_id: id_, _user_format: 'profile' },
  });
  if (res.statusCode === 404) return null;
  return mercapiMapProfile(this, (res.body && res.body.data) || {});
};

Mercapi.prototype.items = function (profileId) {
  var res = this._request('get', MERCAPI_ENDPOINTS.ITEMS, {
    params: {
      seller_id: profileId,
      limit: 30,
      status: 'on_sale,trading,sold_out',
    },
  });
  if (res.statusCode === 404) return null;
  return mercapiMapItems(this, res.body || {});
};

Mercapi.prototype._request = function (method, url, options) {
  options = options || {};
  var finalUrl = mercapiBuildUrl(url, options.params || {});
  var headers = mercapiAssign({}, this._headers);
  headers.DPoP = mercapiGenerateDpop(finalUrl, method.toUpperCase(), this._keyPair, {
    uuid: this._uuid,
  });

  var fetchOptions = {
    method: method,
    headers: headers,
    muteHttpExceptions: true,
  };
  if (options.payload !== undefined) {
    fetchOptions.contentType = 'application/json';
    fetchOptions.payload = JSON.stringify(options.payload);
  }

  var response = UrlFetchApp.fetch(finalUrl, fetchOptions);
  var bodyText = response.getContentText();
  var body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (e) {
    throw new ParseAPIResponseError('Invalid JSON response: ' + e);
  }
  return {
    statusCode: response.getResponseCode(),
    body: body,
  };
};

function SearchConditions(
  query,
  categories,
  brands,
  sizes,
  priceMin,
  priceMax,
  itemConditions,
  shippingPayer,
  colors,
  shippingMethods,
  status,
  sortBy,
  sortOrder,
  exclude
) {
  this.query = query;
  this.categories = categories || [];
  this.brands = brands || [];
  this.sizes = sizes || [];
  this.price_min = priceMin || 0;
  this.price_max = priceMax || 0;
  this.item_conditions = itemConditions || [];
  this.shipping_payer = shippingPayer || [];
  this.colors = colors || [];
  this.shipping_methods = shippingMethods || [];
  this.status = status || [];
  this.sort_by = sortBy || SearchRequestData.SortBy.SORT_SCORE;
  this.sort_order = sortOrder || SearchRequestData.SortOrder.ORDER_DESC;
  this.exclude = exclude || '';
}

function SearchRequestData(searchConditions, pageToken) {
  this.search_conditions = searchConditions;
  this.page_token = pageToken || '';
}

SearchRequestData.ShippingMethod = {
  SHIPPING_METHOD_ANONYMOUS: 'SHIPPING_METHOD_ANONYMOUS',
  SHIPPING_METHOD_JAPAN_POST: 'SHIPPING_METHOD_JAPAN_POST',
  SHIPPING_METHOD_NO_OPTION: 'SHIPPING_METHOD_NO_OPTION',
};

SearchRequestData.Status = {
  STATUS_ON_SALE: 'STATUS_ON_SALE',
  STATUS_SOLD_OUT: 'STATUS_SOLD_OUT',
  STATUS_TRADING: 'STATUS_TRADING',
};

SearchRequestData.SortBy = {
  SORT_SCORE: 'SORT_SCORE',
  SORT_CREATED_TIME: 'SORT_CREATED_TIME',
  SORT_PRICE: 'SORT_PRICE',
  SORT_NUM_LIKES: 'SORT_NUM_LIKES',
};

SearchRequestData.SortOrder = {
  ORDER_DESC: 'ORDER_DESC',
  ORDER_ASC: 'ORDER_ASC',
};

SearchRequestData.prototype.data = function () {
  var shippingMethods = (this.search_conditions.shipping_methods || []).slice();
  var status = (this.search_conditions.status || []).slice();
  if (status.indexOf(SearchRequestData.Status.STATUS_SOLD_OUT) >= 0 &&
      status.indexOf(SearchRequestData.Status.STATUS_TRADING) < 0) {
    status.push(SearchRequestData.Status.STATUS_TRADING);
  }

  return {
    userId: '',
    pageSize: 120,
    pageToken: this.page_token,
    searchSessionId: mercapiRandomHex(32),
    indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
    thumbnailTypes: [],
    searchCondition: {
      keyword: this.search_conditions.query,
      sort: this.search_conditions.sort_by,
      order: this.search_conditions.sort_order,
      status: status,
      sizeId: this.search_conditions.sizes,
      categoryId: this.search_conditions.categories,
      brandId: this.search_conditions.brands,
      sellerId: [],
      priceMin: this.search_conditions.price_min,
      priceMax: this.search_conditions.price_max,
      itemConditionId: this.search_conditions.item_conditions,
      shippingPayerId: this.search_conditions.shipping_payer,
      shippingFromArea: [],
      shippingMethod: shippingMethods,
      colorId: this.search_conditions.colors,
      hasCoupon: false,
      attributes: [],
      itemTypes: [],
      skuIds: [],
      excludeKeyword: this.search_conditions.exclude,
    },
    defaultDatasets: [],
    serviceFrom: 'suruga',
  };
};

function SearchResults(mercapi, meta, items, requestData) {
  this.meta = meta || {};
  this.items = items || [];
  this._mercapi = mercapi;
  this._request = requestData;
}

SearchResults.prototype.next_page = function () {
  if (!this.meta.next_page_token) {
    throw new IncorrectRequestError(
      'Cannot fetch new page of search results, you are probably on the last page'
    );
  }
  var newRequest = new SearchRequestData(
    this._request.search_conditions,
    this.meta.next_page_token
  );
  return this._mercapi._searchImpl(newRequest);
};

SearchResults.prototype.prev_page = function () {
  if (!this.meta.prev_page_token) {
    throw new IncorrectRequestError(
      'Cannot fetch previous page of search results, you are probably on the first page'
    );
  }
  var newRequest = new SearchRequestData(
    this._request.search_conditions,
    this.meta.prev_page_token
  );
  return this._mercapi._searchImpl(newRequest);
};

function SearchResultItem(mercapi, raw) {
  this._mercapi = mercapi;
  this.id_ = mercapiPick(raw, ['id', 'id_'], '');
  this.name = mercapiPick(raw, ['name'], '');
  this.price = mercapiPick(raw, ['price'], 0);
  this.seller_id = String(mercapiPick(raw, ['sellerId', 'seller_id'], ''));
  this.status = mercapiPick(raw, ['status'], '');
  this.created = mercapiToDate(mercapiPick(raw, ['created', 'createdAt']));
  this.updated = mercapiToDate(mercapiPick(raw, ['updated', 'updatedAt']));
  this.thumbnails = mercapiPick(raw, ['thumbnails'], []);
  this.item_type = mercapiPick(raw, ['itemType', 'item_type'], '');
  this.item_condition_id = mercapiPick(raw, ['itemConditionId', 'item_condition_id'], null);
  this.shipping_payer_id = mercapiPick(raw, ['shippingPayerId', 'shipping_payer_id'], null);
  this.shipping_method_id = mercapiPick(raw, ['shippingMethodId', 'shipping_method_id'], null);
  this.category_id = mercapiPick(raw, ['categoryId', 'category_id'], null);
  this.is_no_price = !!mercapiPick(raw, ['isNoPrice', 'is_no_price'], false);
}

SearchResultItem.prototype.full_item = function () {
  return this._mercapi.item(this.id_);
};

SearchResultItem.prototype.seller = function () {
  return this._mercapi.profile(this.seller_id);
};

Object.defineProperty(SearchResultItem.prototype, 'real_price', {
  get: function () {
    return this.is_no_price ? null : this.price;
  },
});

function Item(mercapi, raw) {
  this._mercapi = mercapi;
  this.id_ = mercapiPick(raw, ['id', 'id_'], '');
  this.seller = mercapiMapSeller(mercapiPick(raw, ['seller'], {}));
  this.status = mercapiPick(raw, ['status'], '');
  this.name = mercapiPick(raw, ['name'], '');
  this.price = mercapiPick(raw, ['price'], 0);
  this.description = mercapiPick(raw, ['description'], '');
  this.photos = mercapiPick(raw, ['photos'], []);
  this.photo_paths = mercapiPick(raw, ['photoPaths', 'photo_paths'], []);
  this.thumbnails = mercapiPick(raw, ['thumbnails'], []);
  this.item_category = mercapiMapItemCategorySummary(mercapiPick(raw, ['itemCategory', 'item_category'], {}));
  this.item_condition = mercapiMapIdName(mercapiPick(raw, ['itemCondition', 'item_condition'], {}));
  this.colors = (mercapiPick(raw, ['colors'], []) || []).map(mercapiMapColor);
  this.shipping_payer = mercapiMapShippingPayer(mercapiPick(raw, ['shippingPayer', 'shipping_payer'], {}));
  this.shipping_method = mercapiMapShippingMethod(mercapiPick(raw, ['shippingMethod', 'shipping_method'], {}));
  this.shipping_from_area = mercapiMapIdName(mercapiPick(raw, ['shippingFromArea', 'shipping_from_area'], {}));
  this.shipping_duration = mercapiMapShippingDuration(mercapiPick(raw, ['shippingDuration', 'shipping_duration'], {}));
  this.shipping_class = mercapiMapShippingClass(mercapiPick(raw, ['shippingClass', 'shipping_class'], {}));
  this.num_likes = mercapiPick(raw, ['numLikes', 'num_likes'], 0);
  this.num_comments = mercapiPick(raw, ['numComments', 'num_comments'], 0);
  this.comments = (mercapiPick(raw, ['comments'], []) || []).map(mercapiMapComment);
  this.updated = mercapiToDate(mercapiPick(raw, ['updated', 'updatedAt']));
  this.created = mercapiToDate(mercapiPick(raw, ['created', 'createdAt']));
  this.pager_id = mercapiPick(raw, ['pagerId', 'pager_id'], null);
  this.liked = !!mercapiPick(raw, ['liked'], false);
  this.checksum = mercapiPick(raw, ['checksum'], '');
  this.is_dynamic_shipping_fee = !!mercapiPick(raw, ['isDynamicShippingFee', 'is_dynamic_shipping_fee'], false);
  this.application_attributes = mercapiPick(raw, ['applicationAttributes', 'application_attributes'], {});
  this.is_shop_item = mercapiPick(raw, ['isShopItem', 'is_shop_item'], '');
  this.is_anonymous_shipping = !!mercapiPick(raw, ['isAnonymousShipping', 'is_anonymous_shipping'], false);
  this.is_web_visible = !!mercapiPick(raw, ['isWebVisible', 'is_web_visible'], false);
  this.is_offerable = !!mercapiPick(raw, ['isOfferable', 'is_offerable'], false);
  this.is_organizational_user = !!mercapiPick(raw, ['isOrganizationalUser', 'is_organizational_user'], false);
  this.organizational_user_status = mercapiPick(raw, ['organizationalUserStatus', 'organizational_user_status'], '');
  this.is_stock_item = !!mercapiPick(raw, ['isStockItem', 'is_stock_item'], false);
  this.is_cancelable = !!mercapiPick(raw, ['isCancelable', 'is_cancelable'], false);
  this.shipped_by_worker = !!mercapiPick(raw, ['shippedByWorker', 'shipped_by_worker'], false);
  this.has_additional_service = !!mercapiPick(raw, ['hasAdditionalService', 'has_additional_service'], false);
  this.has_like_list = !!mercapiPick(raw, ['hasLikeList', 'has_like_list'], false);
  this.is_offerable_v2 = !!mercapiPick(raw, ['isOfferableV2', 'is_offerable_v2'], false);
}

function Profile(mercapi, raw) {
  this._mercapi = mercapi;
  this.id_ = mercapiPick(raw, ['id', 'id_'], '');
  this.name = mercapiPick(raw, ['name'], '');
  this.photo_url = mercapiPick(raw, ['photoUrl', 'photo_url'], '');
  this.photo_thumbnail_url = mercapiPick(raw, ['photoThumbnailUrl', 'photo_thumbnail_url'], '');
  this.register_sms_confirmation = mercapiPick(raw, ['registerSmsConfirmation', 'register_sms_confirmation'], '');
  this.ratings = mercapiMapRatings(mercapiPick(raw, ['ratings'], {}));
  this.polarized_ratings = mercapiMapSimpleRatings(mercapiPick(raw, ['polarizedRatings', 'polarized_ratings'], {}));
  this.num_ratings = mercapiPick(raw, ['numRatings', 'num_ratings'], 0);
  this.star_rating_score = mercapiPick(raw, ['starRatingScore', 'star_rating_score'], 0);
  this.is_followable = !!mercapiPick(raw, ['isFollowable', 'is_followable'], false);
  this.is_blocked = !!mercapiPick(raw, ['isBlocked', 'is_blocked'], false);
  this.following_count = mercapiPick(raw, ['followingCount', 'following_count'], 0);
  this.follower_count = mercapiPick(raw, ['followerCount', 'follower_count'], 0);
  this.score = mercapiPick(raw, ['score'], 0);
  this.created = mercapiToDate(mercapiPick(raw, ['created', 'createdAt']));
  this.proper = !!mercapiPick(raw, ['proper'], false);
  this.introduction = mercapiPick(raw, ['introduction'], '');
  this.is_official = !!mercapiPick(raw, ['isOfficial', 'is_official'], false);
  this.num_sell_items = mercapiPick(raw, ['numSellItems', 'num_sell_items'], 0);
  this.num_ticket = mercapiPick(raw, ['numTicket', 'num_ticket'], 0);
  this.bounce_mail_flag = mercapiPick(raw, ['bounceMailFlag', 'bounce_mail_flag'], '');
  this.current_point = mercapiPick(raw, ['currentPoint', 'current_point'], 0);
  this.current_sales = mercapiPick(raw, ['currentSales', 'current_sales'], 0);
  this.is_organizational_user = !!mercapiPick(raw, ['isOrganizationalUser', 'is_organizational_user'], false);
}

Profile.prototype.items = function () {
  return this._mercapi.items(String(this.id_));
};

function SellerItem(mercapi, raw) {
  this._mercapi = mercapi;
  this.id_ = mercapiPick(raw, ['id', 'id_'], '');
  this.seller_id = String(mercapiPick(raw, ['sellerId', 'seller_id'], ''));
  this.status = mercapiPick(raw, ['status'], '');
  this.name = mercapiPick(raw, ['name'], '');
  this.price = mercapiPick(raw, ['price'], 0);
  this.thumbnails = mercapiPick(raw, ['thumbnails'], []);
  this.root_category_id = mercapiPick(raw, ['rootCategoryId', 'root_category_id'], null);
  this.num_likes = mercapiPick(raw, ['numLikes', 'num_likes'], 0);
  this.num_comments = mercapiPick(raw, ['numComments', 'num_comments'], 0);
  this.created = mercapiToDate(mercapiPick(raw, ['created', 'createdAt']));
  this.updated = mercapiToDate(mercapiPick(raw, ['updated', 'updatedAt']));
  this.item_category = mercapiMapItemCategorySummary(mercapiPick(raw, ['itemCategory', 'item_category'], null));
  this.shipping_from_area = mercapiMapIdName(mercapiPick(raw, ['shippingFromArea', 'shipping_from_area'], {}));
}

SellerItem.prototype.full_item = function () {
  return this._mercapi.item(this.id_);
};

function Items(items) {
  this.items = items || [];
}

function mercapiMapSearchResults(mercapi, raw, requestData) {
  raw = raw || {};
  var metaRaw = raw.meta || {};
  var itemsRaw = raw.data || [];
  var meta = {
    next_page_token: mercapiPick(metaRaw, ['nextPageToken', 'next_page_token'], ''),
    prev_page_token: mercapiPick(metaRaw, ['prevPageToken', 'prev_page_token'], ''),
    num_found: mercapiPick(metaRaw, ['numFound', 'num_found'], 0),
  };
  var items = itemsRaw.map(function (i) {
    return new SearchResultItem(mercapi, i);
  });
  return new SearchResults(mercapi, meta, items, requestData);
}

function mercapiMapItem(mercapi, raw) {
  return new Item(mercapi, raw || {});
}

function mercapiMapProfile(mercapi, raw) {
  return new Profile(mercapi, raw || {});
}

function mercapiMapItems(mercapi, raw) {
  var items = (mercapiPick(raw, ['data', 'items'], []) || []).map(function (i) {
    return new SellerItem(mercapi, i);
  });
  return new Items(items);
}

function mercapiMapSeller(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    name: mercapiPick(raw, ['name'], ''),
    photo: mercapiPick(raw, ['photo'], ''),
    photo_thumbnail: mercapiPick(raw, ['photoThumbnail', 'photo_thumbnail'], ''),
    register_sms_confirmation: mercapiPick(raw, ['registerSmsConfirmation', 'register_sms_confirmation'], ''),
    register_sms_confirmation_at: mercapiToDate(mercapiPick(raw, ['registerSmsConfirmationAt', 'register_sms_confirmation_at'])),
    created: mercapiToDate(mercapiPick(raw, ['created', 'createdAt'])),
    num_sell_items: mercapiPick(raw, ['numSellItems', 'num_sell_items'], 0),
    ratings: mercapiMapRatings(mercapiPick(raw, ['ratings'], {})),
    num_ratings: mercapiPick(raw, ['numRatings', 'num_ratings'], 0),
    score: mercapiPick(raw, ['score'], 0),
    is_official: !!mercapiPick(raw, ['isOfficial', 'is_official'], false),
    quick_shipper: !!mercapiPick(raw, ['quickShipper', 'quick_shipper'], false),
    star_rating_score: mercapiPick(raw, ['starRatingScore', 'star_rating_score'], 0),
  };
}

function mercapiMapIdName(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    name: mercapiPick(raw, ['name'], ''),
  };
}

function mercapiMapColor(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    name: mercapiPick(raw, ['name'], ''),
    rgb: mercapiPick(raw, ['rgb'], 0),
    rgb_code: '0x' + mercapiLeftPadHex(mercapiPick(raw, ['rgb'], 0).toString(16), 6),
  };
}

function mercapiMapShippingPayer(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    name: mercapiPick(raw, ['name'], ''),
    code: mercapiPick(raw, ['code'], ''),
  };
}

function mercapiMapShippingMethod(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    name: mercapiPick(raw, ['name'], ''),
    is_deprecated: !!mercapiPick(raw, ['isDeprecated', 'is_deprecated'], false),
  };
}

function mercapiMapShippingDuration(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    name: mercapiPick(raw, ['name'], ''),
    min_days: mercapiPick(raw, ['minDays', 'min_days'], null),
    max_days: mercapiPick(raw, ['maxDays', 'max_days'], null),
  };
}

function mercapiMapShippingClass(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    fee: mercapiPick(raw, ['fee'], 0),
    icon_id: mercapiPick(raw, ['iconId', 'icon_id'], null),
    pickup_fee: mercapiPick(raw, ['pickupFee', 'pickup_fee'], 0),
    shipping_fee: mercapiPick(raw, ['shippingFee', 'shipping_fee'], 0),
    total_fee: mercapiPick(raw, ['totalFee', 'total_fee'], 0),
    is_pickup: !!mercapiPick(raw, ['isPickup', 'is_pickup'], false),
  };
}

function mercapiMapComment(raw) {
  raw = raw || {};
  var user = mercapiPick(raw, ['user'], {});
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    message: mercapiPick(raw, ['message'], ''),
    user: {
      id_: mercapiPick(user, ['id', 'id_'], null),
      name: mercapiPick(user, ['name'], ''),
      photo: mercapiPick(user, ['photo'], ''),
      photo_thumbnail: mercapiPick(user, ['photoThumbnail', 'photo_thumbnail'], ''),
    },
    created: mercapiToDate(mercapiPick(raw, ['created', 'createdAt'])),
  };
}

function mercapiMapItemCategorySummary(raw) {
  raw = raw || {};
  return {
    id_: mercapiPick(raw, ['id', 'id_'], null),
    name: mercapiPick(raw, ['name'], ''),
    display_order: mercapiPick(raw, ['displayOrder', 'display_order'], null),
    parent_category_id: mercapiPick(raw, ['parentCategoryId', 'parent_category_id'], null),
    parent_category_name: mercapiPick(raw, ['parentCategoryName', 'parent_category_name'], ''),
    root_category_id: mercapiPick(raw, ['rootCategoryId', 'root_category_id'], null),
    root_category_name: mercapiPick(raw, ['rootCategoryName', 'root_category_name'], ''),
  };
}

function mercapiMapRatings(raw) {
  raw = raw || {};
  return {
    good: mercapiPick(raw, ['good'], 0),
    normal: mercapiPick(raw, ['normal'], 0),
    bad: mercapiPick(raw, ['bad'], 0),
  };
}

function mercapiMapSimpleRatings(raw) {
  raw = raw || {};
  return {
    good: mercapiPick(raw, ['good'], 0),
    bad: mercapiPick(raw, ['bad'], 0),
  };
}

function mercapiPick(obj, keys, defaultValue) {
  if (!obj || typeof obj !== 'object') return defaultValue;
  for (var i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(obj, keys[i])) {
      return obj[keys[i]];
    }
  }
  return defaultValue;
}

function mercapiToDate(value) {
  if (value === undefined || value === null || value === '') return null;
  var n = Number(value);
  if (!isNaN(n)) return new Date(n * 1000);
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function mercapiAssign(target, source) {
  for (var k in source) {
    if (Object.prototype.hasOwnProperty.call(source, k)) {
      target[k] = source[k];
    }
  }
  return target;
}

function mercapiBuildUrl(base, params) {
  var keys = Object.keys(params || {});
  if (!keys.length) return base;
  var q = keys.map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
  }).join('&');
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + q;
}

function mercapiUuidV4() {
  var bytes = mercapiRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  var h = mercapiBytesToHex(bytes);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

function mercapiRandomHex(length) {
  var bytes = mercapiRandomBytes(Math.ceil(length / 2));
  return mercapiBytesToHex(bytes).slice(0, length);
}

function mercapiRandomBytes(length) {
  var out = [];
  while (out.length < length) {
    var uuidHex = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i < uuidHex.length && out.length < length; i += 2) {
      out.push(parseInt(uuidHex.substring(i, i + 2), 16));
    }
  }
  return out;
}

function mercapiBytesToHex(bytes) {
  return bytes.map(function (b) {
    var x = (b & 0xff).toString(16);
    return x.length === 1 ? '0' + x : x;
  }).join('');
}

function mercapiLeftPadHex(hex, length) {
  var out = hex;
  while (out.length < length) out = '0' + out;
  return out;
}

function mercapiGenerateDpop(url, method, keyPair, extraPayload) {
  var header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: {
      kty: 'EC',
      crv: 'P-256',
      x: mercapiBase64UrlEncode(mercapiBigIntToBytes(keyPair.publicKey.x, 32)),
      y: mercapiBase64UrlEncode(mercapiBigIntToBytes(keyPair.publicKey.y, 32)),
    },
  };

  var payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: mercapiUuidV4(),
    htu: url,
    htm: method,
  };
  if (extraPayload) {
    for (var k in extraPayload) {
      if (Object.prototype.hasOwnProperty.call(extraPayload, k)) {
        payload[k] = extraPayload[k];
      }
    }
  }

  var encodedHeader = mercapiBase64UrlEncodeString(JSON.stringify(header));
  var encodedPayload = mercapiBase64UrlEncodeString(JSON.stringify(payload));
  var signingInput = encodedHeader + '.' + encodedPayload;
  var hash = mercapiSha256Bytes(signingInput);
  var signature = mercapiEcdsaSignP256(hash, keyPair.privateKey);
  return signingInput + '.' + mercapiBase64UrlEncode(signature);
}

function mercapiSha256Bytes(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)
    .map(function (x) { return x < 0 ? x + 256 : x; });
}

function mercapiBase64UrlEncodeString(str) {
  var bytes = Utilities.newBlob(str).getBytes().map(function (x) { return x < 0 ? x + 256 : x; });
  return mercapiBase64UrlEncode(bytes);
}

function mercapiBase64UrlEncode(bytes) {
  var signed = bytes.map(function (x) { return x > 127 ? x - 256 : x; });
  return Utilities.base64EncodeWebSafe(signed).replace(/=+$/g, '');
}

var MERCAPI_P256 = {
  p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  a: BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
  b: BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
  gx: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
  gy: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
  n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
};

function mercapiGenerateP256KeyPair() {
  var n = MERCAPI_P256.n;
  var d = 0n;
  while (d <= 0n || d >= n) {
    d = mercapiBytesToBigInt(mercapiRandomBytes(32));
  }
  var pub = mercapiEcScalarMult(d, { x: MERCAPI_P256.gx, y: MERCAPI_P256.gy, inf: false });
  return {
    privateKey: d,
    publicKey: pub,
  };
}

function mercapiEcdsaSignP256(hashBytes, privateKey) {
  var z = mercapiBytesToBigInt(hashBytes);
  var n = MERCAPI_P256.n;
  var r = 0n;
  var s = 0n;

  while (r === 0n || s === 0n) {
    var k = 0n;
    while (k <= 0n || k >= n) {
      k = mercapiBytesToBigInt(mercapiRandomBytes(32));
    }
    var p = mercapiEcScalarMult(k, { x: MERCAPI_P256.gx, y: MERCAPI_P256.gy, inf: false });
    r = mercapiMod(p.x, n);
    if (r === 0n) continue;
    var kinv = mercapiModInv(k, n);
    s = mercapiMod(kinv * (z + r * privateKey), n);
  }

  var rb = mercapiBigIntToBytes(r, 32);
  var sb = mercapiBigIntToBytes(s, 32);
  return rb.concat(sb);
}

function mercapiBytesToBigInt(bytes) {
  var hex = mercapiBytesToHex(bytes);
  if (!hex) return 0n;
  return BigInt('0x' + hex);
}

function mercapiBigIntToBytes(x, length) {
  var hex = x.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  var bytes = [];
  for (var i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  while (bytes.length < length) {
    bytes.unshift(0);
  }
  if (bytes.length > length) {
    bytes = bytes.slice(bytes.length - length);
  }
  return bytes;
}

function mercapiMod(a, m) {
  var r = a % m;
  return r >= 0n ? r : r + m;
}

function mercapiModInv(a, m) {
  var t = 0n;
  var newT = 1n;
  var r = m;
  var newR = mercapiMod(a, m);
  while (newR !== 0n) {
    var q = r / newR;
    var tmpT = t - q * newT;
    t = newT;
    newT = tmpT;
    var tmpR = r - q * newR;
    r = newR;
    newR = tmpR;
  }
  if (r > 1n) throw new MercapiError('Value is not invertible');
  if (t < 0n) t += m;
  return t;
}

function mercapiEcPointAdd(p, q) {
  if (p.inf) return q;
  if (q.inf) return p;
  var prime = MERCAPI_P256.p;
  if (p.x === q.x) {
    if (mercapiMod(p.y + q.y, prime) === 0n) return { inf: true };
    return mercapiEcPointDouble(p);
  }
  var lambda = mercapiMod((q.y - p.y) * mercapiModInv(q.x - p.x, prime), prime);
  var rx = mercapiMod(lambda * lambda - p.x - q.x, prime);
  var ry = mercapiMod(lambda * (p.x - rx) - p.y, prime);
  return { x: rx, y: ry, inf: false };
}

function mercapiEcPointDouble(p) {
  if (p.inf) return p;
  if (p.y === 0n) return { inf: true };
  var prime = MERCAPI_P256.p;
  var lambda = mercapiMod(
    (3n * p.x * p.x + MERCAPI_P256.a) * mercapiModInv(2n * p.y, prime),
    prime
  );
  var rx = mercapiMod(lambda * lambda - 2n * p.x, prime);
  var ry = mercapiMod(lambda * (p.x - rx) - p.y, prime);
  return { x: rx, y: ry, inf: false };
}

function mercapiEcScalarMult(k, p) {
  var n = k;
  var result = { inf: true };
  var addend = p;
  while (n > 0n) {
    if (n & 1n) {
      result = mercapiEcPointAdd(result, addend);
    }
    addend = mercapiEcPointDouble(addend);
    n >>= 1n;
  }
  return result;
}
