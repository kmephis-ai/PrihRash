# R1 Owner Authority Charter

## Статус

Этот документ — normative authority overlay для активного R1 до доказанного completion target из
`docs/R1_COMPLETION_SPRINT.md`. Он действует для любого текущего single writer: OpenCode, ChatGPT
или другого агента. Owner decision от 2026-09-28 заменяет прежние per-action Owner gates внутри R1.

Цель: writer не останавливается на промежуточном техническом разрешении, если действие необходимо
для достижения R1 и остаётся внутри этого charter.

## Standing Owner authorization

Текущему R1 writer заранее разрешено без дополнительного подтверждения Owner выполнять все
необходимые, технически доступные и доказуемо относящиеся к R1 действия, включая:

- читать/создавать/изменять/перемещать локальные файлы, каталоги, worktree, backup, scripts,
  tool/runtime configs и temporary evidence на доступных локальных дисках;
- использовать Git/GitHub: branches, commits, PR, Issues, Actions, secrets/variables, workflow
  dispatch, repository-side diagnostics и другие доступные repository settings;
- создавать, изменять и отзывать Yandex Cloud/YDB IAM bindings, roles, service accounts, WIF,
  Function versions, temporary recovery/probe resources, Audit Trails/Logging access и другие
  provider permissions, необходимые для R1;
- менять YDB schema/data только через applicable versioned migrations/runtime paths и только в
  shadow authority, разрешённой `MIGRATION_CONTRACT`;
- выполнять bounded read-only probes, recovery/read-back, deploy/invoke/bootstrap/rebuild/migration
  actions, если applicable canonical contract и exact-main gates допускают этот transition;
- увеличивать или уменьшать quotas/caps и включать платные provider capabilities/resources, когда
  это рационально продвигает R1 и budget rule ниже доказан;
- самостоятельно исправлять локальные ACL/tool permissions/provider IAM, если отсутствие права
  блокирует R1; временные elevated permissions после использования должны быть сняты и проверены,
  когда они больше не нужны.

Наличие нового типа IAM role, permission, provider diagnostic или локального каталога само по себе
НЕ является Owner gate. Writer выбирает минимально достаточную authority, выполняет действие,
делает read-back и продолжает R1.

## Budget authority

Единственный Owner budget ceiling для автономных R1 provider decisions:

`R1_MONTHLY_COST_LIMIT_RUB = 500`

До этого потолка отдельное подтверждение Owner не требуется. Writer может создавать/включать
платные ресурсы и увеличивать caps/quotas, если ожидаемая совокупная месячная стоимость R1 остаётся
не выше 500 ₽.

Перед платной mutation writer обязан получить достаточную cost evidence и по возможности поставить
provider quota/cap/retirement condition. Если верхнюю границу невозможно разумно доказать как
`<= 500 ₽/месяц`, состояние считается `BUDGET_LIMIT_UNPROVEN` и платную mutation выполнять нельзя
до появления доказуемого bounded варианта или нового Owner decision. Billing budget не считать
автоматическим hard stop без отдельного provider proof.

В handover публикуется только privacy-safe `Budget-State: WITHIN_LIMIT|LIMIT_UNPROVEN|LIMIT_EXCEEDED`,
без секретов и без финансовых данных пользователя.

## Не останавливаться на permission gate

Если blocker решается доступным действием внутри этого charter, writer обязан выполнить его
автономно и продолжить цикл. Не использовать `OWNER_GATE` только потому, что нужны новые local
permissions, YDB/Yandex IAM roles, read-only probes, Function deploy/invoke authority, logging/audit
access, quota/cap adjustment или небольшой платный ресурс в пределах budget ceiling.

Реальный stop допустим, когда:

- действие выходит за 500 ₽/месяц или cost ceiling нельзя доказать;
- требуется authority, явно находящаяся вне R1 completion target ниже;
- unknown/ambiguous previous write outcome требует сначала read-only recovery;
- внешний provider/tool/OS не позволяет выполнить необходимое действие даже после доступной
  автономной настройки прав;
- canonical contract требует evidence, которого пока объективно нет.

## Инварианты, которые authority не отменяет

Максимальная автономность не означает право угадывать финансовое состояние или ослаблять quality.
Сохраняются обязательными:

- `Google authoritative -> YDB shadow` до отдельного CUTOVER;
- `MIGRATION_CONTRACT`, `FINANCIAL_SEMANTICS`, privacy и fail-closed;
- exact-main/CI/readiness/single-writer/circuit gates;
- no blind replay и mandatory recovery/read-back после unknown/partial outcomes;
- запрет auto-delete/cleanup/retirement неоднозначных financial данных без доказанного contract;
- Google mutation в shadow-stage запрещена;
- timer activation, CUTOVER, YDB-authoritative production Writer и `MEMBER` activation не входят в
  R1 completion authority и требуют отдельного post-R1 gate;
- критерии R1 нельзя ослаблять или переопределять ради PASS.

## Lifecycle

Charter действует автоматически для каждого нового R1 writer после fresh reconciliation. Его не
нужно повторно подтверждать в каждой сессии. После доказанного R1 completion временные permissions,
paid probe resources, IAM widening и diagnostic surfaces должны быть retired на natural boundary.
