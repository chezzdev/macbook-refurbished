# MacBook Refurbished Markets

Общий детерминированный движок независимых каталогов восстановленных MacBook
из региональных Apple Store.

- **MacBook SG Refurbished** — действующий сайт:
  <https://macbook-sg-refurbished.pages.dev/>
- **MacBook US Refurbished** — отдельный сайт на том же Cloudflare Pages:
  <https://macbook-us-refurbished.pages.dev/>.

В интерфейсе есть переключатель рынков, построенный из
`config/markets/registry.json`. Он ведёт на канонический URL отдельного сайта и
не подмешивает данные другого рынка в текущую страницу. Новый enabled-профиль
появляется в переключателе без отдельного UI-кода.

## Архитектура рынков

Профили находятся в `config/markets/`. Каждый профиль владеет:

- Apple storefront и URL источников;
- исходной и основной валютами, locale, точностью отображения и конвертацией;
- моделью налога и фиксированной reference location;
- ссылкой на собственную ranking policy и идеальную конфигурацию;
- путями данных и выходного HTML;
- именем сайта, page title, hosting slug, общим publication repository,
  каноническим и production URL.

Singapore и US проходят через одни и те же parser, exact-new matcher, tax
adapter, validator, ranker, changelog, builder и publication workflow.
Данные и выходные артефакты полностью симметричны:
`data/markets/sg/*` и `data/markets/us/*`,
`outputs/markets/sg/index.html` и `outputs/markets/us/index.html`.

Эталон обоих первых профилей: MacBook Air 13″, 24 ГБ памяти, SSD 1 ТБ.
Политики изолированы: `config/ranking-policy.sg.json` для SG и
`config/ranking-policy.us.json` для US. Цветовые дубли одной точной
`configurationKey` не занимают несколько featured-мест; различия display,
CPU/GPU, памяти или SSD считаются отдельными конфигурациями. Порядок полностью
детерминирован.

## Цены и налоги

Точная цена нового устройства принимается только при полном совпадении экрана,
типа дисплея, чипа/tier, CPU/GPU, памяти и SSD. Standard и Nano-texture —
разные конфигурации.

Отсутствие отдельной новой конфигурации не останавливает refresh: её поля
остаются `null`. Каждый профиль при этом задаёт минимальные count/ratio
успешных exact matches, поэтому массовый сбой Apple или matcher-а останавливает
pipeline fail-closed.

SGD конвертируется в основную валюту USD по существующему официальному
кросс-курсу. Для US исходная и основная валюты — USD, поэтому курс равен 1.

US catalog market-wide и не фильтруется по delivery или pickup. Налоговый
ориентир:

> Apple Beverly Center, 8500 Beverly Boulevard, Los Angeles, CA 90048

Для фиксированной точки используется проверенная расчётная модель: sales tax
10,5% округляется до цента, затем добавляется официальный California recycling
fee — $4 для экранов меньше 15″ и $5 для экранов от 15″. Контрольная модель
`FDH94LL/A` дала в корзине Apple ровно тот же результат:
$1,529.00 + $160.55 + $4.00 = $1,693.55.
Валюта, точность minor unit и сборы принадлежат tax policy и обязаны совпадать
с исходной валютой профиля; контрольный checkout указывает размер экрана, а
валидатор сверяет его сбор с той же таблицей, которую использует runtime.
Точность отображения исходной и основной валют также принадлежит профилю:
общий UI не предполагает два знака после запятой. Общий калькулятор не
предполагает USD.

Pre-tax, налог, сбор и расчётный итог хранятся отдельно вместе с provenance —
как для refurbished, так и для точной цены нового устройства. На US-сайте
главным числом показан расчётный total, а под ним только формула
`цена + налог + сбор`. Для новой модели total появляется только там, где
pipeline нашёл точное совпадение конфигурации. Итог остаётся оценкой для Apple
Beverly Center, а не окончательным счётом Apple.
Если будущий профиль одновременно использует fixed-location tax и конвертацию,
страница показывает метод и дату курса, а в таблице сохраняет исходную
налоговую формулу рядом с пересчитанным total.

## Команды

Локальные проверки, не выполняющие live refresh:

```zsh
npm test
npm run build
npm run build:catalog -- --market sg
npm run build:catalog -- --market us
npm run catalog:rank:check -- --market sg
node scripts/initialize-market.mjs --market sg --check
```

Единый ежедневный workflow обходит все enabled-профили из registry
последовательно:

```zsh
./work/update-all-markets.zsh
```

Для запуска только Singapore используется:

```zsh
./work/update-published-site.zsh
```

Команда делегирует общему workflow выбранный market profile:

```zsh
./work/update-market-site.zsh --market sg
```

Общий workflow выполняет fetch, exact matching, currency/tax adapters,
validation, ranking, changelog, двойную детерминированную сборку, тесты,
private-repository sync, Cloudflare Pages deployment и live hash verification.
Новые данные сначала собираются в отдельном staging namespace; canonical JSON
и HTML продвигаются только после успешных проверок и live verification.
Прямые per-market запуски и общий ежедневный запуск используют один
publication lock, потому что все рынки синхронизируются через общий checkout.
Перед live publication workflow требует, чтобы все общие scripts, tests,
package/config files, market profiles и ranking policies совпадали с outer
Git HEAD, затем выполняет fetch/tests/build и source sync из временного
`git archive` этого зафиксированного HEAD. Изменения workspace во время
длительного refresh не могут попасть в публикацию. Незакоммиченные
pipeline-generated JSON/HTML не блокируют preflight.
Для провайдера без автоматического deploy `--prepare-only` оставляет canonical
state неизменным и возвращает путь к проверенному временному артефакту и его
SHA-256. Cloudflare CLI зафиксирован в `package-lock.json` и запускается только
из локального `node_modules`.
Оба рынка используют существующий checkout `work/gh-pages-site` и один remote;
публикуемые файлы изолированы как `markets/sg/index.html` и
`markets/us/index.html`. Каждый профиль выбирает собственный артефакт и
отдельный Cloudflare Pages project, поэтому постоянный SG URL не зависит от
расположения файла в repository. Полный US workflow использует тот же общий
путь без отдельного hosting-кода:

```zsh
./work/update-market-site.zsh --market us
```

Workflow выбирает артефакт и Cloudflare Pages project только из выбранного
market profile, поэтому данные и deployment targets SG и US не смешиваются.
Cross-rate adapter также берёт source/display валюты и имя поля результата из
профиля; `identity` разрешён только при одинаковых source/display валютах, а
cross-rate — только при разных. Новый рынок не требует валютного кода в общем
скрипте.
Registry fail-closed отклоняет совпадающие data/output namespace paths и
ranking-policy paths между рынками или внутри одного профиля. Проверяются
нормализованные фактические цели, включая локальный `index.html`; outputs не
могут пересекать immutable source directories. Staging сохраняет полные
profile paths и не сплющивает одинаковые basename.
Namespace layout намеренно строгий и lowercase ASCII: каждый рынок использует
`data/markets/<id>/*.json`; локальный HTML всегда
`outputs/markets/<id>/index.html`, publication HTML —
`markets/<id>/index.html`. Это исключает APFS case/Unicode aliases и
пересечение с `.gitignore`/source/publication targets.

## Ежедневное обновление всех рынков

`work/daily-update.zsh` вызывает `work/update-all-markets.zsh`, сохраняет общий
отчёт в
`outputs/latest-update-summary.txt` и показывает macOS notification.
Активная Codex automation `MacBook Refurbished Markets — daily update` в 08:00
Europe/Minsk использует тот же registry-driven entrypoint и является
единственным scheduler. Добавление enabled market не требует отдельной
scheduled-команды.
All-market entrypoint фиксирует один Git HEAD, читает registry из его archive
snapshot и передаёт тот же SHA каждому рынку; SG и US в одном batch не могут
быть собраны из разных commits.

Production UI существует в одном варианте:
`work/build-expanded-standalone.mjs`. `npm run build` валидирует и собирает
этот общий путь для каждого enabled-профиля; отдельного Vinext/Sites starter
в проекте нет.

## Добавление следующего рынка

Новый рынок добавляется конфигурацией, а не копированием pipeline или UI:

1. Создать `config/markets/<id>.json` и
   `config/ranking-policy.<id>.json`.
2. Задать storefront, currency/tax policy, ranking reference, симметричные
   `data/markets/<id>` и `outputs/markets/<id>` paths, а также отдельный
   publication target.
3. До явного одобрения внешнего hosting project оставить публикацию
   approval-gated; не переиспользовать SG или US project.
4. Добавить market id в `config/markets/registry.json`. После этого общий
   switcher, build и daily batch подхватят рынок без bespoke-кода.
5. Покрыть специфичную currency/tax policy synthetic profile-тестом и
   выполнить `npm test` и `npm run build` до канонического refresh.

README в publication checkout синхронизируется только общим каноническим
workflow; его не нужно редактировать отдельно.
