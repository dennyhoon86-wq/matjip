(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RestaurantSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const grades = ['A++', 'A+', 'A', 'B', 'C', 'D', 'E'];
  const areas = {
    강남: '강남구', 역삼: '강남구', 삼성: '강남구', 청담: '강남구', 압구정: '강남구', 신사: '강남구', 논현: '강남구', 가로수길: '강남구',
    홍대: '마포구', 합정: '마포구', 연남: '마포구', 망원: '마포구', 상수: '마포구',
    이태원: '용산구', 한남: '용산구', 용리단길: '용산구', 여의도: '영등포구', 문래: '영등포구',
    건대: '광진구', 건대입구: '광진구', 잠실: '송파구', 송리단길: '송파구', 석촌: '송파구',
    노량진: '동작구', 사당: '동작구', 신촌: '서대문구', 연희: '서대문구',
    종로: '종로구', 익선동: '종로구', 삼청동: '종로구', 서촌: '종로구', 북촌: '종로구',
    명동: '중구', 을지로: '중구', 성수: '성동구', 왕십리: '성동구',
  };
  const categories = {
    한식: ['한식'], 일식: ['일식'], 스시: ['스시', '일식'], 오마카세: ['오마카세'],
    중식: ['중식'], 중국집: ['중식'], 양식: ['양식', '이탈리아'], 파스타: ['파스타', '이탈리아'],
    피자: ['피자'], 고기: ['육류'], 소고기: ['소고기'], 돼지고기: ['돼지고기'], 삼겹살: ['돼지고기'],
    곱창: ['곱창'], 치킨: ['치킨'], 국밥: ['국밥'], 카페: ['카페'], 브런치: ['브런치'],
    술: ['이자카야', '요리주점', '호프', '와인'], 술집: ['이자카야', '요리주점', '호프', '와인'],
  };
  const provinceAliases = { 경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 경상남도: '경남', 경상북도: '경북', 전라남도: '전남', 전라북도: '전북', 전북특별자치도: '전북', 충청남도: '충남', 충청북도: '충북', 제주도: '제주', 제주특별자치도: '제주' };
  const badgeAliases = { 최신: '신규', 새로운: '신규', 새로: '신규', 최근: '신규', 뉴: '신규', 따끈따끈한: '신규' };
  const numeric = '(\\d[\\d,]*(?:\\.\\d+)?)';
  const numberWithUnit = numeric + '\\s*(만|천)?\\s*원?';
  const suffix = /(쪽에서|근처에서|주변에서|에서|근처|주변|쪽|으로|로|의|에|은|는|을|를)$/;
  function won(amount, unit) { return Number(amount.replaceAll(',', '')) * (unit === '만' ? 10000 : unit === '천' ? 1000 : 1); }
  function parse(q, vocabulary = {}) {
    const result = { region: null, gu: null, dong: null, station: null, categoryTerms: [], badge: null, gradeMin: null, avgMin: null, avgMax: null, avgMaxExclusive: false, priceMin: null, priceMax: null, priceMaxExclusive: false, excludeNew: false, leftoverTokens: [], notices: [] };
    let text = String(q || '').trim().replace(/[，/()]/g, ' ').replace(/,(?!\d)/g, ' ');
    if (!text) return result;
    const consume = (regex, handler) => { text = text.replace(regex, (...args) => { handler(...args); return ' '; }); };
    consume(/(?:^|\s)(A\+\+|A\+|A|B|C|D|E)\s*(?:등급\s*)?(이상|부터)(?=\s|$)/gi, (_, grade) => { result.gradeMin = grade.toUpperCase(); });
    consume(/신규\s*(?:제외하고|제외|빼고|빼)/g, () => { result.excludeNew = true; });
    consume(new RegExp(numberWithUnit + '\\s*[~～–-]\\s*' + numberWithUnit, 'g'), (all, left, leftUnit, right, rightUnit) => {
      if (!leftUnit && !rightUnit && !all.includes('원')) { result.leftoverTokens.push(all); return; }
      const a = won(left, leftUnit || rightUnit), b = won(right, rightUnit || leftUnit);
      result.priceMin = Math.min(a, b); result.priceMax = Math.max(a, b);
    });
    consume(new RegExp(numeric + '\\s*(만|천)\\s*원?\\s*대', 'g'), (_, amount, unit) => {
      result.priceMin = won(amount, unit); result.priceMax = result.priceMin + (unit === '만' ? 10000 : 1000); result.priceMaxExclusive = true;
    });
    consume(new RegExp(numberWithUnit + '\\s*(이하|미만|이상|부터)(?=\\s|$)', 'g'), (all, amount, unit, direction) => {
      if (!unit && !all.includes('원')) {
        const value = Number(amount.replaceAll(',', ''));
        if (value >= 0 && value <= 5) {
          if (direction === '이상' || direction === '부터') result.avgMin = value;
          else { result.avgMax = value; result.avgMaxExclusive = direction === '미만'; }
        } else result.leftoverTokens.push(all);
        return;
      }
      const value = won(amount, unit);
      if (direction === '이상' || direction === '부터') result.priceMin = value;
      else { result.priceMax = value; result.priceMaxExclusive = direction === '미만'; }
    });
    consume(/(?:평점\s*)?([0-5](?:\.\d+)?)\s*(?:점|평점)\s*(이하|미만|이상|부터)?/g, (_, amount, direction) => {
      if (direction === '이하' || direction === '미만') { result.avgMax = Number(amount); result.avgMaxExclusive = direction === '미만'; }
      else result.avgMin = Number(amount);
    });
    const unsupported = /조용(?:한|히|하게)?|부모님|아이와|데이트|회식|모임|혼밥|혼자|(?:\d+\s*명)|주차|예약|룸(?:이|있는)?/;
    if (unsupported.test(text)) result.notices.push('인원·분위기·주차·예약 조건은 지도에서 확인해 주세요.');
    text = text.replace(/(?:^|\s)(?:부모님(?:을)?\s*모시고(?:\s*갈)?|모시고|갈\s*만한|갈만한|먹고\s*싶(?:어|다|은데)?|먹을\s*만한|먹으러|추천(?:해줘|해주세요|좀)?|알려(?:줘|주세요)|술\s*한\s*잔|한잔|(?:1\s*인|인당)|(?:\d+\s*명)|조용(?:한|히|하게)?|부모님|아이와|데이트|회식|모임|혼밥|혼자|여럿|저녁(?:에)?|점심(?:에)?|아침(?:에)?|밤(?:에)?|식사(?:로)?|주차|예약|룸(?:이|있는)?|맛집|괜찮은(?:곳)?|있나요|있을까|있나|해주세요|해줘|위주)(?=\s|$)/g, match => /술\s*한\s*잔/.test(match) ? ' 술 ' : ' ');
    const gu = new Set(vocabulary.gu || []), dong = new Set(vocabulary.dong || []), stations = new Set(vocabulary.stations || []), regions = new Set(vocabulary.regions || []), badges = new Set(vocabulary.badges || []);
    for (const original of text.split(/\s+/).filter(Boolean)) {
      const stripped = original.replace(suffix, '');
      const variants = [...new Set([original, stripped])];
      let used = false;
      for (let token of variants) {
        token = provinceAliases[token] || token;
        const normalizedRegion = token.replace(/특별자치도$|특별자치시$|특별시$|광역시$/, '');
        if (!result.region && regions.has(normalizedRegion) && normalizedRegion !== '기타') { result.region = normalizedRegion; used = true; break; }
        const city = token.replace(/광역시$|시$/, '');
        if (!result.gu && gu.has(city)) { result.gu = city; used = true; break; }
        if (!result.gu && gu.has(token)) { result.gu = token; used = true; break; }
        if (token.endsWith('역') && stations.has(token.slice(0, -1))) { result.station = token.slice(0, -1); used = true; break; }
        if (!result.dong && dong.has(token)) { result.dong = token; used = true; break; }
        if (!result.gu && gu.has(areas[token])) { result.gu = areas[token]; used = true; break; }
        if (!result.station && stations.has(token)) { result.station = token; used = true; break; }
        if (badges.has(token)) { result.badge = token; used = true; break; }
        if (badges.has(badgeAliases[token])) { result.badge = badgeAliases[token]; used = true; break; }
        const terms = categories[token] || ((vocabulary.categories || []).some(c => token.length >= 2 && String(c || '').includes(token)) ? [token] : []);
        if (terms.length) { result.categoryTerms.push(...terms); used = true; break; }
        if (/^(갈|가고|먹고|곳|집|좀|근처|주변|쪽|에서|이상|이하|평점|등급|가격|예산|있는)$/.test(token)) { used = true; break; }
      }
      if (!used) result.leftoverTokens.push(original);
    }
    result.categoryTerms = [...new Set(result.categoryTerms)];
    if (result.priceMin != null || result.priceMax != null) result.notices.push('가격 정보가 있는 음식점만 검색합니다. 표시 가격은 식당의 등록 가격대입니다.');
    return result;
  }
  function matches(d, smart, explicit = {}) {
    if (smart.region && !explicit.region && d.region !== smart.region) return false;
    if (smart.gu && !explicit.gu && d.gu !== smart.gu) return false;
    if (smart.dong && !explicit.gu && d.dong !== smart.dong) return false;
    if (smart.station && d.subway !== smart.station) return false;
    if (smart.categoryTerms.length && !explicit.category && !smart.categoryTerms.some(t => (d.category || '').includes(t))) return false;
    if (smart.badge && !explicit.badge && !(d.badges || []).some(b => b.name === smart.badge)) return false;
    if (smart.gradeMin && (!d.grade || grades.indexOf(d.grade) > grades.indexOf(smart.gradeMin))) return false;
    if (smart.avgMin != null && (d.avg == null || d.avg < smart.avgMin)) return false;
    if (smart.avgMax != null && (d.avg == null || (smart.avgMaxExclusive ? d.avg >= smart.avgMax : d.avg > smart.avgMax))) return false;
    if (smart.excludeNew && (d.badges || []).some(b => b.name === '신규')) return false;
    if (smart.priceMin != null || smart.priceMax != null) {
      const range = String(d.price_range || '').replaceAll(',', '').match(/(\d+)\s*~\s*(\d+)/);
      if (!range) return false;
      if (smart.priceMin != null && Number(range[2]) < smart.priceMin) return false;
      if (smart.priceMax != null && (smart.priceMaxExclusive ? Number(range[1]) >= smart.priceMax : Number(range[1]) > smart.priceMax)) return false;
    }
    const haystack = `${d.name || ''} ${d.category || ''} ${d.address || ''}`.toLowerCase();
    return smart.leftoverTokens.every(t => haystack.includes(t.toLowerCase()));
  }
  function compare(sort) {
    const avg = (a, b, ascending = false) => a.avg == null ? (b.avg == null ? 0 : 1) : b.avg == null ? -1 : ascending ? a.avg - b.avg : b.avg - a.avg;
    return (a, b) => {
      let order = 0;
      if (sort === 'name') order = a.name.localeCompare(b.name, 'ko');
      else if (sort === 'grade') order = (a.grade ? grades.indexOf(a.grade) : 99) - (b.grade ? grades.indexOf(b.grade) : 99) || avg(a, b);
      else if (sort === 'new_first') order = Number((b.badges || []).some(x => x.name === '신규')) - Number((a.badges || []).some(x => x.name === '신규')) || avg(a, b);
      else order = avg(a, b, sort === 'avg_asc');
      return order || a.id - b.id;
    };
  }
  return { parse, matches, compare, grades };
});
