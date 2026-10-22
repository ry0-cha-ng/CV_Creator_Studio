# CV Creator Studio

ClutchVault向けの定点ショート動画を、1つのプロジェクトから日本語・英語で書き出す
個人用Electronアプリです。

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
npm run package:win
```

macOS用DMGはApple SiliconのMac上で `npm run package:mac` を実行してください。

## 現在の実装範囲

- ローカル保存先とプロジェクトJSON
- 自動保存、プロジェクト一覧
- 録画取り込み、ffprobe解析、FFmpegプロキシ生成
- 定点情報と日英テロップ編集
- T-STD（7シーン）Remotionプレビュー
- 中央切り抜き、ぼかし背景、ズーム、フリーズ、照準マーカー
- 日本語・英語のMP4、カードPNG、meta.json一括書き出し
- 同梱フォントによるオフライン動作
- BGMライブラリ（MP3・WAV・M4A・OGGの登録、重複検出、LUFS・波形解析）
- 入手元・クレジット・利用可能プラットフォームのライセンス確認
- T-STDのシーン別BGM音量、フェード、プレビュー・書き出し
- −14 LUFS調整、BGMなし版、BGM情報・クレジット付きmeta.json

音声機能の検証用ファイルは次のコマンドで再生成できます。

```bash
npm run generate:test-audio
```

カードの最終寸法・ブランド素材は、デザイン参照画像と正式素材の追加後に調整します。
