# MacBook Refurbished Markets

Общий детерминированный сайт каталогов восстановленных MacBook из региональных
Apple Store. Рынок является частью URL одного GitHub Pages site:

- **MacBook ES Refurbished**:
  <https://chezzdev.github.io/macbook-refurbished/markets/es/>
- **MacBook SG Refurbished**:
  <https://chezzdev.github.io/macbook-refurbished/markets/sg/>
- **MacBook US Refurbished**:
  <https://chezzdev.github.io/macbook-refurbished/markets/us/>.

В интерфейсе есть переключатель рынков, построенный из
`config/markets/registry.json`. Он меняет market path внутри общего сайта и не
подмешивает данные другого рынка в текущую страницу. Новый enabled-профиль
появляется в переключателе без отдельного UI-кода. Корень сайта перенаправляет
на Singapore как default market. Registry требует алфавитный порядок market id;
текущий порядок переключателя и процессов — `ES → SG → US`.

Выбранные фильтры и сортировка записываются в query parameters текущего URL.
Скопированная ссылка открывает тот же рынок с тем же состоянием таблицы;
несуществующие для каталога значения игнорируются, а параметры по умолчанию в
URL не добавляются.

## Актуальность документации

Этот README описывает только текущее устройство проекта. Operational source of
truth для агентов — workflow проекта в skill `update-macbook-catalog`. Любая
работа, которая меняет UI-контракт, market profile, команды, validation,
publication topology, scheduling или пользовательские приоритеты, обязана в той
же работе обновить workflow и затронутые разделы README.

Устаревший текст заменяется или удаляется: документы не хранят snapshots,
предыдущее поведение и историю миграций. История каталога принадлежит
pipeline-owned `data/markets/<id>/changelog.json`, а состояние последнего
запуска — `update-status.json` и `update-delta.json`.
Даты refresh (`checkedAt`), датированные записи catalog changelog и их
отображение на сайте обязательны: это операционные данные, а не история
документации.
`work/gh-pages-site/README.md` — генерируемое зеркало этого файла; его
синхронизирует только канонический publication workflow.

В верхнем подборе экран по умолчанию не ограничен. При желании можно выбрать
группу `13–14″` или `15–16″`: Air 13″ и Pro 14″ считаются одинаково
подходящими по размеру, как и Air 15″ с Pro 16″. Фильтр полной таблицы
по-прежнему использует точные диагонали. Обе панели используют одинаковые
внешние заголовки и размеры контролов; фильтры таблицы остаются dropdown-меню
с checkbox-вариантами.

Ссылка верхнего подбора самодостаточна: она всегда содержит выбранные линейку,
группу экрана, RAM и SSD, даже когда они совпадают с примером. Значение
`Не важно` записывается как `any`, а `max-price` присутствует только при
заданном бюджете. Поэтому смысл сохранённой ссылки не зависит от будущих
значений по умолчанию. Значения эталона профиля всегда остаются доступными в
контролах, даже если конкретный refresh временно не нашёл такую конфигурацию.

Полная таблица показывает одну строку на аппаратную `configurationKey`, а
доступные цветовые варианты — кружками внутри строки. Название активного цвета
стоит под кружками. Тот же выбор есть перед ссылкой Apple в каждой верхней
карточке, но в одну строку с названием. Выбор общий для карточек и таблицы:
смена цвета одновременно меняет product code, цены и обе Apple-ссылки. Цвет не
записывается в URL; по умолчанию всегда выбран первый показанный цвет.

## Архитектура рынков

Профили находятся в `config/markets/`. Каждый профиль владеет:

- Apple storefront и URL источников;
- исходной и основной валютами, locale, точностью отображения и конвертацией;
- моделью налога и фиксированной reference location;
- ссылкой на собственную ranking policy и идеальную конфигурацию;
- путями данных и выходного HTML;
- именем сайта, page title, общим GitHub Pages project и market-specific
  каноническим URL.

Spain, Singapore и US проходят через одни и те же parser, exact-new matcher,
tax adapter, validator, ranker, changelog, builder и publication workflow.
Данные и выходные артефакты полностью симметричны:
`data/markets/es/*`, `data/markets/sg/*` и `data/markets/us/*`,
`outputs/markets/es/index.html`, `outputs/markets/sg/index.html` и
`outputs/markets/us/index.html`.

Текущий эталон всех трёх профилей: MacBook Air 13″, 24 ГБ памяти, SSD 1 ТБ.
Политики изолированы: `config/ranking-policy.es.json` для ES,
`config/ranking-policy.sg.json` для SG и `config/ranking-policy.us.json` для
US. Текущая SG policy покрывает встречающийся в каталоге SSD 8 ТБ с оценкой
13000 milli-points; эталоном остаётся SSD 1 ТБ. Цветовые дубли одной точной
`configurationKey` не занимают несколько featured-мест; различия display,
CPU/GPU, памяти или SSD считаются отдельными конфигурациями. Порядок полностью
детерминирован.

## Цены и налоги

Точная цена нового устройства принимается только при полном совпадении экрана,
типа дисплея, чипа/tier, CPU/GPU, памяти, SSD и цвета. Каждый доступный цвет
проверяется отдельно, а `newSourceUrl` строится для этого же цвета. Standard и
Nano-texture — разные конфигурации.

Отсутствие отдельной новой конфигурации не останавливает refresh: её поля
остаются `null`. Каждый профиль при этом задаёт отдельные минимальные
count/ratio для конфигураций и цветовых вариантов, поэтому массовый или
частичный по цветам сбой Apple/matcher-а останавливает pipeline fail-closed.
Validator требует, чтобы сохранённый `newSourceUrl` совпадал с вычисленным URL
именно этого цветового варианта. До следующего canonical refresh старые записи
без такой provenance не исправляются при рендере, а безопасно показываются без
цены нового устройства и ссылки на него.

SGD конвертируется в основную валюту USD по существующему официальному
кросс-курсу. Для US исходная и основная валюты — USD, а для ES — EUR, поэтому
в обоих профилях курс равен 1. Цены Apple Spain уже включают IVA и показываются
в EUR с двумя знаками после запятой.

Apple Spain локализует каталог и точные buy-Mac URL: цены приходят в формате
`1.209,00 €`, а конфигурации используют `pulgadas`, `núcleos`, `memoria` и
`capacidad`. Профиль ES выбирает стиль URL `spanish`; SG и US — `english`.
Общий parser нормализует испанские названия чипов, ядер, дисплеев и цветов,
берёт точную цену из `raw_amount`, а production-код выбирает локализацию по
профилю, не по market id.

US catalog market-wide и не фильтруется по delivery или pickup. California
остаётся default tax location для pipeline:

> Apple Beverly Center, 8500 Beverly Boulevard, Los Angeles, CA 90048

Для фиксированной точки используется проверенная расчётная модель: sales tax
10,5% округляется до цента, затем добавляется официальный California recycling
fee — $4 для экранов меньше 15″ и $5 для экранов от 15″. Текущая контрольная
конфигурация профиля `FDH94LL/A` воспроизводит
$1,529.00 + $160.55 + $4.00 = $1,693.55.

На US-сайте tax location переключается в runtime, без перехода на другую
страницу. Профиль содержит четыре актуальные контрольные проверки для одного и
того же `FDH94LL/A`:

- California, Apple Beverly Center / ZIP 90048:
  `$1,529.00 + $160.55 tax + $4.00 CA recycling fee = $1,693.55`;
- Colorado, Apple Cherry Creek / ZIP 80206:
  `$1,529.00 + $139.90 tax + $0.31 State Delivery Fee = $1,669.21`;
- Massachusetts, Apple Boylston Street / ZIP 02116:
  `$1,529.00 + $95.56 tax = $1,624.56`;
- South Dakota, delivery ZIP 57105:
  `$1,529.00 + $94.80 tax = $1,623.80`.

У Apple нет retail store в South Dakota, поэтому этот вариант явно обозначен
как delivery ZIP. Выбор `CA / CO / MA / SD` меняет total, компактную формулу,
featured-карточки, диапазон цен, таблицу, скидки и price sorting на месте.
California — default и не добавляется в URL; `CO`, `MA` и `SD` канонично
отражаются в query-параметре `state`. Некорректное значение удаляется, а
filters, sorting, сторонние query parameters и hash сохраняются. HTML и
catalog остаются одними и теми же.

Переключатель штатов находится в header и использует те же размеры и
типографику, что и market switcher. Price columns не меняют положение между
штатами, а таблица целиком помещается в desktop viewport 1366 px без
горизонтального overflow. Refurb total является ссылкой на refurbished product
у Apple, exact-new total — на точную новую конфигурацию. Отдельной Apple-колонки
на US нет; `Nano-texture` выводится третьей строкой модели.

Валюта, точность minor unit и сборы принадлежат tax policy и обязаны совпадать
с исходной валютой профиля; контрольный checkout указывает размер экрана, а
валидатор сверяет его сбор с той же таблицей, которую использует runtime.
Точность отображения исходной и основной валют также принадлежит профилю:
общий UI не предполагает два знака после запятой. Общий калькулятор не
предполагает USD.

Pre-tax, налог, сбор и расчётный итог хранятся отдельно вместе с provenance —
как для refurbished, так и для точной цены нового устройства. На US-сайте
главным числом показан расчётный total, а под ним только формула
`цена + налог + применимые сборы`. Для новой модели total появляется только там, где
pipeline нашёл точное совпадение конфигурации. Итог остаётся оценкой для Apple
checkout в выбранной локации, а не окончательным счётом Apple.
Если будущий профиль одновременно использует fixed-location tax и конвертацию,
страница показывает метод и дату курса, а в таблице сохраняет исходную
налоговую формулу рядом с пересчитанным total.

## Команды

Локальные проверки, не выполняющие live refresh:

```zsh
npm test
npm run lint
npm run build
npm run build:catalog -- --market sg
npm run build:catalog -- --market us
npm run build:catalog -- --market es
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
синхронизацию публичного репозитория, GitHub Pages deployment и live hash
verification.
Новые данные сначала собираются в отдельном staging namespace; canonical JSON
и HTML продвигаются только после успешных проверок и live verification.
Per-market запуск обновляет catalog/state только выбранного рынка, но перед
publication валидирует canonical данные и дважды детерминированно пересобирает
HTML всех enabled-рынков. Поэтому изменение registry, switcher или общего UI
атомарно попадает во все sibling routes, не переписывая историю чужих
каталогов.
Прямые per-market запуски и общий ежедневный запуск используют один
publication lock, потому что все рынки синхронизируются через общий checkout.
Перед live publication workflow требует, чтобы все общие scripts, tests,
package/config files, market profiles и ranking policies совпадали с outer
Git HEAD, затем выполняет fetch/tests/build и source sync из временного
`git archive` этого зафиксированного HEAD. Изменения workspace во время
длительного refresh не могут попасть в публикацию. Незакоммиченные
pipeline-generated JSON/HTML не блокируют preflight.
Publication checkout при этом должен быть полностью чистым, находиться на
ожидаемой ветке и после `fetch` побайтово указывать тем же `HEAD`, что
`origin/<branch>`. Перед commit workflow повторно проверяет remote HEAD и
разрешает изменения только точных source/artifact paths из publication
manifest. Устаревшие directory roots можно только удалять вместе с их
содержимым: staged additions или modifications под ними отклоняются. Поэтому
локальный ahead-коммит или заранее подготовленный посторонний файл не может
попасть в публичную ветку.
Для провайдера без автоматического deploy `--prepare-only` оставляет canonical
state неизменным и возвращает путь к проверенному временному артефакту и его
SHA-256. Все рынки используют checkout `work/gh-pages-site`, один public remote
и одну ветку GitHub Pages; публикуемые файлы изолированы как
`markets/es/index.html`, `markets/sg/index.html` и `markets/us/index.html`. В отдельном outer worktree
checkout можно передать через абсолютный `MACBOOK_PUBLISH_DIR`. Полный US
workflow использует тот же общий путь без отдельного hosting-кода:

```zsh
./work/update-market-site.zsh --market us
```

Spain использует тот же канонический workflow с локализованным Apple matcher:

```zsh
./work/update-market-site.zsh --market es
```

Если GitHub Pages недоступен, одна и та же проверенная публикационная сборка
разворачивается на обоих существующих Cloudflare Pages проектах. Каждый
fallback-домен содержит все enabled-рынки:

- <https://macbook-sg-refurbished.pages.dev/markets/es/>
- <https://macbook-sg-refurbished.pages.dev/markets/sg/>
- <https://macbook-sg-refurbished.pages.dev/markets/us/>
- <https://macbook-us-refurbished.pages.dev/markets/es/>
- <https://macbook-us-refurbished.pages.dev/markets/sg/>
- <https://macbook-us-refurbished.pages.dev/markets/us/>

```zsh
MACBOOK_PUBLISH_DIR=/absolute/path/to/work/gh-pages-site \
  ./work/deploy-unified-cloudflare-fallback.zsh
```

Fallback-команда использует тот же общий publication lock, требует полностью
чистый checkout именно канонического repository/branch и точное
`HEAD == origin/main`. Канонический remote/branch проверяется по доверенному
source-controlled contract до создания `git archive` и до запуска кода из
publication checkout. После этого команда фиксирует commit, читает enabled
markets и их artifact routes из registry-driven publication manifest внутри
архива, а затем публикует именно распакованный immutable archive в каждый
проект. Для каждого enabled market проверяется точный SHA-256 его страницы;
dirty-checkout override не используется. Поэтому новый enabled market
автоматически появляется на обоих fallback-доменах без отдельной правки
deploy-скрипта.

Workflow выбирает артефакт и market URL только из выбранного профиля, поэтому
данные ES, SG и US не смешиваются, хотя публикуются на одном сайте.
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

## Защита публичного репозитория

Публичный репозиторий `chezzdev/macbook-refurbished` использует GitHub
secret scanning с push protection, Dependabot alerts и automated security
fixes. `main` защищена без PR, status-check и signed-commit requirements:
daily automation по-прежнему может делать обычные fast-forward direct pushes,
но force-push и deletion запрещены, а правила применяются к admins.

Канонический Dependabot config находится в source worktree:
`.github/dependabot.yml`. Он проверяет npm-зависимости в корне раз в неделю и
держит небольшой лимит открытых PR. Publication manifest считает этот файл
immutable source-owned path, поэтому общий canonical workflow копирует его в
`work/gh-pages-site` и публичный `main`; вложенную копию не нужно редактировать
отдельно. Local Git email publication checkout настроен на GitHub noreply,
история публичного репозитория не переписывается.

## Ежедневное обновление всех рынков

`work/daily-update.zsh` вызывает `work/update-all-markets.zsh`, сохраняет общий
отчёт в
`outputs/latest-update-summary.txt` и показывает macOS notification.
Активная Codex automation `MacBook Refurbished Markets — daily update` в 08:00
Europe/Minsk использует тот же registry-driven entrypoint и является
единственным scheduler. Добавление enabled market не требует отдельной
scheduled-команды.
All-market entrypoint фиксирует один Git HEAD, читает registry из его archive
snapshot и передаёт тот же SHA каждому рынку. Registry валидируется как
алфавитный, поэтому текущий batch идёт `ES → SG → US`; рынки в одном batch не
могут быть собраны из разных commits.

Production UI существует в одном варианте:
`work/build-expanded-standalone.mjs`. `npm run build` валидирует и собирает
этот общий путь для каждого enabled-профиля; отдельного Vinext/Sites starter
в проекте нет. Модуль picker-а и его unit-тест входят в immutable publication
manifest и обязательную stage-3 проверку канонического workflow.

## Добавление следующего рынка

Новый рынок добавляется профилем, а не копированием pipeline или UI. Рабочий
порядок разделён на discovery, безопасный preview и активацию.

Сначала нужно проверить реальный Apple storefront: refurbished JSON, buy-Mac
URL и title для Air/Pro, всех цветов и Nano-texture при наличии. Для
локализованных цен числовым источником служит `raw_amount`, а не отформатированная
строка. Профиль явно выбирает грамматику exact-product URL. Сейчас общий
adapter поддерживает `english` и `spanish`; новый языковой формат требует
добавить именованный стиль, общий parser/URL builder и fixtures, но не ветвление
по market id.

Затем:

1. Создать `config/markets/<id>.json` и
   `config/ranking-policy.<id>.json` с уникальными симметричными путями
   `data/markets/<id>/*`, `outputs/markets/<id>` и `markets/<id>`.
2. Оставить профиль в состоянии `approval-required`, добавить id в рабочий
   `config/markets/registry.json` в алфавитном порядке и покрыть новые parser,
   URL, currency/tax и profile-возможности тестами.
3. Проверить, что `ranking.reference` совпадает с policy `ideal`, ценовые поля
   policy соответствуют профилю, а score maps покрывают все найденные RAM,
   SSD, form factors и поколения чипов. Неизвестное значение намеренно
   останавливает ranking; score нельзя придумывать без явного одобрения.
4. Настроить exact-match guards отдельно для конфигураций и цветовых вариантов
   по реальному результату storefront, не ослабляя их ради обхода ошибки.
5. Выполнить безопасный end-to-end preview без изменения canonical state и
   публикации:

   ```zsh
   ./work/update-market-site.zsh --market <id> --prepare-only
   ```

До первого canonical refresh у enabled-рынка ещё нет локального catalog, поэтому
на этой стадии используются `--prepare-only`, targeted tests и lint. Полные
`npm test` и `npm run build` выполняются после первичного seed.

После одобрения URL профиль переводится в `active`, immutable source/config,
тесты и документация коммитятся. Первый live-запуск должен быть только для
нового рынка:

```zsh
MACBOOK_PUBLISH_DIR=/Users/alexander/Documents/vibe/macbook-refurbished/work/gh-pages-site \
  ./work/update-market-site.zsh --market <id>
```

Нельзя начинать с `update-all-markets.zsh`: рынок, стоящий раньше в registry,
пересобирает HTML всех enabled-профилей и потребует ещё не созданные canonical
данные нового рынка. После seed запускаются `npm test`, `npm run lint`,
`npm run build`, затем полный `update-all-markets.zsh` и только после его
успеха — unified Cloudflare fallback. Финальная проверка сравнивает HTTP 200 и
точный hash каждого market artifact на GitHub Pages и обоих Cloudflare
проектах.

Само включение в registry автоматически добавляет рынок в switcher,
all-enabled build, daily batch, publication manifest и оба Cloudflare mirror.
Отдельная scheduled-команда, новый page builder, hardcoded fallback route и
ручной baseline/changelog не нужны.

README в publication checkout синхронизируется только общим каноническим
workflow; его не нужно редактировать отдельно.
