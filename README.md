# N2たん — JLPT N2 文法・單字學習 PWA

個人使用的 JLPT N2 準備工具，Vanilla TypeScript + Vite 打造的漸進式網頁應用（PWA），支援離線使用、可安裝到手機主畫面。

## 功能

- **文法查詢**：138 條 N2 文法（接續、中文語意、例句、振假名、機會性的相似文法辨析），可依課程瀏覽或搜尋。
- **單字查詢**：3592 個 N2 單字，支援漢字／假名／中文雙向搜尋，含重音標記與動詞變化提示。
- **雙向連結**：文法例句中的單字可點擊直接跳到單字詳解，單字頁也能反查出現在哪些文法裡。
- **收藏**：文法與單字都可收藏，存在瀏覽器 localStorage，離線可用。
- **連連看遊戲**：日文/中文配對訓練，30 秒倒數、combo 計分。
- **PWA**：離線快取、可安裝為手機 App。
- **題庫**：歷屆考題選擇題練習（文法／單字／閱讀），附中文解說。

## 資料來源

- 文法：[mxggle/anki-jlpt-n2-grammar-example-sentences](https://github.com/mxggle/anki-jlpt-n2-grammar-example-sentences)（CC BY-NC 4.0）
- 單字：[RabbearSu/Japanese-Words](https://github.com/RabbearSu/Japanese-Words)（無授權條款，僅供個人學習使用，請勿公開散布整理後的資料）
- 題庫：自行整理的歷屆考題，存於 `data-source/quiz/*.json`（每個檔案一次考試，內含混合的文法/單字/閱讀題），會進版控。

實際資料檔案（`data-source/raw/`、`public/data/*.json`）不會進版控，由 build 流程從上述來源重新產生；題庫原始檔（`data-source/quiz/`）例外，因為是自有內容，直接進版控。

### 新增一批題庫

在 `data-source/quiz/` 底下新增一個 JSON 檔（檔名建議用考期，如 `2011-07.json`），內容為題目陣列，同一份考題可以混合三種類型：

**文法／單字題**（單選）：

```json
{
  "id": "唯一id",
  "source": "OOOO年OO月考題",
  "level": "N2",
  "category": "文法",
  "question": "題幹，含（   ）標示空格",
  "options": ["選項1", "選項2", "選項3", "選項4"],
  "answer": 0,
  "explanation": "中文解說"
}
```

**閱讀題**（一篇文章對應多道子題，用 `passage` + `questions` 巢狀）：

```json
{
  "id": "唯一id（作為 passage 的 id）",
  "source": "OOOO年OO月考題",
  "level": "N2",
  "category": "閱讀",
  "passage": "整篇文章…",
  "questions": [
    { "q_number": 50, "question": "【50】に入る…", "options": [...], "answer": 0, "explanation": "中文解說" }
  ]
}
```

`category` 目前接受 `文法`/`單字`/`閱讀`（或英文 `grammar`/`vocab`/`reading`）；`level` 選填，不填預設 N2。

`npm run data:build` 會自動掃描 `data-source/quiz/` 下所有檔案、合併、依 `category` 分類，一般題輸出成 `public/data/quiz.json`；閱讀題會拆成一個 `public/data/quiz-passages.json`（文章本文）加上 `quiz.json` 裡多筆帶 `passageId` 的子題（id 格式 `<passage id>_q<q_number>`），避免每道子題都重複存一次全文。同時驗證 id 不重複、`answer` 索引落在 `options` 範圍內、閱讀題的 `passageId` 有對應到存在的文章。

## 開發

```bash
npm install
npm run data:fetch   # 下載外部原始資料到 data-source/raw/（需網路，僅需執行一次或資料源更新時）
npm run dev          # 啟動本機開發伺服器（會自動先跑 data:build）
npm run test         # 跑單元測試
npm run build        # 產生 dist/（正式建置）
```

## 部署

見專案內部文件（Firebase Hosting，個人免費方案，手動 `firebase deploy`）。
