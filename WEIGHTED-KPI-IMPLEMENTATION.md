# Вагова логіка KPI (Weight-based Summary) — впровадження

## 1. Що змінено

- **Summary-розрахунок:** замість `AVG(Value)` використовується зважена формула:
  - **ExpectedWeight** = сума ваг усіх індикаторів у періоді для співробітника
  - **FailedWeight** = сума ваг індикаторів з Value = 0
  - **PassedWeight** = ExpectedWeight − FailedWeight
  - **%Total** = (PassedWeight / ExpectedWeight) × 100

- **Критичні індикатори** (наприклад Safety & Ratio) мають більшу вагу → сильніше знижують KPI при порушенні.

- **Веб-панель:** після «Confirm & Finish» / «Confirm Selection» не чекає завершення перерахунку Summary — виклик `finalizeBatch` виконується у фоні (fire-and-forget).

---

## 2. Google Таблиця: колонка Weight

У аркуші **Config_Indicators** додай колонку **Weight** (число).

- Якщо колонки немає або значення порожнє — у скрипті використовується **1**.
- Рекомендовані значення (орієнтовно):
  - **Safety & Ratio** → 5  
  - **Hygiene & Care** → 2  
  - **Environment**, **Classroom organization** тощо → 1  

Кроки:

1. Відкрий таблицю (ID у GAS).
2. Аркуш **Config_Indicators**.
3. Додай заголовок **Weight** у першому рядку (наприклад після **Active**).
4. У другому та наступних рядках вкажи число (1, 2, 5 тощо). Для старих рядків можна залишити порожньо — тоді буде 1.

---

## 3. Google Apps Script: що вставити

У твоєму GAS-проєкті:

1. **Додай** функції з файлу **GAS-KPI-Backend-Weighted.gs.js**:
   - `getWeightForIndicator`
   - `_allCategories` (якщо вже є — можна залишити свою, головне щоб повертала масив унікальних категорій)
   - `recomputeSummary`, `recomputeSummaryDay`, `recomputeSummaryMonth`, `recomputeSummaryQuarter`
   - `getHeadersForSheet_Summary`

2. **Замість старої логіки Summary** в `getHeadersForSheet(name)` для SUM_D / SUM_M / SUM_Q викликай нові заголовки:

   ```js
   if ([SHEETS.SUM_D, SHEETS.SUM_M, SHEETS.SUM_Q].includes(name)) {
     return getHeadersForSheet_Summary(name);
   }
   ```

3. **Видали** старі реалізації `recomputeSummary`, `recomputeSummaryDay`, `recomputeSummaryMonth`, `recomputeSummaryQuarter` (якщо вони окремі функції).

Після цього `finalizeBatch` і `rebuildSummaries` будуть використовувати вагову математику, а структура FormData не змінюється.

---

## 4. Опційно: перерахунок по розкладу (без затримки для користувача)

Щоб Summary оновлювався навіть якщо хтось не натискає «Confirm & Finish», можна додати **time-driven trigger** в GAS:

1. В редакторі скрипта: **Triggers** (іконка годинника) → **Add Trigger**.
2. Функція: **rebuildSummaries** (або **finalizeFullRebuild**).
3. Подія: **Time-driven**, інтервал на вибір (наприклад **Every 15 minutes** або **Every hour**).
4. Параметри виклику: можна передати порожній об’єкт `{}`.

Тоді панель ніколи не чекає на перерахунок: він виконується після збереження у фоні або по розкладу.

---

## 5. Acceptance criteria (перевірка)

- Усі індикатори виконані (Value = 1) → **%Total = 100%**.
- Один індикатор з вагою 5 порушений → KPI знижується сильніше, ніж при вазі 1.
- Team-порушення знижує KPI **усім** присутнім у слоті.
- Individual-порушення знижує KPI лише **конкретному** співробітнику.
- Summary_Day / Summary_Month / Summary_Quarter містять колонки **%Total**, **ExpectedWeight**, **FailedWeight**, **TotalWeight** і коректно перераховуються після `finalizeBatch` або trigger.

---

## 6. Файли в репозиторії

| Файл | Зміни |
|------|--------|
| **kpi/index.html** | Після збереження Team/Individual виклик `finalizeBatch` у фоні (без await), щоб панель не мала затримки. |
| **kpi/GAS-KPI-Backend-Weighted.gs.js** | Код для GAS: вагова математика Summary та заголовки з технічними колонками. |
| **kpi/WEIGHTED-KPI-IMPLEMENTATION.md** | Ця інструкція. |

Історичні дані не видаляються; змінюється лише логіка обрахунку Summary та момент виклику `finalizeBatch`.
