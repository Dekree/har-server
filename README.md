# Custom HAR Server


### Запуск сервера

1. Склонировать репозиторий.
2. Создать HAR файл необходимого сайта и сохранить его в рутовой директории Custom HAR Server.
3. Настроить конфиг файл(см. ниже).
4. Установить зависимости командой:

```js
npm run start -- localhost.har -p 4646
```

5. Запустить сервер командой:

```js
npm run start -- localhost.har -p 4646
```

где:
localhost.har - имя HAR файла;
4646 - порт на котором будет висеть Custom HAR Server


### Настройка конфиг файла(config.js)

* serverUrl - адрес сервера, куда будет проксироваться запрос

* serverPort - порт сервера, куда будет проксироваться запрос(по умолчанию: 80)

* serverProtocol - протокол который будет использоваться при обращении к серверу(по умолчанию: http)

* filterPaths - массив путей которые необходимо брать из HAR файла. Возможные варианты:
```
а) Пустой массив - все запросы будут проксироваться на сервер.
В случае если сервер ответит ошибкой, то будет попытка достать данные из HAR файла

б) Один айтем 'all' в массиве - специальное слово, все запросы будут доставаться из HAR файла

в) '/path/to/data' - когда указанны точные пути, все запросы по этим путям будут доставаться из HAR файла,
а все остальные будут проксироваться на сервер
```