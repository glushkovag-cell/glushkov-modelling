# HMS Bounty: traditional_plant 1.0.0 → 1.1.0

Сравнение расчётных диаметров для модели HMS Bounty по обмерам из Notion «Обмеры моделей».

## Входные данные

| Параметр | Значение |
| --- | --- |
| Масштаб | 1:60 |
| D фок | 8 мм |
| D грот | 8 мм |
| D бизань | 6 мм |
| D бушприт | 8 мм |
| Ширина корпуса | 144 мм |
| Орудие | не обмерялось, узел исключён |

Конфигурация узлов — по умолчанию для traditional_plant: все три мачты с стеньгами и брам-стеньгами, реи и паруса всех ярусов, бушприт с утлегарем/бом-утлегарем/мартин-гиком, блинд, якорная группа, косые паруса и гафель. Орудийный узел выключен, потому что калибр в обмерах не задан.

## Сводка

| Показатель | 1.0.0 | 1.1.0 |
| --- | ---: | ---: |
| Всего строк | 275 | 275 |
| Рассчитано | 266 | 266 |
| Изменено диаметров | — | 135 из 266 (50.8%) |
| Среднее абсолютное изменение | — | 17.15% |
| Максимальный рост | — | +53.4% · rn.square.topmast.brace_fall (mizzen) |
| Максимальное снижение | — | нет (факторы не уменьшаются) |
| Без изменений | — | 131 |
| Бушприт и якорь без изменений | — | 41 строк |

B+ регуляризация применяет `max(original factor, B factor)`, поэтому диаметры только растут; снижений нет. Бушприт и якорные канаты в этой редакции не менялись.

## Ключевые снасти

| Владелец | ruleId | 1.0.0, мм | 1.1.0, мм | Δ, мм | Δ, % |
| --- | --- | ---: | ---: | ---: | ---: |
| main | `st.lower.stay` | 0.960 | 1.129 | +0.169 | +17.6% |
| main | `st.lower.shroud` | 0.528 | 0.659 | +0.131 | +24.9% |
| main | `st.lower.backstay` | 0.480 | 0.480 | +0.000 | 0.0% |
| main | `st.topmast.stay` | 0.576 | 0.625 | +0.049 | +8.4% |
| main | `st.topmast.shroud` | 0.317 | 0.373 | +0.056 | +17.6% |
| main | `st.topmast.backstay` | 0.384 | 0.463 | +0.079 | +20.5% |
| main | `st.topgallant.stay` | 0.336 | 0.336 | +0.000 | 0.0% |
| main | `st.topgallant.shroud` | 0.192 | 0.202 | +0.010 | +5.2% |
| main | `st.topgallant.backstay` | 0.240 | 0.259 | +0.019 | +7.8% |
| main | `st.lower.ratline` | 0.180 | 0.224 | +0.045 | +24.9% |
| main | `st.topmast.ratline` | 0.108 | 0.127 | +0.019 | +17.6% |
| main | `st.topgallant.ratline` | 0.065 | 0.069 | +0.003 | +5.2% |
| main | `st.futtock.lower` | 0.370 | 0.462 | +0.092 | +24.9% |
| main | `st.futtock.upper` | 0.222 | 0.261 | +0.039 | +17.6% |
| main | `st.lower.shroud_lanyard` | 0.264 | 0.330 | +0.066 | +24.9% |
| main | `st.lower.stay_lanyard` | 0.336 | 0.395 | +0.059 | +17.6% |
| fore | `st.lower.stay` | 0.960 | 1.129 | +0.169 | +17.6% |
| fore | `st.lower.shroud` | 0.528 | 0.659 | +0.131 | +24.9% |
| mizzen | `st.lower.stay` | 0.720 | 0.847 | +0.127 | +17.6% |
| mizzen | `st.lower.shroud` | 0.396 | 0.495 | +0.099 | +24.9% |
| bowsprit | `bow.bobstay` | 0.528 | 0.528 | +0.000 | 0.0% |
| bowsprit | `bow.shroud` | 0.432 | 0.432 | +0.000 | 0.0% |
| bowsprit | `bow.gammoning` | 0.528 | 0.528 | +0.000 | 0.0% |
| anchor_group | `anchor.bower_cable` | 1.656 | 1.656 | +0.000 | 0.0% |
| anchor_group | `anchor.messenger` | 1.159 | 1.159 | +0.000 | 0.0% |

## Наибольшие изменения

| Владелец | ruleId | 1.0.0, мм | 1.1.0, мм | Δ, % |
| --- | --- | ---: | ---: | ---: |
| mizzen | `rn.square.topmast.brace_fall` | 0.144 | 0.221 | +53.4% |
| fore | `rn.square.topmast.brace_fall` | 0.192 | 0.294 | +53.4% |
| main | `rn.square.topmast.brace_fall` | 0.192 | 0.294 | +53.4% |
| fore | `rn.square.topmast.bowline` | 0.144 | 0.219 | +51.8% |
| main | `rn.square.topmast.bowline` | 0.144 | 0.219 | +51.8% |
| mizzen | `rn.square.topmast.bowline` | 0.108 | 0.164 | +51.8% |
| mizzen | `rn.square.lower.bowline` | 0.144 | 0.200 | +39.2% |
| fore | `rn.square.lower.bowline` | 0.192 | 0.267 | +39.2% |
| main | `rn.square.lower.bowline` | 0.192 | 0.267 | +39.2% |
| fore | `rn.square.lower.brace_fall` | 0.240 | 0.319 | +33.1% |
| main | `rn.square.lower.brace_fall` | 0.240 | 0.319 | +33.1% |
| mizzen | `rn.square.lower.brace_fall` | 0.180 | 0.240 | +33.1% |

Полная таблица всех 275 строк: [bounty-profile-diff.csv](bounty-profile-diff.csv).

## Как воспроизвести

1. Взять обмеры Bounty из Notion «Обмеры моделей».
2. Установить масштаб 1:60 и диаметры 8 / 8 / 6 / 8 мм, ширину корпуса 144 мм, выключить орудийный узел.
3. Посчитать один и тот же вход с `traditional_plant` 1.0.0 и 1.1.0.
4. Сравнить `diameterModelMm` по паре `nodeId + ruleId`.
