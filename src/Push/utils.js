import Parse    from 'parse/node';
import deepcopy from 'deepcopy';
import _ from 'lodash';

export function isPushIncrementing(body) {
  if (!body.data || !body.data.badge) {
    return false;
  }

  const badge = body.data.badge;
  if (typeof badge == 'string' && badge.toLowerCase() == "increment") {
    return true;
  }

  return typeof badge == 'object' && typeof badge.__op == 'string' &&
         badge.__op.toLowerCase() == "increment" && Number(badge.amount);
}

const localizableKeys = ['alert', 'title'];

export function getLocalesFromPush(body) {
  const data = body.data;
  if (!data) {
    return [];
  }
  return [...new Set(Object.keys(data).reduce((memo, key) => {
    localizableKeys.forEach((localizableKey) => {
      if (key.indexOf(`${localizableKey}-`) == 0) {
        memo.push(key.slice(localizableKey.length + 1));
      }
    });
    return memo;
  }, []))];
}

export function transformPushBodyForLocale(body, locale) {
  const data = body.data;
  if (!data) {
    return body;
  }
  body = deepcopy(body);
  localizableKeys.forEach((key) => {
    const localeValue = body.data[`${key}-${locale}`];
    if (localeValue) {
      body.data[key] = localeValue;
    }
  });
  return stripLocalesFromBody(body);
}

export function stripLocalesFromBody(body) {
  if (!body.data) { return body; }
  Object.keys(body.data).forEach((key) => {
    localizableKeys.forEach((localizableKey) => {
      if (key.indexOf(`${localizableKey}-`) == 0) {
        delete body.data[key];
      }
    });
  });
  return body;
}

export function bodiesPerLocales(body, locales = []) {
  // Get all tranformed bodies for each locale
  const result = locales.reduce((memo, locale) => {
    memo[locale] = transformPushBodyForLocale(body, locale);
    return memo;
  }, {});
  // Set the default locale, with the stripped body
  result.default = stripLocalesFromBody(body);
  return result;
}

export function groupByLocaleIdentifier(installations, locales = []) {
  return installations.reduce((map, installation) => {
    let added = false;
    locales.forEach((locale) => {
      if (added) {
        return;
      }
      if (installation.localeIdentifier && installation.localeIdentifier.indexOf(locale) === 0) {
        added = true;
        map[locale] = map[locale] || [];
        map[locale].push(installation);
      }
    });
    if (!added) {
      map.default.push(installation);
    }
    return map;
  }, {default: []});
}

/**
 * Check whether the deviceType parameter in qury condition is valid or not.
 * @param {Object} where A query condition
 * @param {Array} validPushTypes An array of valid push types(string)
 */
export function validatePushType(where = {}, validPushTypes = []) {
  var deviceTypeField = where.deviceType || {};
  var deviceTypes = [];
  if (typeof deviceTypeField === 'string') {
    deviceTypes.push(deviceTypeField);
  } else if (Array.isArray(deviceTypeField['$in'])) {
    deviceTypes.concat(deviceTypeField['$in']);
  }
  for (var i = 0; i < deviceTypes.length; i++) {
    var deviceType = deviceTypes[i];
    if (validPushTypes.indexOf(deviceType) < 0) {
      throw new Parse.Error(Parse.Error.PUSH_MISCONFIGURED,
        deviceType + ' is not supported push type.');
    }
  }
}

export function applyDeviceTokenExists(where) {
  where = deepcopy(where);
  if (!where.hasOwnProperty('deviceToken')) {
    where['deviceToken'] = {'$gt': ''}; // change $exists by $gt for better performance
  }
  return where;
}

const createIdRanges = chars => {
  const c = ('0123456789' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + 'abcdefghijklmnopqrstuvwxyz').split('')
  return _.flatten(c.map(c1 => (chars || c).map(c2 => c1 + c2)));
}
let chars = null
export function getIdRange(page, maxPages) {
  if (maxPages === 1) return
  if ((page + 1) > maxPages) throw `Page should be between 0 and ${maxPages - 1}`
  // creates 14776336 ranges
  if (!chars) chars = createIdRanges(createIdRanges(createIdRanges()))
  const idi = Math.ceil(chars.length / maxPages * page)
  const ci = chars[idi] || 'zzzzzzzzzz'
  const idf = Math.ceil(chars.length / maxPages * (page + 1))
  const cf = chars[idf] || ''
  if (page === 0) return {$lte: cf}
  else if ((page + 1) === maxPages) return {$gt: ci}
  return {$gt: ci, $lte: cf}
}
