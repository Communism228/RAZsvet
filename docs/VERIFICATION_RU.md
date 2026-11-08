# Проверки 0.6.0

- 72 теста модели и ресурсов: пройдены.
- 33 новых браузерных проверки и 28 регрессионных: пройдены в Chromium 144.
- Автоматическая стратегия прошла шесть областей с настоящими масками, ценами и бюджетом.
- Строгая проверка TypeScript Canvas-версии и сборка `standalone/`: пройдены.

## Ограничения среды

Переход Chromium на localhost блокируется (`ERR_BLOCKED_BY_ADMINISTRATOR`).
Браузерный fixture загружает реальные скомпилированные модули; подменяет только доставку ресурсов и localStorage, не игровую логику.
Воспроизведение тестового WAV и загрузка FontFace проверены реально. Тестовый тон не является музыкой игры и не включён в релиз.
Проверена обработка недоступности IndexedDB. Постоянное хранение файлов после HTTP-перезагрузки в этой среде не проверено.

`npm install` завершился ошибкой DNS `EAI_AGAIN registry.npmjs.org`; полная Vite/Phaser-сборка здесь не проверена. Версии зависимостей не менялись.

## Воспроизведение

```bash
npm test
npm run check:native
npm run build:standalone
node tests/actual-playthrough.mjs
# Requires Python Playwright and /usr/bin/chromium:
python3 tests/v06-browser.py --font-zip "/path/to/rodchenko.zip"
python3 tests/v05-browser.py
```

Старые отчёты в `docs/history/` относятся к предыдущим версиям.
