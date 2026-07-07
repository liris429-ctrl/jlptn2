# N2たん — JLPT N2 文法・單字學習 PWA

個人使用的 JLPT N2 準備工具，Vanilla TypeScript + Vite 打造的漸進式網頁應用（PWA），支援離線使用、可安裝到手機主畫面。

## 功能

- **文法查詢**：138 條 N2 文法（接續、中文語意、例句、振假名、機會性的相似文法辨析），可依課程瀏覽或搜尋。
- **單字查詢**：3592 個 N2 單字，支援漢字／假名／中文雙向搜尋，含重音標記與動詞變化提示。
- **雙向連結**：文法例句中的單字可點擊直接跳到單字詳解，單字頁也能反查出現在哪些文法裡。
- **收藏**：文法與單字都可收藏，存在瀏覽器 localStorage，離線可用。
- **連連看遊戲**：日文/中文配對訓練，30 秒倒數、combo 計分。
- **PWA**：離線快取、可安裝為手機 App。

## 資料來源

- 文法：[mxggle/anki-jlpt-n2-grammar-example-sentences](https://github.com/mxggle/anki-jlpt-n2-grammar-example-sentences)（CC BY-NC 4.0）
- 單字：[RabbearSu/Japanese-Words](https://github.com/RabbearSu/Japanese-Words)（無授權條款，僅供個人學習使用，請勿公開散布整理後的資料）

實際資料檔案（`data-source/raw/`、`public/data/*.json`）不會進版控，由 build 流程從上述來源重新產生。

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
