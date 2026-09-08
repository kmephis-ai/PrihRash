# R2 OWNER auth — Yandex ID identity boundary

## Решение

Initial production role остаётся только `OWNER`. `MEMBER` не активируется этим contract.

Для входа пользователя PrihRash использует **backend-mediated Yandex ID OAuth authorization-code flow**. OAuth token Яндекс ID остаётся на backend и не становится Reader API credential, не хранится в IndexedDB/localStorage и не передаётся PWA как долгоживущий bearer token.

Canonical browser-facing auth sequence:

```text
PWA
→ Yandex ID authorization code (+ PKCE/state)
→ backend token exchange
→ Yandex ID /info (Authorization header)
→ authorizeYandexOwnerIdentity()
→ secure PrihRash session
→ OWNER Reader API
```

Документ фиксирует identity, application-flow и transport semantics. Concrete durable persistence и provider deployment остаются отдельными S-unit.

## Почему не API Gateway JWT authorizer напрямую

Yandex ID умеет возвращать JWT из `/info?format=jwt`, но это не совместимый вход для `x-yc-apigateway-authorizer:jwt`:

- Yandex ID документирует JWT, подписанный shared secret; официальный пример использует `HS256`;
- Yandex API Gateway JWT authorizer поддерживает `RS256/384/512` и `ES256/384/512` и проверяет подпись через public JWKS.

Поэтому PrihRash **не** подменяет несовместимость собственным guessed JWKS, не публикует OAuth client secret как verification key и не передаёт Yandex ID JWT напрямую в API Gateway JWT authorizer.

API Gateway function authorizer существует и может быть рассмотрен позже как transport optimization, но он не меняет canonical OWNER identity rule из этого документа.

## Canonical OWNER identity

После server-side запроса Yandex ID `/info` provider response считается untrusted input.

OWNER разрешён только при одновременном exact match:

```text
provider client_id == private configured OAuth client_id
AND
provider psuid == private configured OWNER psuid
```

`psuid` выбран как app-scoped identifier: Yandex ID формирует его на своей стороне из пары OAuth `client_id` + user identity. Дополнительная проверка `client_id` запрещает принимать identity evidence, выпущенный для другого OAuth application boundary.

Private expected values существуют только в runtime configuration. Реальные `client_id`, `psuid`, login/email и OAuth tokens не коммитятся и не публикуются в Issues/PR/Actions.

## Fail-closed result

`authorizeYandexOwnerIdentity()` возвращает только один из safe results:

```text
{ status: "AUTHORIZED", role: "OWNER" }
{ status: "DENIED", code: "AUTH_CONFIG_INVALID" }
{ status: "DENIED", code: "AUTH_IDENTITY_INVALID" }
{ status: "DENIED", code: "OWNER_IDENTITY_FORBIDDEN" }
```

Ни один denial result не содержит raw provider/config values.

Правила:

- malformed/missing private config → `AUTH_CONFIG_INVALID`;
- malformed/missing `client_id`/`psuid` → `AUTH_IDENTITY_INVALID`;
- любой exact mismatch → единый `OWNER_IDENTITY_FORBIDDEN`;
- `login`, email, display name и любые другие profile fields **никогда** не являются fallback identity;
- fuzzy/normalized identity matching запрещён;
- unknown profile fields игнорируются и не расширяют permission contract.

## OAuth и Yandex Cloud IAM — разные boundary

Yandex ID OAuth для входа пользователя в сторонний сервис и OAuth-token authentication к Yandex Cloud resource API — разные задачи.

С 1 июня 2026 Yandex Cloud IAM больше не принимает новые Yandex ID OAuth tokens как способ Cloud authentication. PrihRash не использует пользовательский Yandex ID OAuth token для доступа к Yandex Cloud resources: Cloud Functions/YDB/API Gateway используют собственные provider identities/service accounts по соответствующим contracts.

## Callback/session application boundary

`yandexOwnerOAuthFlow.ts` фиксирует framework-neutral lifecycle до HTTP/provider deployment:

- begin-login создаёт transaction-specific 256-bit `state` и PKCE verifier; используется только `S256`;
- pending transaction хранится через `YandexOwnerOAuthTransactionStore` и callback atomically `consume` её до token exchange; повторный callback fail-closed;
- transaction lifetime не превышает documented Yandex authorization-code lifetime 10 минут;
- `YandexOwnerOAuthProvider` выполняет server-side code exchange с exact stored `codeVerifier`, затем `/info`; OAuth token не передаётся в session issuer;
- `/info` обязательно проходит `authorizeYandexOwnerIdentity()`;
- только после OWNER PASS `OwnerSessionIssuer` получает `{ role: OWNER, issuedAtMs, expiresAtMs }`; session TTL ограничен 5..60 минутами;
- logout использует explicit `OwnerSessionRevoker`; concrete persistence пока не выбрана;
- callback/provider/storage/runtime failures возвращают только value-free safe codes.

Authorization redirect URL, callback code/state и session handle являются runtime-sensitive transport values и не считаются log-safe evidence.

## Browser transport boundary

Browser-facing OWNER auth использует только Yandex API Gateway → private Cloud Function integration с `payload_format_version: 2.0`. Direct HTTPS URL Cloud Functions не является допустимым auth ingress: Cloud Functions фильтрует входящий `Cookie`, поэтому такой transport не может корректно поддерживать server-side browser session.

`yandexOwnerAuthTransport.ts` принимает только API Gateway v2 event с Yandex `requestContext.apiGateway` marker и exact routes:

```text
GET  /auth/yandex/start
GET  /auth/yandex/callback
POST /auth/logout
```

Transport rules:

- start вызывает canonical `beginYandexOwnerLogin()` и делает redirect на Yandex OAuth;
- callback передаёт application layer только `state`, `code` или `error`; никакие дополнительные query-поля не расширяют contract;
- после OWNER PASS opaque session handle кодируется только как cookie-safe base64url и выдаётся host-only cookie `__Host-prihrash_session`;
- cookie имеет `HttpOnly; Secure; Path=/; SameSite=Lax`, bounded `Max-Age` из exact session expiry и не имеет `Domain`;
- callback URI обязан exact-match `appOrigin + /auth/yandex/callback`;
- logout разрешён только `POST`, требует exact HTTPS `Origin == appOrigin`, вызывает `OwnerSessionRevoker` и после успешного revoke очищает cookie;
- malformed/non-v2/direct-function transport fail-closed до auth/provider mutations;
- auth responses используют `Cache-Control: no-store` и не отражают callback code/state, OAuth token, session handle, `client_id`, `psuid` или provider error body.

`yandexOAuthHttpProvider.ts` является concrete Yandex network adapter:

- authorization code обменивается server-side через Yandex `/token`;
- при PKCE передаётся exact stored `code_verifier`; `client_secret` не требуется и не добавляется в этот flow;
- `/info` вызывается только через `Authorization: OAuth <token>`; token не помещается в URL/query;
- access/refresh token не возвращается transport/session layer; provider failures collapse в value-free error.

API Gateway должен вызывать private Function через отдельную provider identity/service account. Это provider deployment requirement, а не browser credential.

## Durable persistence boundary

Concrete OWNER auth persistence использует ту же YDB/runtime boundary, но **не** расширяет financial `schema_migrations`. Первый auth bootstrap contract хранится отдельно в `db/auth/001_owner_auth.sql` и создаёт только `owner_oauth_transactions` + `owner_sessions`. Это deliberate separation: R1 readiness #302 продолжает exact fail-closed проверку applied financial migrations `1..2`; наличие versioned auth DDL в repository само по себе не является provider mutation.

`YdbOwnerAuthPersistence` реализует `YandexOwnerOAuthTransactionStore`, `OwnerSessionIssuer`, `OwnerSessionRevoker` и `OwnerSessionVerifier`:

- OAuth `state` используется для lookup только как SHA-256 hex; raw state не хранится primary key;
- transaction `create` использует insert-only semantics, collision не перезаписывает pending flow;
- `consume` выполняет exact read + delete в одной `serializableReadWrite` transaction, поэтому successful consume one-time; commit-unknown/storage failures fail-closed;
- session issuer генерирует 32 cryptographically-random bytes → 43-char base64url handle; browser получает opaque handle, YDB получает только SHA-256 handle;
- session row хранит только role `OWNER`, issue/expiry times и hash; OAuth access token/profile не попадают в session storage;
- verifier принимает handle + backend current time и разрешает только exact stored `OWNER` при `issuedAt <= now < expiresAt`; cookie `Max-Age` не является security authority;
- revoke удаляет exact hashed session; subsequent verification fail-closed;
- malformed YDB evidence и provider/commit failures имеют только value-free persistence error codes.

Auth DDL **не применяется** этим repository S-unit. Его real YDB apply и wiring в API Gateway/private Function разрешаются только отдельным provider item после successful canonical R1 readiness #302 и fresh provider discovery. Process-local memory остаётся запрещён в production.

Следующая R2 auth/runtime boundary после provider-safe schema apply — связать OWNER session verifier с Reader HTTP route `/api/v1/operations/recent` и existing API Gateway v2 transport, не меняя Reader FIN-TRUTH semantics.

OAuth/session tokens по-прежнему не сохраняются в IndexedDB/localStorage.
