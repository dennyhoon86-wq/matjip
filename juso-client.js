const { exactAddressCandidate, toWgs84 } = require('./geo-locations');

async function getJson(base, values, fetcher) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`행안부 API HTTP ${response.status}`);
  const body = await response.json();
  if (String(body?.results?.common?.errorCode) !== '0') throw new Error(`행안부 API ${body?.results?.common?.errorCode || '응답 오류'}`);
  return body.results.juso || [];
}

async function geocode(address, { addressKey, coordKey }, fetcher = fetch) {
  const candidates = await getJson('https://business.juso.go.kr/addrlink/addrLinkApi.do', {
    confmKey: addressKey, currentPage: 1, countPerPage: 10, keyword: address, resultType: 'json',
  }, fetcher);
  const place = exactAddressCandidate(address, candidates);
  if (!place) return { status: candidates.length ? 'ambiguous_or_inexact' : 'not_found' };
  const coords = await getJson('https://business.juso.go.kr/addrlink/addrCoordApi.do', {
    confmKey: coordKey, admCd: place.admCd, rnMgtSn: place.rnMgtSn,
    udrtYn: place.udrtYn, buldMnnm: place.buldMnnm, buldSlno: place.buldSlno,
    resultType: 'json',
  }, fetcher);
  const point = coords.length === 1 ? toWgs84(coords[0].entX, coords[0].entY) : null;
  return point ? { status: 'ok', ...point } : { status: 'no_coordinate' };
}

module.exports = { geocode };
