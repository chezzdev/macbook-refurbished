# MacBook Refurbished Singapore

Детерминированный каталог восстановленных MacBook Air и MacBook Pro из Apple
Singapore. Страница собирается из отдельных источников данных и публикуется на
неизменный адрес:

https://macbook-sg-refurbished.pages.dev

## Один полный запуск

```zsh
./work/update-published-site.zsh
```

Команда последовательно:

1. получает текущий refurbished-каталог Apple Singapore;
2. ищет цену нового устройства только для точного совпадения конфигурации,
   включая тип дисплея у MacBook Pro;
3. обновляет официальный кросс-курс SGD → USD;
4. валидирует и стабильно сортирует каталог;
5. применяет зафиксированную политику рейтинга;
6. дважды собирает HTML и сравнивает SHA-256;
7. запускает тесты и синхронизирует приватный GitHub-репозиторий;
8. публикует тот же артефакт в существующий Cloudflare Pages project и сверяет
   его хеш по постоянному URL.

Любая ошибка останавливает процесс до публикации.

## Источники и правила

- `data/catalog.json` — нормализованный каталог и точные новые цены.
- `data/changelog.json` — история реальных изменений каталога.
- `data/featured.json` — три результата рейтинга для верхней секции.
- `data/site.json` — постоянный URL и курс SGD → USD.
- `data/update-status.json` — время и итоговые счётчики обновления.
- `data/update-delta.json` — изменения относительно предыдущего запуска.
- `config/ranking-policy.json` — фиксированные веса, идеальная конфигурация и
  tie-breakers.

Эталон рейтинга: MacBook Air 13″, 24 ГБ памяти, SSD 1 ТБ. Цена, поколение чипа,
скидка и близость к этому эталону учитываются явно. Цветовые дубли не занимают
несколько мест в верхней тройке.

## Полезные команды

```zsh
npm run catalog:update
npm run currency:update
npm run catalog:validate
npm run catalog:rank
npm run catalog:summary
npm run build
npm test
```

## Ежедневное обновление

`work/daily-update.zsh` запускает полный процесс, сохраняет текстовый отчёт в
`outputs/latest-update-summary.txt` и показывает системное уведомление macOS.
LaunchAgent `dev.chezz.macbook-refurbished-sg.daily-update` запускает его каждый
день в 08:00 по локальному времени Mac.
