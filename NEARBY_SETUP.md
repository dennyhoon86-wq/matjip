# 서울 주요 장소 근처 검색

현재 기능은 행안부·카카오 승인키를 기다리지 않는다. 서울 25개 구의 주요 장소 82곳을 사전 검토한 고정 좌표로 제공하고, 서울시 일반음식점 인허가 자료에서 **지번주소가 정확히 일치하는 건물 좌표**를 가져와 식당과 연결한다. 검색 시 외부 지도 API를 호출하지 않으며 거리 계산은 도보 경로가 아닌 **직선거리**다.

## 자료와 한계

- 식당 좌표: [서울 열린데이터광장 일반음식점 인허가 정보](https://data.seoul.go.kr/dataList/OA-23056/S/1/datasetView.do). 출처 표시 및 변경 고지는 화면에 표시한다. 원본 CSV는 Git에 포함하지 않는다.
- 장소 기준점: 서울시 지도·한국관광공사·[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). 정적 82개 점의 세부 출처는 `seoul-landmark-points.json`의 `sourceUrl`에 있다. OSM 유래 좌표는 ODbL의 적용을 받는다.
- 2026-10-05 변환 기준 서울 영업 식당 19,872곳 중 15,686곳(78.9%)의 위치가 연결되었다. 좌표가 없거나 좌표 간 불일치가 있는 식당은 반경 결과에서 제외한다. 이는 해당 지역에 음식점이 없다는 뜻이 아니다.
- 화면의 `위치 미확인 식당도 보기`는 반경 조건을 해제하고 해당 **구 전체**로 넓힌다. 이 목록은 거리 순 결과가 아니므로 같은 구의 먼 식당도 포함될 수 있다. 둘을 하나의 반경 결과처럼 섞지 않는다.
- 인허가 자료의 건물 좌표이지 출입구 좌표가 아니다. 넓은 쇼핑몰·공원·호수의 경우 같은 장소에서도 실제 출입구와 차이가 날 수 있다. 위치 연결은 영업 여부 자체를 증명하지 않는다.

## 좌표 재생성

원본 `matjip.db`를 갱신했거나 인허가 자료가 갱신되었을 때 실행한다. 기존 `locations.db`는 먼저 별도 백업한다. 변환 중 구 좌표계와 신 좌표계의 값이 100m 넘게 어긋나거나 같은 지번에서 두 건물 좌표가 100m 넘게 충돌하면 그 주소는 제외한다.

```powershell
node scripts/import-seoul-public-coordinates.js 'C:\path\to\서울시 일반음식점 인허가 정보.csv' 'C:\path\to\locations.db'
```

`scripts/build-seoul-landmark-points.js`는 수동 검토된 리서치 결과로 정적 점 파일을 재생성하는 유지보수 도구다. `landmark-candidates.json`은 재생성 근거가 되는 리서치 캐시이며 런타임에서는 읽지 않는다. [Nominatim 사용 정책](https://operations.osmfoundation.org/policies/nominatim/)에 따라 사이트 실행 중 대량·자동 호출을 하지 않는다.

## 배포 전 게이트

1. `npm test`, `npm run test:nearby-ui`, `npm run test:usability`가 모두 통과한다.
2. 장소 82곳, 자치구 25개, 좌표 범위와 동명 지하철역·버스정류장 오선택을 확인한다.
3. `강동 이케아`, `코엑스`, `롯데월드몰`에서 500m·1km·2km·3km 결과가 반경 안에 있고 거리 오름차순인지 확인한다.
4. 320px/390px 모바일에서 장소 패널을 펼치고 검색·선택·해제할 수 있으며 가로 넘침이 없고 기본 첫 결과가 화면 위쪽에 나타나는지 확인한다.
5. 실제 배포 화면에서 위 절차를 다시 확인한다. 배포 전 또는 검증 미완료 시 99/100 이상으로 평가하지 않는다.

`locations.db`와 `seoul-landmark-points.json`을 배포물에 포함한다. `NEARBY_ENABLED=false`이면 기능을 끌 수 있다. `JUSO_ADDRESS_KEY`, `JUSO_COORD_KEY`, `KAKAO_REST_API_KEY`는 이 1차 기능의 필수 조건이 아니다.
