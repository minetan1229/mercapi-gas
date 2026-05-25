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

// BigInteger.js (MIT License)
// https://github.com/peterolson/BigInteger.js
var bigInt = (function (undefined) {
    "use strict";

    var BASE = 1e7,
        LOG_BASE = 7,
        MAX_INT = 9007199254740992,
        MAX_INT_ARR = smallToArray(MAX_INT),
        DEFAULT_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

    var bigIntCtor = (typeof globalThis !== "undefined" && globalThis["BigInt"]) ||
        (typeof self !== "undefined" && self["BigInt"]) ||
        (typeof window !== "undefined" && window["BigInt"]) ||
        (typeof global !== "undefined" && global["BigInt"]) ||
        null;
    var supportsNativeBigInt = typeof bigIntCtor === "function";
    function requireBigInt(value) {
        if (!supportsNativeBigInt) {
            throw new Error("BigInt is not supported in this runtime.");
        }
        return bigIntCtor(value);
    }

    function Integer(v, radix, alphabet, caseSensitive) {
        if (typeof v === "undefined") return Integer[0];
        if (typeof radix !== "undefined") return +radix === 10 && !alphabet ? parseValue(v) : parseBase(v, radix, alphabet, caseSensitive);
        return parseValue(v);
    }

    function BigInteger(value, sign) {
        this.value = value;
        this.sign = sign;
        this.isSmall = false;
    }
    BigInteger.prototype = Object.create(Integer.prototype);

    function SmallInteger(value) {
        this.value = value;
        this.sign = value < 0;
        this.isSmall = true;
    }
    SmallInteger.prototype = Object.create(Integer.prototype);

    function NativeBigInt(value) {
        this.value = value;
    }
    NativeBigInt.prototype = Object.create(Integer.prototype);

    function isPrecise(n) {
        return -MAX_INT < n && n < MAX_INT;
    }

    function smallToArray(n) { // For performance reasons doesn't reference BASE, need to change this function if BASE changes
        if (n < 1e7)
            return [n];
        if (n < 1e14)
            return [n % 1e7, Math.floor(n / 1e7)];
        return [n % 1e7, Math.floor(n / 1e7) % 1e7, Math.floor(n / 1e14)];
    }

    function arrayToSmall(arr) { // If BASE changes this function may need to change
        trim(arr);
        var length = arr.length;
        if (length < 4 && compareAbs(arr, MAX_INT_ARR) < 0) {
            switch (length) {
                case 0: return 0;
                case 1: return arr[0];
                case 2: return arr[0] + arr[1] * BASE;
                default: return arr[0] + (arr[1] + arr[2] * BASE) * BASE;
            }
        }
        return arr;
    }

    function trim(v) {
        var i = v.length;
        while (v[--i] === 0);
        v.length = i + 1;
    }

    function createArray(length) { // function shamelessly stolen from Yaffle's library https://github.com/Yaffle/BigInteger
        var x = new Array(length);
        var i = -1;
        while (++i < length) {
            x[i] = 0;
        }
        return x;
    }

    function truncate(n) {
        if (n > 0) return Math.floor(n);
        return Math.ceil(n);
    }

    function add(a, b) { // assumes a and b are arrays with a.length >= b.length
        var l_a = a.length,
            l_b = b.length,
            r = new Array(l_a),
            carry = 0,
            base = BASE,
            sum, i;
        for (i = 0; i < l_b; i++) {
            sum = a[i] + b[i] + carry;
            carry = sum >= base ? 1 : 0;
            r[i] = sum - carry * base;
        }
        while (i < l_a) {
            sum = a[i] + carry;
            carry = sum === base ? 1 : 0;
            r[i++] = sum - carry * base;
        }
        if (carry > 0) r.push(carry);
        return r;
    }

    function addAny(a, b) {
        if (a.length >= b.length) return add(a, b);
        return add(b, a);
    }

    function addSmall(a, carry) { // assumes a is array, carry is number with 0 <= carry < MAX_INT
        var l = a.length,
            r = new Array(l),
            base = BASE,
            sum, i;
        for (i = 0; i < l; i++) {
            sum = a[i] - base + carry;
            carry = Math.floor(sum / base);
            r[i] = sum - carry * base;
            carry += 1;
        }
        while (carry > 0) {
            r[i++] = carry % base;
            carry = Math.floor(carry / base);
        }
        return r;
    }

    BigInteger.prototype.add = function (v) {
        var n = parseValue(v);
        if (this.sign !== n.sign) {
            return this.subtract(n.negate());
        }
        var a = this.value, b = n.value;
        if (n.isSmall) {
            return new BigInteger(addSmall(a, Math.abs(b)), this.sign);
        }
        return new BigInteger(addAny(a, b), this.sign);
    };
    BigInteger.prototype.plus = BigInteger.prototype.add;

    SmallInteger.prototype.add = function (v) {
        var n = parseValue(v);
        var a = this.value;
        if (a < 0 !== n.sign) {
            return this.subtract(n.negate());
        }
        var b = n.value;
        if (n.isSmall) {
            if (isPrecise(a + b)) return new SmallInteger(a + b);
            b = smallToArray(Math.abs(b));
        }
        return new BigInteger(addSmall(b, Math.abs(a)), a < 0);
    };
    SmallInteger.prototype.plus = SmallInteger.prototype.add;

    NativeBigInt.prototype.add = function (v) {
        return new NativeBigInt(this.value + parseValue(v).value);
    }
    NativeBigInt.prototype.plus = NativeBigInt.prototype.add;

    function subtract(a, b) { // assumes a and b are arrays with a >= b
        var a_l = a.length,
            b_l = b.length,
            r = new Array(a_l),
            borrow = 0,
            base = BASE,
            i, difference;
        for (i = 0; i < b_l; i++) {
            difference = a[i] - borrow - b[i];
            if (difference < 0) {
                difference += base;
                borrow = 1;
            } else borrow = 0;
            r[i] = difference;
        }
        for (i = b_l; i < a_l; i++) {
            difference = a[i] - borrow;
            if (difference < 0) difference += base;
            else {
                r[i++] = difference;
                break;
            }
            r[i] = difference;
        }
        for (; i < a_l; i++) {
            r[i] = a[i];
        }
        trim(r);
        return r;
    }

    function subtractAny(a, b, sign) {
        var value;
        if (compareAbs(a, b) >= 0) {
            value = subtract(a, b);
        } else {
            value = subtract(b, a);
            sign = !sign;
        }
        value = arrayToSmall(value);
        if (typeof value === "number") {
            if (sign) value = -value;
            return new SmallInteger(value);
        }
        return new BigInteger(value, sign);
    }

    function subtractSmall(a, b, sign) { // assumes a is array, b is number with 0 <= b < MAX_INT
        var l = a.length,
            r = new Array(l),
            carry = -b,
            base = BASE,
            i, difference;
        for (i = 0; i < l; i++) {
            difference = a[i] + carry;
            carry = Math.floor(difference / base);
            difference %= base;
            r[i] = difference < 0 ? difference + base : difference;
        }
        r = arrayToSmall(r);
        if (typeof r === "number") {
            if (sign) r = -r;
            return new SmallInteger(r);
        } return new BigInteger(r, sign);
    }

    BigInteger.prototype.subtract = function (v) {
        var n = parseValue(v);
        if (this.sign !== n.sign) {
            return this.add(n.negate());
        }
        var a = this.value, b = n.value;
        if (n.isSmall)
            return subtractSmall(a, Math.abs(b), this.sign);
        return subtractAny(a, b, this.sign);
    };
    BigInteger.prototype.minus = BigInteger.prototype.subtract;

    SmallInteger.prototype.subtract = function (v) {
        var n = parseValue(v);
        var a = this.value;
        if (a < 0 !== n.sign) {
            return this.add(n.negate());
        }
        var b = n.value;
        if (n.isSmall) {
            return new SmallInteger(a - b);
        }
        return subtractSmall(b, Math.abs(a), a >= 0);
    };
    SmallInteger.prototype.minus = SmallInteger.prototype.subtract;

    NativeBigInt.prototype.subtract = function (v) {
        return new NativeBigInt(this.value - parseValue(v).value);
    }
    NativeBigInt.prototype.minus = NativeBigInt.prototype.subtract;

    BigInteger.prototype.negate = function () {
        return new BigInteger(this.value, !this.sign);
    };
    SmallInteger.prototype.negate = function () {
        var sign = this.sign;
        var small = new SmallInteger(-this.value);
        small.sign = !sign;
        return small;
    };
    NativeBigInt.prototype.negate = function () {
        return new NativeBigInt(-this.value);
    }

    BigInteger.prototype.abs = function () {
        return new BigInteger(this.value, false);
    };
    SmallInteger.prototype.abs = function () {
        return new SmallInteger(Math.abs(this.value));
    };
    NativeBigInt.prototype.abs = function () {
        return new NativeBigInt(this.value >= 0 ? this.value : -this.value);
    }


    function multiplyLong(a, b) {
        var a_l = a.length,
            b_l = b.length,
            l = a_l + b_l,
            r = createArray(l),
            base = BASE,
            product, carry, i, a_i, b_j;
        for (i = 0; i < a_l; ++i) {
            a_i = a[i];
            for (var j = 0; j < b_l; ++j) {
                b_j = b[j];
                product = a_i * b_j + r[i + j];
                carry = Math.floor(product / base);
                r[i + j] = product - carry * base;
                r[i + j + 1] += carry;
            }
        }
        trim(r);
        return r;
    }

    function multiplySmall(a, b) { // assumes a is array, b is number with |b| < BASE
        var l = a.length,
            r = new Array(l),
            base = BASE,
            carry = 0,
            product, i;
        for (i = 0; i < l; i++) {
            product = a[i] * b + carry;
            carry = Math.floor(product / base);
            r[i] = product - carry * base;
        }
        while (carry > 0) {
            r[i++] = carry % base;
            carry = Math.floor(carry / base);
        }
        return r;
    }

    function shiftLeft(x, n) {
        var r = [];
        while (n-- > 0) r.push(0);
        return r.concat(x);
    }

    function multiplyKaratsuba(x, y) {
        var n = Math.max(x.length, y.length);

        if (n <= 30) return multiplyLong(x, y);
        n = Math.ceil(n / 2);

        var b = x.slice(n),
            a = x.slice(0, n),
            d = y.slice(n),
            c = y.slice(0, n);

        var ac = multiplyKaratsuba(a, c),
            bd = multiplyKaratsuba(b, d),
            abcd = multiplyKaratsuba(addAny(a, b), addAny(c, d));

        var product = addAny(addAny(ac, shiftLeft(subtract(subtract(abcd, ac), bd), n)), shiftLeft(bd, 2 * n));
        trim(product);
        return product;
    }

    // The following function is derived from a surface fit of a graph plotting the performance difference
    // between long multiplication and karatsuba multiplication versus the lengths of the two arrays.
    function useKaratsuba(l1, l2) {
        return -0.012 * l1 - 0.012 * l2 + 0.000015 * l1 * l2 > 0;
    }

    BigInteger.prototype.multiply = function (v) {
        var n = parseValue(v),
            a = this.value, b = n.value,
            sign = this.sign !== n.sign,
            abs;
        if (n.isSmall) {
            if (b === 0) return Integer[0];
            if (b === 1) return this;
            if (b === -1) return this.negate();
            abs = Math.abs(b);
            if (abs < BASE) {
                return new BigInteger(multiplySmall(a, abs), sign);
            }
            b = smallToArray(abs);
        }
        if (useKaratsuba(a.length, b.length)) // Karatsuba is only faster for certain array sizes
            return new BigInteger(multiplyKaratsuba(a, b), sign);
        return new BigInteger(multiplyLong(a, b), sign);
    };

    BigInteger.prototype.times = BigInteger.prototype.multiply;

    function multiplySmallAndArray(a, b, sign) { // a >= 0
        if (a < BASE) {
            return new BigInteger(multiplySmall(b, a), sign);
        }
        return new BigInteger(multiplyLong(b, smallToArray(a)), sign);
    }
    SmallInteger.prototype._multiplyBySmall = function (a) {
        if (isPrecise(a.value * this.value)) {
            return new SmallInteger(a.value * this.value);
        }
        return multiplySmallAndArray(Math.abs(a.value), smallToArray(Math.abs(this.value)), this.sign !== a.sign);
    };
    BigInteger.prototype._multiplyBySmall = function (a) {
        if (a.value === 0) return Integer[0];
        if (a.value === 1) return this;
        if (a.value === -1) return this.negate();
        return multiplySmallAndArray(Math.abs(a.value), this.value, this.sign !== a.sign);
    };
    SmallInteger.prototype.multiply = function (v) {
        return parseValue(v)._multiplyBySmall(this);
    };
    SmallInteger.prototype.times = SmallInteger.prototype.multiply;

    NativeBigInt.prototype.multiply = function (v) {
        return new NativeBigInt(this.value * parseValue(v).value);
    }
    NativeBigInt.prototype.times = NativeBigInt.prototype.multiply;

    function square(a) {
        //console.assert(2 * BASE * BASE < MAX_INT);
        var l = a.length,
            r = createArray(l + l),
            base = BASE,
            product, carry, i, a_i, a_j;
        for (i = 0; i < l; i++) {
            a_i = a[i];
            carry = 0 - a_i * a_i;
            for (var j = i; j < l; j++) {
                a_j = a[j];
                product = 2 * (a_i * a_j) + r[i + j] + carry;
                carry = Math.floor(product / base);
                r[i + j] = product - carry * base;
            }
            r[i + l] = carry;
        }
        trim(r);
        return r;
    }

    BigInteger.prototype.square = function () {
        return new BigInteger(square(this.value), false);
    };

    SmallInteger.prototype.square = function () {
        var value = this.value * this.value;
        if (isPrecise(value)) return new SmallInteger(value);
        return new BigInteger(square(smallToArray(Math.abs(this.value))), false);
    };

    NativeBigInt.prototype.square = function (v) {
        return new NativeBigInt(this.value * this.value);
    }

    function divMod1(a, b) { // Left over from previous version. Performs faster than divMod2 on smaller input sizes.
        var a_l = a.length,
            b_l = b.length,
            base = BASE,
            result = createArray(b.length),
            divisorMostSignificantDigit = b[b_l - 1],
            // normalization
            lambda = Math.ceil(base / (2 * divisorMostSignificantDigit)),
            remainder = multiplySmall(a, lambda),
            divisor = multiplySmall(b, lambda),
            quotientDigit, shift, carry, borrow, i, l, q;
        if (remainder.length <= a_l) remainder.push(0);
        divisor.push(0);
        divisorMostSignificantDigit = divisor[b_l - 1];
        for (shift = a_l - b_l; shift >= 0; shift--) {
            quotientDigit = base - 1;
            if (remainder[shift + b_l] !== divisorMostSignificantDigit) {
                quotientDigit = Math.floor((remainder[shift + b_l] * base + remainder[shift + b_l - 1]) / divisorMostSignificantDigit);
            }
            // quotientDigit <= base - 1
            carry = 0;
            borrow = 0;
            l = divisor.length;
            for (i = 0; i < l; i++) {
                carry += quotientDigit * divisor[i];
                q = Math.floor(carry / base);
                borrow += remainder[shift + i] - (carry - q * base);
                carry = q;
                if (borrow < 0) {
                    remainder[shift + i] = borrow + base;
                    borrow = -1;
                } else {
                    remainder[shift + i] = borrow;
                    borrow = 0;
                }
            }
            while (borrow !== 0) {
                quotientDigit -= 1;
                carry = 0;
                for (i = 0; i < l; i++) {
                    carry += remainder[shift + i] - base + divisor[i];
                    if (carry < 0) {
                        remainder[shift + i] = carry + base;
                        carry = 0;
                    } else {
                        remainder[shift + i] = carry;
                        carry = 1;
                    }
                }
                borrow += carry;
            }
            result[shift] = quotientDigit;
        }
        // denormalization
        remainder = divModSmall(remainder, lambda)[0];
        return [arrayToSmall(result), arrayToSmall(remainder)];
    }

    function divMod2(a, b) { // Implementation idea shamelessly stolen from Silent Matt's library http://silentmatt.com/biginteger/
        // Performs faster than divMod1 on larger input sizes.
        var a_l = a.length,
            b_l = b.length,
            result = [],
            part = [],
            base = BASE,
            guess, xlen, highx, highy, check;
        while (a_l) {
            part.unshift(a[--a_l]);
            trim(part);
            if (compareAbs(part, b) < 0) {
                result.push(0);
                continue;
            }
            xlen = part.length;
            highx = part[xlen - 1] * base + part[xlen - 2];
            highy = b[b_l - 1] * base + b[b_l - 2];
            if (xlen > b_l) {
                highx = (highx + 1) * base;
            }
            guess = Math.ceil(highx / highy);
            do {
                check = multiplySmall(b, guess);
                if (compareAbs(check, part) <= 0) break;
                guess--;
            } while (guess);
            result.push(guess);
            part = subtract(part, check);
        }
        result.reverse();
        return [arrayToSmall(result), arrayToSmall(part)];
    }

    function divModSmall(value, lambda) {
        var length = value.length,
            quotient = createArray(length),
            base = BASE,
            i, q, remainder, divisor;
        remainder = 0;
        for (i = length - 1; i >= 0; --i) {
            divisor = remainder * base + value[i];
            q = truncate(divisor / lambda);
            remainder = divisor - q * lambda;
            quotient[i] = q | 0;
        }
        return [quotient, remainder | 0];
    }

    function divModAny(self, v) {
        var value, n = parseValue(v);
        if (supportsNativeBigInt) {
            return [new NativeBigInt(self.value / n.value), new NativeBigInt(self.value % n.value)];
        }
        var a = self.value, b = n.value;
        var quotient;
        if (b === 0) throw new Error("Cannot divide by zero");
        if (self.isSmall) {
            if (n.isSmall) {
                return [new SmallInteger(truncate(a / b)), new SmallInteger(a % b)];
            }
            return [Integer[0], self];
        }
        if (n.isSmall) {
            if (b === 1) return [self, Integer[0]];
            if (b === -1) return [self.negate(), Integer[0]];
            var abs = Math.abs(b);
            if (abs < BASE) {
                value = divModSmall(a, abs);
                quotient = arrayToSmall(value[0]);
                var remainder = value[1];
                if (self.sign) remainder = -remainder;
                if (typeof quotient === "number") {
                    if (self.sign !== n.sign) quotient = -quotient;
                    return [new SmallInteger(quotient), new SmallInteger(remainder)];
                }
                return [new BigInteger(quotient, self.sign !== n.sign), new SmallInteger(remainder)];
            }
            b = smallToArray(abs);
        }
        var comparison = compareAbs(a, b);
        if (comparison === -1) return [Integer[0], self];
        if (comparison === 0) return [Integer[self.sign === n.sign ? 1 : -1], Integer[0]];

        // divMod1 is faster on smaller input sizes
        if (a.length + b.length <= 200)
            value = divMod1(a, b);
        else value = divMod2(a, b);

        quotient = value[0];
        var qSign = self.sign !== n.sign,
            mod = value[1],
            mSign = self.sign;
        if (typeof quotient === "number") {
            if (qSign) quotient = -quotient;
            quotient = new SmallInteger(quotient);
        } else quotient = new BigInteger(quotient, qSign);
        if (typeof mod === "number") {
            if (mSign) mod = -mod;
            mod = new SmallInteger(mod);
        } else mod = new BigInteger(mod, mSign);
        return [quotient, mod];
    }

    BigInteger.prototype.divmod = function (v) {
        var result = divModAny(this, v);
        return {
            quotient: result[0],
            remainder: result[1]
        };
    };
    NativeBigInt.prototype.divmod = SmallInteger.prototype.divmod = BigInteger.prototype.divmod;


    BigInteger.prototype.divide = function (v) {
        return divModAny(this, v)[0];
    };
    NativeBigInt.prototype.over = NativeBigInt.prototype.divide = function (v) {
        return new NativeBigInt(this.value / parseValue(v).value);
    };
    SmallInteger.prototype.over = SmallInteger.prototype.divide = BigInteger.prototype.over = BigInteger.prototype.divide;

    BigInteger.prototype.mod = function (v) {
        return divModAny(this, v)[1];
    };
    NativeBigInt.prototype.mod = NativeBigInt.prototype.remainder = function (v) {
        return new NativeBigInt(this.value % parseValue(v).value);
    };
    SmallInteger.prototype.remainder = SmallInteger.prototype.mod = BigInteger.prototype.remainder = BigInteger.prototype.mod;

    BigInteger.prototype.pow = function (v) {
        var n = parseValue(v),
            a = this.value,
            b = n.value,
            value, x, y;
        if (b === 0) return Integer[1];
        if (a === 0) return Integer[0];
        if (a === 1) return Integer[1];
        if (a === -1) return n.isEven() ? Integer[1] : Integer[-1];
        if (n.sign) {
            return Integer[0];
        }
        if (!n.isSmall) throw new Error("The exponent " + n.toString() + " is too large.");
        if (this.isSmall) {
            if (isPrecise(value = Math.pow(a, b)))
                return new SmallInteger(truncate(value));
        }
        x = this;
        y = Integer[1];
        while (true) {
            if (b & 1 === 1) {
                y = y.times(x);
                --b;
            }
            if (b === 0) break;
            b /= 2;
            x = x.square();
        }
        return y;
    };
    SmallInteger.prototype.pow = BigInteger.prototype.pow;

    NativeBigInt.prototype.pow = function (v) {
        var n = parseValue(v);
        var a = this.value, b = n.value;
        var _0 = requireBigInt(0), _1 = requireBigInt(1), _2 = requireBigInt(2);
        if (b === _0) return Integer[1];
        if (a === _0) return Integer[0];
        if (a === _1) return Integer[1];
        if (a === requireBigInt(-1)) return n.isEven() ? Integer[1] : Integer[-1];
        if (n.isNegative()) return new NativeBigInt(_0);
        var x = this;
        var y = Integer[1];
        while (true) {
            if ((b & _1) === _1) {
                y = y.times(x);
                --b;
            }
            if (b === _0) break;
            b /= _2;
            x = x.square();
        }
        return y;
    }

    BigInteger.prototype.modPow = function (exp, mod) {
        exp = parseValue(exp);
        mod = parseValue(mod);
        if (mod.isZero()) throw new Error("Cannot take modPow with modulus 0");
        var r = Integer[1],
            base = this.mod(mod);
        if (exp.isNegative()) {
            exp = exp.multiply(Integer[-1]);
            base = base.modInv(mod);
        }
        while (exp.isPositive()) {
            if (base.isZero()) return Integer[0];
            if (exp.isOdd()) r = r.multiply(base).mod(mod);
            exp = exp.divide(2);
            base = base.square().mod(mod);
        }
        return r;
    };
    NativeBigInt.prototype.modPow = SmallInteger.prototype.modPow = BigInteger.prototype.modPow;

    function compareAbs(a, b) {
        if (a.length !== b.length) {
            return a.length > b.length ? 1 : -1;
        }
        for (var i = a.length - 1; i >= 0; i--) {
            if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
        }
        return 0;
    }

    BigInteger.prototype.compareAbs = function (v) {
        var n = parseValue(v),
            a = this.value,
            b = n.value;
        if (n.isSmall) return 1;
        return compareAbs(a, b);
    };
    SmallInteger.prototype.compareAbs = function (v) {
        var n = parseValue(v),
            a = Math.abs(this.value),
            b = n.value;
        if (n.isSmall) {
            b = Math.abs(b);
            return a === b ? 0 : a > b ? 1 : -1;
        }
        return -1;
    };
    NativeBigInt.prototype.compareAbs = function (v) {
        var a = this.value;
        var b = parseValue(v).value;
        a = a >= 0 ? a : -a;
        b = b >= 0 ? b : -b;
        return a === b ? 0 : a > b ? 1 : -1;
    }

    BigInteger.prototype.compare = function (v) {
        // See discussion about comparison with Infinity:
        // https://github.com/peterolson/BigInteger.js/issues/61
        if (v === Infinity) {
            return -1;
        }
        if (v === -Infinity) {
            return 1;
        }

        var n = parseValue(v),
            a = this.value,
            b = n.value;
        if (this.sign !== n.sign) {
            return n.sign ? 1 : -1;
        }
        if (n.isSmall) {
            return this.sign ? -1 : 1;
        }
        return compareAbs(a, b) * (this.sign ? -1 : 1);
    };
    BigInteger.prototype.compareTo = BigInteger.prototype.compare;

    SmallInteger.prototype.compare = function (v) {
        if (v === Infinity) {
            return -1;
        }
        if (v === -Infinity) {
            return 1;
        }

        var n = parseValue(v),
            a = this.value,
            b = n.value;
        if (n.isSmall) {
            return a === b ? 0 : a > b ? 1 : -1;
        }
        if (a < 0 !== n.sign) {
            return a < 0 ? -1 : 1;
        }
        return a < 0 ? 1 : -1;
    };
    SmallInteger.prototype.compareTo = SmallInteger.prototype.compare;

    NativeBigInt.prototype.compare = function (v) {
        if (v === Infinity) {
            return -1;
        }
        if (v === -Infinity) {
            return 1;
        }
        var a = this.value;
        var b = parseValue(v).value;
        return a === b ? 0 : a > b ? 1 : -1;
    }
    NativeBigInt.prototype.compareTo = NativeBigInt.prototype.compare;

    BigInteger.prototype.equals = function (v) {
        return this.compare(v) === 0;
    };
    NativeBigInt.prototype.eq = NativeBigInt.prototype.equals = SmallInteger.prototype.eq = SmallInteger.prototype.equals = BigInteger.prototype.eq = BigInteger.prototype.equals;

    BigInteger.prototype.notEquals = function (v) {
        return this.compare(v) !== 0;
    };
    NativeBigInt.prototype.neq = NativeBigInt.prototype.notEquals = SmallInteger.prototype.neq = SmallInteger.prototype.notEquals = BigInteger.prototype.neq = BigInteger.prototype.notEquals;

    BigInteger.prototype.greater = function (v) {
        return this.compare(v) > 0;
    };
    NativeBigInt.prototype.gt = NativeBigInt.prototype.greater = SmallInteger.prototype.gt = SmallInteger.prototype.greater = BigInteger.prototype.gt = BigInteger.prototype.greater;

    BigInteger.prototype.lesser = function (v) {
        return this.compare(v) < 0;
    };
    NativeBigInt.prototype.lt = NativeBigInt.prototype.lesser = SmallInteger.prototype.lt = SmallInteger.prototype.lesser = BigInteger.prototype.lt = BigInteger.prototype.lesser;

    BigInteger.prototype.greaterOrEquals = function (v) {
        return this.compare(v) >= 0;
    };
    NativeBigInt.prototype.geq = NativeBigInt.prototype.greaterOrEquals = SmallInteger.prototype.geq = SmallInteger.prototype.greaterOrEquals = BigInteger.prototype.geq = BigInteger.prototype.greaterOrEquals;

    BigInteger.prototype.lesserOrEquals = function (v) {
        return this.compare(v) <= 0;
    };
    NativeBigInt.prototype.leq = NativeBigInt.prototype.lesserOrEquals = SmallInteger.prototype.leq = SmallInteger.prototype.lesserOrEquals = BigInteger.prototype.leq = BigInteger.prototype.lesserOrEquals;

    BigInteger.prototype.isEven = function () {
        return (this.value[0] & 1) === 0;
    };
    SmallInteger.prototype.isEven = function () {
        return (this.value & 1) === 0;
    };
    NativeBigInt.prototype.isEven = function () {
        return (this.value & requireBigInt(1)) === requireBigInt(0);
    };

    BigInteger.prototype.isOdd = function () {
        return (this.value[0] & 1) === 1;
    };
    SmallInteger.prototype.isOdd = function () {
        return (this.value & 1) === 1;
    };
    NativeBigInt.prototype.isOdd = function () {
        return (this.value & requireBigInt(1)) === requireBigInt(1);
    };

    BigInteger.prototype.isPositive = function () {
        return !this.sign;
    };
    SmallInteger.prototype.isPositive = function () {
        return this.value > 0;
    };
    NativeBigInt.prototype.isPositive = SmallInteger.prototype.isPositive;

    BigInteger.prototype.isNegative = function () {
        return this.sign;
    };
    SmallInteger.prototype.isNegative = function () {
        return this.value < 0;
    };
    NativeBigInt.prototype.isNegative = SmallInteger.prototype.isNegative;

    BigInteger.prototype.isUnit = function () {
        return false;
    };
    SmallInteger.prototype.isUnit = function () {
        return Math.abs(this.value) === 1;
    };
    NativeBigInt.prototype.isUnit = function () {
        return this.abs().value === requireBigInt(1);
    }

    BigInteger.prototype.isZero = function () {
        return false;
    };
    SmallInteger.prototype.isZero = function () {
        return this.value === 0;
    };
    NativeBigInt.prototype.isZero = function () {
        return this.value === requireBigInt(0);
    }

    BigInteger.prototype.isDivisibleBy = function (v) {
        var n = parseValue(v);
        if (n.isZero()) return false;
        if (n.isUnit()) return true;
        if (n.compareAbs(2) === 0) return this.isEven();
        return this.mod(n).isZero();
    };
    NativeBigInt.prototype.isDivisibleBy = SmallInteger.prototype.isDivisibleBy = BigInteger.prototype.isDivisibleBy;

    function isBasicPrime(v) {
        var n = v.abs();
        if (n.isUnit()) return false;
        if (n.equals(2) || n.equals(3) || n.equals(5)) return true;
        if (n.isEven() || n.isDivisibleBy(3) || n.isDivisibleBy(5)) return false;
        if (n.lesser(49)) return true;
        // we don't know if it's prime: let the other functions figure it out
    }

    function millerRabinTest(n, a) {
        var nPrev = n.prev(),
            b = nPrev,
            r = 0,
            d, t, i, x;
        while (b.isEven()) b = b.divide(2), r++;
        next: for (i = 0; i < a.length; i++) {
            if (n.lesser(a[i])) continue;
            x = bigInt(a[i]).modPow(b, n);
            if (x.isUnit() || x.equals(nPrev)) continue;
            for (d = r - 1; d !== 0; d--) {
                x = x.square().mod(n);
                if (x.isUnit()) return false;
                if (x.equals(nPrev)) continue next;
            }
            return false;
        }
        return true;
    }

    // Set "strict" to true to force GRH-supported lower bound of 2*log(N)^2
    BigInteger.prototype.isPrime = function (strict) {
        var isPrime = isBasicPrime(this);
        if (isPrime !== undefined) return isPrime;
        var n = this.abs();
        var bits = n.bitLength();
        if (bits <= 64)
            return millerRabinTest(n, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]);
        var logN = Math.log(2) * bits.toJSNumber();
        var t = Math.ceil((strict === true) ? (2 * Math.pow(logN, 2)) : logN);
        for (var a = [], i = 0; i < t; i++) {
            a.push(bigInt(i + 2));
        }
        return millerRabinTest(n, a);
    };
    NativeBigInt.prototype.isPrime = SmallInteger.prototype.isPrime = BigInteger.prototype.isPrime;

    BigInteger.prototype.isProbablePrime = function (iterations, rng) {
        var isPrime = isBasicPrime(this);
        if (isPrime !== undefined) return isPrime;
        var n = this.abs();
        var t = iterations === undefined ? 5 : iterations;
        for (var a = [], i = 0; i < t; i++) {
            a.push(bigInt.randBetween(2, n.minus(2), rng));
        }
        return millerRabinTest(n, a);
    };
    NativeBigInt.prototype.isProbablePrime = SmallInteger.prototype.isProbablePrime = BigInteger.prototype.isProbablePrime;

    BigInteger.prototype.modInv = function (n) {
        var t = bigInt.zero, newT = bigInt.one, r = parseValue(n), newR = this.abs(), q, lastT, lastR;
        while (!newR.isZero()) {
            q = r.divide(newR);
            lastT = t;
            lastR = r;
            t = newT;
            r = newR;
            newT = lastT.subtract(q.multiply(newT));
            newR = lastR.subtract(q.multiply(newR));
        }
        if (!r.isUnit()) throw new Error(this.toString() + " and " + n.toString() + " are not co-prime");
        if (t.compare(0) === -1) {
            t = t.add(n);
        }
        if (this.isNegative()) {
            return t.negate();
        }
        return t;
    };

    NativeBigInt.prototype.modInv = SmallInteger.prototype.modInv = BigInteger.prototype.modInv;

    BigInteger.prototype.next = function () {
        var value = this.value;
        if (this.sign) {
            return subtractSmall(value, 1, this.sign);
        }
        return new BigInteger(addSmall(value, 1), this.sign);
    };
    SmallInteger.prototype.next = function () {
        var value = this.value;
        if (value + 1 < MAX_INT) return new SmallInteger(value + 1);
        return new BigInteger(MAX_INT_ARR, false);
    };
    NativeBigInt.prototype.next = function () {
        return new NativeBigInt(this.value + requireBigInt(1));
    }

    BigInteger.prototype.prev = function () {
        var value = this.value;
        if (this.sign) {
            return new BigInteger(addSmall(value, 1), true);
        }
        return subtractSmall(value, 1, this.sign);
    };
    SmallInteger.prototype.prev = function () {
        var value = this.value;
        if (value - 1 > -MAX_INT) return new SmallInteger(value - 1);
        return new BigInteger(MAX_INT_ARR, true);
    };
    NativeBigInt.prototype.prev = function () {
        return new NativeBigInt(this.value - requireBigInt(1));
    }

    var powersOfTwo = [1];
    while (2 * powersOfTwo[powersOfTwo.length - 1] <= BASE) powersOfTwo.push(2 * powersOfTwo[powersOfTwo.length - 1]);
    var powers2Length = powersOfTwo.length, highestPower2 = powersOfTwo[powers2Length - 1];

    function shift_isSmall(n) {
        return Math.abs(n) <= BASE;
    }

    BigInteger.prototype.shiftLeft = function (v) {
        var n = parseValue(v).toJSNumber();
        if (!shift_isSmall(n)) {
            throw new Error(String(n) + " is too large for shifting.");
        }
        if (n < 0) return this.shiftRight(-n);
        var result = this;
        if (result.isZero()) return result;
        while (n >= powers2Length) {
            result = result.multiply(highestPower2);
            n -= powers2Length - 1;
        }
        return result.multiply(powersOfTwo[n]);
    };
    NativeBigInt.prototype.shiftLeft = SmallInteger.prototype.shiftLeft = BigInteger.prototype.shiftLeft;

    BigInteger.prototype.shiftRight = function (v) {
        var remQuo;
        var n = parseValue(v).toJSNumber();
        if (!shift_isSmall(n)) {
            throw new Error(String(n) + " is too large for shifting.");
        }
        if (n < 0) return this.shiftLeft(-n);
        var result = this;
        while (n >= powers2Length) {
            if (result.isZero() || (result.isNegative() && result.isUnit())) return result;
            remQuo = divModAny(result, highestPower2);
            result = remQuo[1].isNegative() ? remQuo[0].prev() : remQuo[0];
            n -= powers2Length - 1;
        }
        remQuo = divModAny(result, powersOfTwo[n]);
        return remQuo[1].isNegative() ? remQuo[0].prev() : remQuo[0];
    };
    NativeBigInt.prototype.shiftRight = SmallInteger.prototype.shiftRight = BigInteger.prototype.shiftRight;

    function bitwise(x, y, fn) {
        y = parseValue(y);
        var xSign = x.isNegative(), ySign = y.isNegative();
        var xRem = xSign ? x.not() : x,
            yRem = ySign ? y.not() : y;
        var xDigit = 0, yDigit = 0;
        var xDivMod = null, yDivMod = null;
        var result = [];
        while (!xRem.isZero() || !yRem.isZero()) {
            xDivMod = divModAny(xRem, highestPower2);
            xDigit = xDivMod[1].toJSNumber();
            if (xSign) {
                xDigit = highestPower2 - 1 - xDigit; // two's complement for negative numbers
            }

            yDivMod = divModAny(yRem, highestPower2);
            yDigit = yDivMod[1].toJSNumber();
            if (ySign) {
                yDigit = highestPower2 - 1 - yDigit; // two's complement for negative numbers
            }

            xRem = xDivMod[0];
            yRem = yDivMod[0];
            result.push(fn(xDigit, yDigit));
        }
        var sum = fn(xSign ? 1 : 0, ySign ? 1 : 0) !== 0 ? bigInt(-1) : bigInt(0);
        for (var i = result.length - 1; i >= 0; i -= 1) {
            sum = sum.multiply(highestPower2).add(bigInt(result[i]));
        }
        return sum;
    }

    BigInteger.prototype.not = function () {
        return this.negate().prev();
    };
    NativeBigInt.prototype.not = SmallInteger.prototype.not = BigInteger.prototype.not;

    BigInteger.prototype.and = function (n) {
        return bitwise(this, n, function (a, b) { return a & b; });
    };
    NativeBigInt.prototype.and = SmallInteger.prototype.and = BigInteger.prototype.and;

    BigInteger.prototype.or = function (n) {
        return bitwise(this, n, function (a, b) { return a | b; });
    };
    NativeBigInt.prototype.or = SmallInteger.prototype.or = BigInteger.prototype.or;

    BigInteger.prototype.xor = function (n) {
        return bitwise(this, n, function (a, b) { return a ^ b; });
    };
    NativeBigInt.prototype.xor = SmallInteger.prototype.xor = BigInteger.prototype.xor;

    var LOBMASK_I = 1 << 30, LOBMASK_BI = (BASE & -BASE) * (BASE & -BASE) | LOBMASK_I;
    function roughLOB(n) { // get lowestOneBit (rough)
        // SmallInteger: return Min(lowestOneBit(n), 1 << 30)
        // BigInteger: return Min(lowestOneBit(n), 1 << 14) [BASE=1e7]
        var v = n.value,
            x = typeof v === "number" ? v | LOBMASK_I :
                typeof v === "bigint" ? v | requireBigInt(LOBMASK_I) :
                    v[0] + v[1] * BASE | LOBMASK_BI;
        return x & -x;
    }

    function integerLogarithm(value, base) {
        if (base.compareTo(value) <= 0) {
            var tmp = integerLogarithm(value, base.square(base));
            var p = tmp.p;
            var e = tmp.e;
            var t = p.multiply(base);
            return t.compareTo(value) <= 0 ? { p: t, e: e * 2 + 1 } : { p: p, e: e * 2 };
        }
        return { p: bigInt(1), e: 0 };
    }

    BigInteger.prototype.bitLength = function () {
        var n = this;
        if (n.compareTo(bigInt(0)) < 0) {
            n = n.negate().subtract(bigInt(1));
        }
        if (n.compareTo(bigInt(0)) === 0) {
            return bigInt(0);
        }
        return bigInt(integerLogarithm(n, bigInt(2)).e).add(bigInt(1));
    }
    NativeBigInt.prototype.bitLength = SmallInteger.prototype.bitLength = BigInteger.prototype.bitLength;

    function max(a, b) {
        a = parseValue(a);
        b = parseValue(b);
        return a.greater(b) ? a : b;
    }
    function min(a, b) {
        a = parseValue(a);
        b = parseValue(b);
        return a.lesser(b) ? a : b;
    }
    function gcd(a, b) {
        a = parseValue(a).abs();
        b = parseValue(b).abs();
        if (a.equals(b)) return a;
        if (a.isZero()) return b;
        if (b.isZero()) return a;
        var c = Integer[1], d, t;
        while (a.isEven() && b.isEven()) {
            d = min(roughLOB(a), roughLOB(b));
            a = a.divide(d);
            b = b.divide(d);
            c = c.multiply(d);
        }
        while (a.isEven()) {
            a = a.divide(roughLOB(a));
        }
        do {
            while (b.isEven()) {
                b = b.divide(roughLOB(b));
            }
            if (a.greater(b)) {
                t = b; b = a; a = t;
            }
            b = b.subtract(a);
        } while (!b.isZero());
        return c.isUnit() ? a : a.multiply(c);
    }
    function lcm(a, b) {
        a = parseValue(a).abs();
        b = parseValue(b).abs();
        return a.divide(gcd(a, b)).multiply(b);
    }
    function randBetween(a, b, rng) {
        a = parseValue(a);
        b = parseValue(b);
        var usedRNG = rng || Math.random;
        var low = min(a, b), high = max(a, b);
        var range = high.subtract(low).add(1);
        if (range.isSmall) return low.add(Math.floor(usedRNG() * range));
        var digits = toBase(range, BASE).value;
        var result = [], restricted = true;
        for (var i = 0; i < digits.length; i++) {
            var top = restricted ? digits[i] + (i + 1 < digits.length ? digits[i + 1] / BASE : 0) : BASE;
            var digit = truncate(usedRNG() * top);
            result.push(digit);
            if (digit < digits[i]) restricted = false;
        }
        return low.add(Integer.fromArray(result, BASE, false));
    }

    var parseBase = function (text, base, alphabet, caseSensitive) {
        alphabet = alphabet || DEFAULT_ALPHABET;
        text = String(text);
        if (!caseSensitive) {
            text = text.toLowerCase();
            alphabet = alphabet.toLowerCase();
        }
        var length = text.length;
        var i;
        var absBase = Math.abs(base);
        var alphabetValues = {};
        for (i = 0; i < alphabet.length; i++) {
            alphabetValues[alphabet[i]] = i;
        }
        for (i = 0; i < length; i++) {
            var c = text[i];
            if (c === "-") continue;
            if (c in alphabetValues) {
                if (alphabetValues[c] >= absBase) {
                    if (c === "1" && absBase === 1) continue;
                    throw new Error(c + " is not a valid digit in base " + base + ".");
                }
            }
        }
        base = parseValue(base);
        var digits = [];
        var isNegative = text[0] === "-";
        for (i = isNegative ? 1 : 0; i < text.length; i++) {
            var c = text[i];
            if (c in alphabetValues) digits.push(parseValue(alphabetValues[c]));
            else if (c === "<") {
                var start = i;
                do { i++; } while (text[i] !== ">" && i < text.length);
                digits.push(parseValue(text.slice(start + 1, i)));
            }
            else throw new Error(c + " is not a valid character");
        }
        return parseBaseFromArray(digits, base, isNegative);
    };

    function parseBaseFromArray(digits, base, isNegative) {
        var val = Integer[0], pow = Integer[1], i;
        for (i = digits.length - 1; i >= 0; i--) {
            val = val.add(digits[i].times(pow));
            pow = pow.times(base);
        }
        return isNegative ? val.negate() : val;
    }

    function stringify(digit, alphabet) {
        alphabet = alphabet || DEFAULT_ALPHABET;
        if (digit < alphabet.length) {
            return alphabet[digit];
        }
        return "<" + digit + ">";
    }

    function toBase(n, base) {
        base = bigInt(base);
        if (base.isZero()) {
            if (n.isZero()) return { value: [0], isNegative: false };
            throw new Error("Cannot convert nonzero numbers to base 0.");
        }
        if (base.equals(-1)) {
            if (n.isZero()) return { value: [0], isNegative: false };
            if (n.isNegative())
                return {
                    value: [].concat.apply([], Array.apply(null, Array(-n.toJSNumber()))
                        .map(Array.prototype.valueOf, [1, 0])
                    ),
                    isNegative: false
                };

            var arr = Array.apply(null, Array(n.toJSNumber() - 1))
                .map(Array.prototype.valueOf, [0, 1]);
            arr.unshift([1]);
            return {
                value: [].concat.apply([], arr),
                isNegative: false
            };
        }

        var neg = false;
        if (n.isNegative() && base.isPositive()) {
            neg = true;
            n = n.abs();
        }
        if (base.isUnit()) {
            if (n.isZero()) return { value: [0], isNegative: false };

            return {
                value: Array.apply(null, Array(n.toJSNumber()))
                    .map(Number.prototype.valueOf, 1),
                isNegative: neg
            };
        }
        var out = [];
        var left = n, divmod;
        while (left.isNegative() || left.compareAbs(base) >= 0) {
            divmod = left.divmod(base);
            left = divmod.quotient;
            var digit = divmod.remainder;
            if (digit.isNegative()) {
                digit = base.minus(digit).abs();
                left = left.next();
            }
            out.push(digit.toJSNumber());
        }
        out.push(left.toJSNumber());
        return { value: out.reverse(), isNegative: neg };
    }

    function toBaseString(n, base, alphabet) {
        var arr = toBase(n, base);
        return (arr.isNegative ? "-" : "") + arr.value.map(function (x) {
            return stringify(x, alphabet);
        }).join('');
    }

    BigInteger.prototype.toArray = function (radix) {
        return toBase(this, radix);
    };

    SmallInteger.prototype.toArray = function (radix) {
        return toBase(this, radix);
    };

    NativeBigInt.prototype.toArray = function (radix) {
        return toBase(this, radix);
    };

    BigInteger.prototype.toString = function (radix, alphabet) {
        if (radix === undefined) radix = 10;
        if (radix !== 10 || alphabet) return toBaseString(this, radix, alphabet);
        var v = this.value, l = v.length, str = String(v[--l]), zeros = "0000000", digit;
        while (--l >= 0) {
            digit = String(v[l]);
            str += zeros.slice(digit.length) + digit;
        }
        var sign = this.sign ? "-" : "";
        return sign + str;
    };

    SmallInteger.prototype.toString = function (radix, alphabet) {
        if (radix === undefined) radix = 10;
        if (radix !== 10 || alphabet) return toBaseString(this, radix, alphabet);
        return String(this.value);
    };

    NativeBigInt.prototype.toString = SmallInteger.prototype.toString;

    NativeBigInt.prototype.toJSON = BigInteger.prototype.toJSON = SmallInteger.prototype.toJSON = function () { return this.toString(); }

    BigInteger.prototype.valueOf = function () {
        return parseInt(this.toString(), 10);
    };
    BigInteger.prototype.toJSNumber = BigInteger.prototype.valueOf;

    SmallInteger.prototype.valueOf = function () {
        return this.value;
    };
    SmallInteger.prototype.toJSNumber = SmallInteger.prototype.valueOf;
    NativeBigInt.prototype.valueOf = NativeBigInt.prototype.toJSNumber = function () {
        return parseInt(this.toString(), 10);
    }

    function parseStringValue(v) {
        if (isPrecise(+v)) {
            var x = +v;
            if (x === truncate(x))
                return supportsNativeBigInt ? new NativeBigInt(requireBigInt(x)) : new SmallInteger(x);
            throw new Error("Invalid integer: " + v);
        }
        var sign = v[0] === "-";
        if (sign) v = v.slice(1);
        var split = v.split(/e/i);
        if (split.length > 2) throw new Error("Invalid integer: " + split.join("e"));
        if (split.length === 2) {
            var exp = split[1];
            if (exp[0] === "+") exp = exp.slice(1);
            exp = +exp;
            if (exp !== truncate(exp) || !isPrecise(exp)) throw new Error("Invalid integer: " + exp + " is not a valid exponent.");
            var text = split[0];
            var decimalPlace = text.indexOf(".");
            if (decimalPlace >= 0) {
                exp -= text.length - decimalPlace - 1;
                text = text.slice(0, decimalPlace) + text.slice(decimalPlace + 1);
            }
            if (exp < 0) throw new Error("Cannot include negative exponent part for integers");
            text += (new Array(exp + 1)).join("0");
            v = text;
        }
        var isValid = /^([0-9][0-9]*)$/.test(v);
        if (!isValid) throw new Error("Invalid integer: " + v);
        if (supportsNativeBigInt) {
            return new NativeBigInt(requireBigInt(sign ? "-" + v : v));
        }
        var r = [], max = v.length, l = LOG_BASE, min = max - l;
        while (max > 0) {
            r.push(+v.slice(min, max));
            min -= l;
            if (min < 0) min = 0;
            max -= l;
        }
        trim(r);
        return new BigInteger(r, sign);
    }

    function parseNumberValue(v) {
        if (supportsNativeBigInt) {
            return new NativeBigInt(requireBigInt(v));
        }
        if (isPrecise(v)) {
            if (v !== truncate(v)) throw new Error(v + " is not an integer.");
            return new SmallInteger(v);
        }
        return parseStringValue(v.toString());
    }

    function parseValue(v) {
        if (typeof v === "number") {
            return parseNumberValue(v);
        }
        if (typeof v === "string") {
            return parseStringValue(v);
        }
        if (typeof v === "bigint") {
            return new NativeBigInt(v);
        }
        return v;
    }
    // Pre-define numbers in range [-999,999]
    for (var i = 0; i < 1000; i++) {
        Integer[i] = parseValue(i);
        if (i > 0) Integer[-i] = parseValue(-i);
    }
    // Backwards compatibility
    Integer.one = Integer[1];
    Integer.zero = Integer[0];
    Integer.minusOne = Integer[-1];
    Integer.max = max;
    Integer.min = min;
    Integer.gcd = gcd;
    Integer.lcm = lcm;
    Integer.isInstance = function (x) { return x instanceof BigInteger || x instanceof SmallInteger || x instanceof NativeBigInt; };
    Integer.randBetween = randBetween;

    Integer.fromArray = function (digits, base, isNegative) {
        return parseBaseFromArray(digits.map(parseValue), parseValue(base || 10), isNegative);
    };

    return Integer;
})();

// Node.js check
if (typeof module !== "undefined" && module.hasOwnProperty("exports")) {
    module.exports = bigInt;
}

//amd check
if (typeof define === "function" && define.amd) {
    define( function () {
        return bigInt;
    });
}


var MERCAPI_P256 = {
  p: bigInt('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff', 16),
  a: bigInt('ffffffff00000001000000000000000000000000fffffffffffffffffffffffc', 16),
  b: bigInt('5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b', 16),
  gx: bigInt('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296', 16),
  gy: bigInt('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5', 16),
  n: bigInt('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551', 16),
};

var MERCAPI_BIGINT_ZERO = bigInt(0);
var MERCAPI_BIGINT_ONE = bigInt(1);
var MERCAPI_BIGINT_TWO = bigInt(2);
var MERCAPI_BIGINT_THREE = bigInt(3);

function mercapiGenerateP256KeyPair() {
  var n = MERCAPI_P256.n;
  var d = MERCAPI_BIGINT_ZERO;
  while (d.isZero() || d.isNegative() || d.compare(n) >= 0) {
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
  var r = MERCAPI_BIGINT_ZERO;
  var s = MERCAPI_BIGINT_ZERO;

  while (r.isZero() || s.isZero()) {
    var k = MERCAPI_BIGINT_ZERO;
    while (k.isZero() || k.isNegative() || k.compare(n) >= 0) {
      k = mercapiBytesToBigInt(mercapiRandomBytes(32));
    }
    var p = mercapiEcScalarMult(k, { x: MERCAPI_P256.gx, y: MERCAPI_P256.gy, inf: false });
    r = mercapiMod(p.x, n);
    if (r.isZero()) continue;
    var kinv = mercapiModInv(k, n);
    s = mercapiMod(kinv.multiply(z.add(r.multiply(privateKey))), n);
  }

  var rb = mercapiBigIntToBytes(r, 32);
  var sb = mercapiBigIntToBytes(s, 32);
  return rb.concat(sb);
}

function mercapiBytesToBigInt(bytes) {
  var hex = mercapiBytesToHex(bytes);
  if (!hex) return MERCAPI_BIGINT_ZERO;
  return bigInt(hex, 16);
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
  var r = a.mod(m);
  return r.isNegative() ? r.add(m) : r;
}

function mercapiModInv(a, m) {
  try {
    return mercapiMod(a, m).modInv(m);
  } catch (e) {
    throw new MercapiError('Value is not invertible');
  }
}

function mercapiEcPointAdd(p, q) {
  if (p.inf) return q;
  if (q.inf) return p;
  var prime = MERCAPI_P256.p;
  if (p.x.equals(q.x)) {
    if (mercapiMod(p.y.add(q.y), prime).isZero()) return { inf: true };
    return mercapiEcPointDouble(p);
  }
  var lambda = mercapiMod(q.y.subtract(p.y).multiply(mercapiModInv(q.x.subtract(p.x), prime)), prime);
  var rx = mercapiMod(lambda.square().subtract(p.x).subtract(q.x), prime);
  var ry = mercapiMod(lambda.multiply(p.x.subtract(rx)).subtract(p.y), prime);
  return { x: rx, y: ry, inf: false };
}

function mercapiEcPointDouble(p) {
  if (p.inf) return p;
  if (p.y.isZero()) return { inf: true };
  var prime = MERCAPI_P256.p;
  var numerator = MERCAPI_BIGINT_THREE.multiply(p.x).multiply(p.x).add(MERCAPI_P256.a);
  var denominator = MERCAPI_BIGINT_TWO.multiply(p.y);
  var lambda = mercapiMod(numerator.multiply(mercapiModInv(denominator, prime)), prime);
  var rx = mercapiMod(lambda.square().subtract(MERCAPI_BIGINT_TWO.multiply(p.x)), prime);
  var ry = mercapiMod(lambda.multiply(p.x.subtract(rx)).subtract(p.y), prime);
  return { x: rx, y: ry, inf: false };
}

function mercapiEcScalarMult(k, p) {
  var n = k;
  var result = { inf: true };
  var addend = p;
  while (!n.isZero()) {
    if (n.isOdd()) {
      result = mercapiEcPointAdd(result, addend);
    }
    addend = mercapiEcPointDouble(addend);
    n = n.shiftRight(1);
  }
  return result;
}
