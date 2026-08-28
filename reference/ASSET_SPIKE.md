# Stage 2 asset spike

Статус: начат 2026-08-23. Эталонные файлы и их SHA-256 закреплены в
[`extraction-fixtures.json`](./extraction-fixtures.json); оригинальные данные остаются только в
ignored `game-data/`.

## Выбранный срез

- машина: `Wildfire`, основной вариант `WILDFIRE4.DFF` и `WILDFIRE.TXD`;
- трасса: `Warzone`, `GRAPHICS.BSP`, `COLLIDE.BSP` и `WARZONE.TXD`;
- RenderWare library id выбранных файлов: `0x1c02000a`.

## Подтверждённые результаты

### Wildfire DFF

Браузерно-совместимый reader разбирает `Clump`, frame list, geometry list, atomics, morph targets,
material list и texture references. Для `WILDFIRE4.DFF` получены:

- 52 frames;
- 46 geometries и 46 atomics;
- 5 582 вершины и 6 092 треугольника;
- texture references `BrokenGlass`, `Glass`, `Wildfire` и `WildfireSmall`.

Все шесть основных вариантов `WILDFIRE0.DFF`–`WILDFIRE5.DFF` проходят reader. В asset viewer
frame matrices дают цельную узнаваемую машину без ручных поправок к отдельным частям.

### Wildfire TXD

PC-словарь использует platform-independent root chunk `0x23`, а не native texture chunk. Reader
декодирует `Image + Texture`, palette RGBA, row stride и mip chains. В словаре пять текстур:

- `BrokenGlass`: 64×64, 8-bit palette;
- `Glass`: 16×16 → 1×1, 4-bit palette;
- `CarGloss`: 128×128, 8-bit palette;
- `WildfireSmall`: 64×64, 8-bit palette;
- `Wildfire`: 512×512 → 1×1, 8-bit palette.

### Texture corpus, formats и alpha

Проверены все 78 найденных TXD: 59 platform-independent PC-словарей, 17 PS2 native и два Xbox
native. Все PC-словари полностью декодируются без ошибок — это 1 488 текстур и 8 461 mip image.
Распределение mip image по фактическому формату:

- 1 713 `palette4`;
- 6 081 `palette8`;
- 667 `rgba32`;
- `rgb24` и DXT/BC в извлечённом корпусе не встретились.

В RenderWare `Image` с depth 4 индекс палитры занимает один байт, а строки дополняются до
заданного `stride`; это подтверждено всеми 1 713 изображениями, а не предполагается как packed
nibbles. Reader проверяет размер каждого изображения и последовательность размеров mip chain.
Viewer загружает исходные mip levels в GPU вместо их повторной генерации, когда цепочка есть.

Alpha теперь классифицируется явно по декодированным texels: `opaque` для полностью непрозрачной
текстуры, `mask` для только 0/255 и `blend` при наличии промежуточного alpha. Для 1 488 base levels
получены 1 204 opaque, 37 mask и 247 blend; viewer соответственно выбирает opaque depth write,
alpha test или transparent blending.

Native inspector отдельно распознаёт platform/device и безопасно сообщает заголовки вместо
попытки декодировать native raster как PC image. В 17 PS2-словарях найдено 99 raster платформы
`PS2`, в двух Xbox-словарях — 24 raster платформы `5`; у всех Xbox raster поле compression равно
нулю. Layout заголовка и значение compression сверены с реализацией
[`librw` Xbox raster](https://github.com/aap/librw/blob/master/src/d3d/xbox.cpp). Полный PS2/Xbox
raster decode не требуется runtime-срезу: для моделей и трасс присутствуют соответствующие PC TXD,
а PI decoder выдаёт понятную подсказку выбрать их.

### Warzone BSP

Оба файла подтверждены как RenderWare `World`. Reader обходит рекурсивное дерево plane/world
sectors, читает material list, вершины, сжатые normals, prelit colors, UV sets, индексы и material
groups. Получены следующие контрольные значения:

| Файл | Вершины | Треугольники | Plane sectors | World sectors | Format |
| --- | ---: | ---: | ---: | ---: | --- |
| `GRAPHICS.BSP` | 26 752 | 23 077 | 7 | 8 | `0x400200c9` |
| `COLLIDE.BSP` | 5 077 | 5 661 | 15 | 16 | `0x40000049` |

У `GRAPHICS.BSP` найдено 62 материала и 46 texture references. Суммы вершин, треугольников и
секторов, полученные полным обходом дерева, точно совпадают с world header. `COLLIDE.BSP`
загружается как отдельная статическая сетка; в viewer она визуально совмещается с трассой без
систематического смещения.

Дополнительно reader прошёл три отличающихся формата: Arctic collision `0x40000079`, City
graphics `0x4001004d` и Forest graphics `0x4001000d`. Это покрывает отсутствие и наличие normals,
prelit colors и одного или двух UV sets в проверенной PC-выборке.

### Coordinate system, scale и winding

Для runtime закреплена следующая конвенция:

- исходный базис RenderWare правый: `+X` вправо, `+Y` вверх, `+Z` вперёд;
- BSP остаётся в native world units с масштабом `1`;
- standalone DFF clumps выбранных Mashed-ресурсов переводятся в world units множителем `5`;
- после декодирования RenderWare triangle layout индексы идут counter-clockwise и совместимы с
  Three.js `FrontSide` без отражения осей.

Множитель DFF подтверждён не размером машины «на глаз», а сравнением `Tower`, `Deck`, `Hstone` и
`Cross` из Warzone с параметрами `RWP_Object_Box` в `COURSE.LUA`: размеры их DFF приблизительно в
пять раз меньше размеров в мире. Wildfire после того же преобразования занимает примерно
`2.344 × 1.998 × 5.422` world units.

Проверка winding сравнивает cross product каждой грани с сохранёнными vertex normals. Для
`WILDFIRE4.DFF` согласованы 6 059 из 6 072 граней с normals, для Arctic collision BSP — 3 035 из
3 037. Все 52 frame basis Wildfire имеют determinant `+1`; редкие противоположные грани оставлены
как данные модели, а не используются для отражения всего asset.

### Material semantics

Core material struct теперь сохраняет `flags`, RGBA, unused field и ambient/specular/diffuse;
texture reference — filter mode, U/V addressing и mipmap flags. В выбранных fixtures core flags и
unused равны нулю, surface properties равны `1/1/1`. Это соответствует структурам чтения
[`librw`](https://github.com/aap/librw/blob/master/src/geometry.cpp).

Warzone использует восемь material extensions MatFX `0x120`: базовые `road`, `buildconc2`,
`new_rubble`, `road_rubble` и `tiles_grey2` смешиваются со вторым UV-слоем `shadMap` через
source-alpha / inverse-source-alpha. Reader разбирает MatFX bump, environment, dual и UV-transform
entries; viewer применяет подтверждённый dual `5/6` вариант отдельным shader. Раскладка MatFX и
texture filter/addressing сверена с
[`matfx.cpp`](https://github.com/aap/librw/blob/master/src/matfx.cpp) и
[`texture.cpp`](https://github.com/aap/librw/blob/master/src/texture.cpp).

Viewer теперь явно применяет geometry flags `LIGHT`, `MODULATE`, `PRELIT`, число UV sets,
texture wrapping/filtering, исходные mip chains, alpha mask/blend и CCW front-face. Новый reader без ошибок прошёл все
43 найденных `GRAPHICS`/`COLLIDE`/`COLLISIONS` BSP и 56 DFF из каталогов Warzone и Wildfire.

### PC sound dictionaries

В извлечённом PC audio-корпусе находятся 59 RWS: 29 wave dictionaries с root chunk `0x809` и 30
локализованных voice streams с root chunk `0x80d`. Runtime-срез читает dictionaries; voice streams
не нужны для battle/race loop и пока только распознаются extractor manifest.

Все 29 dictionaries проходят новый browser-compatible reader: 422 именованных sample, codec GUID
`D01BD217` (PCM), mono PCM16LE, 22050 Hz. Для каждого sample проверяются вложенные chunks
`0x802/0x803/0x804`, размер header, codec, sample rate и точное совпадение declared/data byte length.
`PERMDICT.RWS` содержит 45 общих sample, включая `eng1`–`eng4`, `machineg`, `rocket`, `drop mine`,
`explosion1`, collision, menu и race-start cues. Reader возвращает отдельные `Int16Array`, которые
loading Worker переносит в основной поток без включения исходного RWS в production bundle.

## Asset viewer

`apps/asset-viewer` принимает локальные DFF, TXD, graphical BSP и collision BSP через file inputs и
не включает исходные ресурсы в production build. Реализованы orbit camera, автоматическое
framing, grid, axes, wireframe, включение/выключение atomic/world sectors и переключаемый collision
overlay. Wildfire и Warzone проверены визуально в WebGL без ошибок и предупреждений консоли.

TXD показывает и использует словарь как есть: один словарь может содержать текстуры окружения,
декали, эмблемы, салон и packed/atlas-like изображения. Такая «мешанина» в сыром просмотре —
свойство исходного словаря, а не склейка, сделанная viewer.

## Runtime loading decision

Для первой playable-версии выбрано прямое чтение оригинальных PC DFF/TXD/BSP во время loading
state, без обязательной предварительной конвертации. Эталонный комплект Wildfire + Warzone
занимает 3 225 988 байт и после прогрева разбирается локально за median 72.76 ms / p95 74.80 ms;
основная стоимость приходится на распаковку палитровых TXD в RGBA.

Синхронные readers вызываются в loading Worker, а transferable typed arrays передаются
renderer/physics/audio. glTF/KTX2/Opus/custom conversion остаётся опциональной оптимизацией,
если browser profiling покажет проблему времени загрузки или GPU memory. Полное решение, границы
слоёв и условия пересмотра: [ADR-0001](./ADR-0001-runtime-asset-loading.md).

## Открытые вопросы

- проверить остальные MatFX/blend combinations, когда они встретятся за пределами выбранного среза;
- измерить browser Worker parsing, audio-buffer creation и GPU upload на целевых машинах в M1 hardening;
- при появлении voice content добавить отдельный `0x80d` stream reader, не смешивая его с dictionary parser.

## Команды

```bash
pnpm assets:probe --dff ./game-data/expanded/piz/TOASTART/VEHICLES/Wildfire/WILDFIRE4.DFF
pnpm assets:probe --txd ./game-data/expanded/piz/TOASTART/VEHICLES/Wildfire/WILDFIRE.TXD
pnpm assets:probe --txd ./game-data/expanded/piz/TOASTART/Common/SFX/XBOX/BADGES.TXD
pnpm assets:probe --bsp ./game-data/expanded/piz/TOASTART/TRACKS/Warzone/GRAPHICS.BSP
pnpm asset-viewer
```

Для Warzone в viewer нужно выбрать `GRAPHICS.BSP`, `WARZONE.TXD` и затем `COLLIDE.BSP`.
