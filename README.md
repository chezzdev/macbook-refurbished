# MacBook Refurbished Markets

Общий детерминированный движок независимых каталогов восстановленных MacBook
из региональных Apple Store.

- **MacBook SG Refurbished** — действующий сайт:
  <https://macbook-sg-refurbished.pages.dev/>
- **MacBook US Refurbished** — отдельный Sites-проект:
  <https://macbook-us-refurbished.whole-acorn-4078.chatgpt.site/>. Сейчас
  доступ owner-only; публичный доступ требует отдельного явного одобрения.

В интерфейсе есть переключатель рынков, построенный из
`config/markets/registry.json`. Он ведёт на канонический URL отдельного сайта и
не подмешивает данные другого рынка в текущую страницу. Новый enabled-профиль
появляется в переключателе без отдельного UI-кода.

## Архитектура рынков

Профили находятся в `config/markets/`. Каждый профиль владеет:

- Apple storefront и URL источников;
- исходной и основной валютами и конвертацией;
- моделью налога и фиксированной reference location;
- ссылкой на собственную ranking policy и идеальную конфигурацию;
- путями данных и выходного HTML;
- именем сайта, hosting slug, общим publication repository, каноническим и
  production URL.

Singapore и US проходят через одни и те же parser, exact-new matcher, tax
adapter, validator, ranker, changelog, builder и publication workflow.
Singapore сохраняет исторические `data/*` как собственный namespace профиля —
это совместимость данных, а не отдельный кодовый путь.
Выходные артефакты при этом полностью симметричны:
`outputs/markets/sg/index.html` и `outputs/markets/us/index.html`.

Эталон обоих первых профилей: MacBook Air 13″, 24 ГБ памяти, SSD 1 ТБ.
Политики изолированы: `config/ranking-policy.json` для SG и
`config/ranking-policy.us.json` для US. Цветовые дубли не занимают несколько
featured-мест; порядок полностью детерминирован.

## Цены и налоги

Точная цена нового устройства принимается только при полном совпадении экрана,
типа дисплея, чипа/tier, CPU/GPU, памяти и SSD. Standard и Nano-texture —
разные конфигурации.

SGD конвертируется в основную валюту USD по существующему официальному
кросс-курсу. Для US исходная и основная валюты — USD, поэтому курс равен 1.

US catalog market-wide и не фильтруется по delivery или pickup. Налоговый
ориентир:

> Apple Beverly Center, 8500 Beverly Boulevard, Los Angeles, CA 90048

Итоговая цена с налогом допускается только с provenance собственного checkout
flow Apple. Адаптер хранит pre-tax и final price отдельно. Если надёжная
Apple-котировка недоступна, final price остаётся `null` со статусом
`unresolved`; локально рассчитанная ставка не выдаётся за цену Apple.

## Команды

Локальные проверки, не выполняющие live refresh:

```zsh
npm test
npm run build:catalog -- --market sg
npm run build
npm run catalog:rank:check -- --market sg
node scripts/initialize-market.mjs --market sg --check
```

Полный действующий Singapore workflow по-прежнему запускается неизменной
командой:

```zsh
./work/update-published-site.zsh
```

Она является тонким compatibility wrapper над общим workflow:

```zsh
./work/update-market-site.zsh --market sg
```

Общий workflow выполняет fetch, exact matching, currency/tax adapters,
validation, ranking, changelog, двойную детерминированную сборку, тесты,
private-repository sync, Cloudflare Pages deployment и live hash verification.
Оба рынка используют существующий checkout `work/gh-pages-site` и один remote;
публикуемые файлы изолированы как `markets/sg/index.html` и
`markets/us/index.html`. Старый корневой `index.html` SG удаляется при следующей
канонической синхронизации. Каждый профиль выбирает собственный артефакт и
отдельный hosting project, поэтому постоянный SG URL не зависит от расположения
файла в repository. US использует Sites, поэтому общий workflow запускается для
него с `--prepare-only`: он обновляет и полностью проверяет профильный
артефакт, но не отправляет его в SG Cloudflare Pages project. Сохранение версии
и deployment выполняются через Sites из того же исходного дерева.

## Ежедневное обновление Singapore

`work/daily-update.zsh` продолжает вызывать
`work/update-published-site.zsh`, сохраняет отчёт в
`outputs/latest-update-summary.txt` и показывает macOS notification.
LaunchAgent `dev.chezz.macbook-refurbished-sg.daily-update` остаётся
Singapore-only и не изменяется.
