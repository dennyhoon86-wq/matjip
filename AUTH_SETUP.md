# 미식장부 로그인 연결

관리자 계정은 `dennyhoon86@gmail.com`으로 고정되어 있습니다.

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase-schema.sql` 전체를 실행합니다.
3. Authentication → Providers에서 Google을 켜고, Google Cloud의 OAuth Client ID와 Secret을 입력합니다.
4. Authentication → URL Configuration의 Site URL 및 Redirect URL에 아래 주소를 추가합니다.
   - `https://matjip-production-cfeb.up.railway.app`
5. Railway Variables에 `.env.example`의 다섯 값을 채웁니다. 마지막으로 `AUTH_REQUIRED=true`로 바꿉니다.

`SUPABASE_SERVICE_ROLE_KEY`는 Railway에만 저장하며 브라우저나 GitHub에는 절대 넣지 않습니다.

전환 후 첫 Google 로그인은 관리자 권한이 되고, 다른 계정은 자동으로 `승인 대기`가 됩니다. 관리자는 사이트 상단의 `승인 관리`에서 표시 이름과 이메일을 보고 허용 또는 차단합니다.
