# R2 OWNER auth — Yandex ID identity boundary

## Решение

Initial production role остаётся только `OWNER`. `MEMBER` не активируется этим contract.

Для входа пользователя PrihRash использует **backend-mediated Yandex ID OAuth authorization-code flow**. OAuth token Яндекс ID остаётся на backend и не становится Reader API credential, не хранится в IndexedDB/localStorage и не передаётся PWA как долгоживущий bearer token.

Минимальная последовательность будущего transport item:

```text
PWA
→ Yandex ID authorization code (+ PKCE/state)
→ backend token exchange
→ Yandex ID /info (Authorization header)
→ authorizeYandexOwnerIdentity()
→ secure PrihRash session
→ OWNER Reader API
```

Этот документ фиксирует только identity semantics. HTTP routes, session cookie/token format, CSRF handling и provider deployment являются следующими отдельными S-unit.

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

## Следующий S-unit

После этого identity boundary следующий минимальный auth item должен определить backend callback/session lifecycle:

- state + PKCE verification;
- server-side code exchange;
- `/info` request через `Authorization` header;
- вызов этого exact OWNER verifier;
- secure session с коротким понятным lifetime;
- logout/revocation behavior;
- no OAuth token persistence в browser storage.

До этого момента PWA/Reader transport не считается production-authenticated.
