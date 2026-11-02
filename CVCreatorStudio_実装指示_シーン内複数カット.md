# CV Creator Studio 実装指示：1つのシーンに複数の動画を入れる（シーン内の複数カット）

- 作成日：2026-11-02
- 対象：CV Creator Studio（Electron + Remotion + FFmpeg + SQLite + Zod）のショート動画作成。プロジェクトのスキーマ（シーン・タイムライン項目）、タイムラインの生成と尺の同期、動画の描画（`remotion/LineupShortStandard.tsx`）、書き出し、ガイド作成の手順3（切り抜き）、詳細編集（タイムライン・インスペクター）
- 対象シーン：**S1 フック・S2 立ち位置・S3 合わせ位置・S4 発動イメージ**（`hook` / `stand` / `aim` / `throw`）
- 要件：要件定義書には未記載。v2.13.1 時点の挙動を前提に、この指示書を仕様とする（要件定義書への追記は後で行う）
- 関連：タイムラインの分割（`splitTimelineItemAt`）、縦型変換「フォーカス」（`CVCreatorStudio_実装指示_フォーカス演出.md`）

既存のコードを確認してから、今の構成に合わせて実装まで進めてください。普段の実装判断は確認を待たずに、既存の設計に合う方法を選んでください。仕様と既存コードが食い違い、どちらにも決められないときだけ、質問としてまとめてください。

---

## 1. 背景と目的

今は1つのシーンに元動画のクリップを1本しか割り当てられません（`scene.clipId`）。そのため、「S1 フックで2本の録画をつなげる」といった構成が作れません。

S1〜S4 の各シーンに**複数のカット（それぞれ別の動画・範囲）**を並べられるようにします。

1. S1〜S4 の各シーンに、カットを**最大4本**まで並べられる（暫定）
2. 同じシーンのカットは**切り替え（カット）だけでつなぐ**。フェード・スライドは選べない
3. テロップ・ステップラベル・CTA・署名など、シーン全体に重ねる要素は**カットの切れ目で途切れたり、入りのアニメーションをやり直したりしない**
4. **カットが1本のシーンは、データ・タイムライン・書き出しの結果が今と完全に同じ**
5. 既存のプロジェクトはそのまま開ける（`schemaVersion` は上げない）

**対象外：** S5 カード（映像の切り抜きがない）、S6 デモ・S7 ループ（後日削除する予定なので手を入れない。今の挙動を壊さないことだけ守る）

---

## 2. 最初に確認すること

事前の調査で分かっていることを下に書きます。実際のコードと照らし合わせ、違いがあれば方針を説明してから実装に進んでください。

- **シーンとクリップ**：`sceneSchema`（`shared/schema/project.ts`）は `clipId` を1つだけ持つ。クリップ（`clipSchema`）は `assetId / in / out` を持ち、`assignClipsFromRoles` などでシーンごとに別のクリップが作られる
- **タイムライン項目**：`timelineItemSchema`（`shared/schema/timeline.ts`）は `sceneKey` を持つが、クリップを持たない。分割（`splitTimelineItemAt` / `splitTimelineItem`）で同じシーンの項目を複数並べられるが、どの項目も同じクリップを `sourceOffset` をずらして再生する。`trimLimits` は同じシーンの項目数（siblings）を見ている
- **描画**：`LineupShortStandard` は項目ごとに `<Sequence>` を作り、その中に `SceneContent` 全体（映像・テロップ・ラベル・照準マーカー・CTA・署名）をマウントしている。そのため項目の先頭ごとに、次の処理がやり直される。**今の分割機能で S1 を2つに分け、書き出して確認してください**
  - `Caption` の入りのアニメーション（0〜0.2秒の拡大）
  - `scene.zoom`（0〜0.4秒）
  - `S4CtaBlock` / `S4LikeCtaBlock`（`durationSec={item.duration}` で、表示のタイミングが項目の長さで決まる）
  - `ClipTransition`
- **映像のクリップ**：`SceneMedia` / `AimZoomFootage` は `scene.clipId` からクリップを引き、`scene.cropCenterX / cropCenterY / cropZoom` で切り抜いている。`SceneContent` のフォーカス枠（`focusFrameOf`）は `playbackClip(project, sceneKey)` の素材の解像度から求めている
- **尺の同期**：`applySceneCutDuration` と `syncTimelineDurationsToScenes` は、同じシーンの項目が1つのときだけ、タイムラインとクリップの範囲を同期する（2つ以上なら同期を飛ばす）。シーンの尺は `templateParams.sceneDurations[sceneKey]`
- **シーンの尺を先頭の項目だけで見ている箇所**：`sceneItemDuration`（`shared/timeline.ts`）、手順3のタブの秒数（`src/guide/steps.tsx` の `tabState`）、`retargetSceneVideo` の末尾（`shared/guide.ts`）、`TimelinePanel.tsx` の `focusSceneKey` まわり、`shared/guide.ts` の `compositionBlocks`（構成の帯の秒数）。`items.find((…) => ….sceneKey === …)` を検索して、ほかにもないか確かめる
- **書き出し**
  - `export-service.ts`：必要な素材ファイルの収集（`prepareMediaAllowlist`）が `scene.clipId` だけを見ている。必須クリップの確認（`hook / stand / aim / throw`）も同じ
  - `shared/export-media.ts`：`usedSourceSpan` が `playbackClip(project, item.sceneKey)` で、素材ごとに使う区間を決めている。ここが2本目以降のカットを見ないと、**書き出し用の素材から区間が漏れ、黒い画面になる**
- **クリップを使っているかの判定**：`App.tsx` の `openSceneClipEditor` の `usageCount`、`retargetSceneVideo` の `shared`、`removeVideoAsset`、手順3の `revertLoopToHook` が、`scene.clipId` だけで判定している
- **BGM のダッキング**：`bgmDuckingGain` が `playbackClip(project, item.sceneKey)` の素材の音量の包絡線を見ている
- **状態の更新**：`store.updateProject` は `structuredClone` した値を書き換える方式。新しい操作関数も同じ方式に合わせる
- **引き継ぎ**（`applyInheritance`）：シーン単位で値を引き継いでいるか確認する。カットは動画ごとの設定なので**引き継がない**

---

## 3. 仕様

### 3.1 データ（追加のみ。`schemaVersion` は 7 のまま）

```ts
// shared/schema/project.ts の sceneSchema に追加
export const sceneCutSchema = z.object({
  id: z.string(),
  clipId: z.string(),
  /** 未指定はシーンの値を使う。動画ごとに画角が違うので、切り抜き位置だけはカットごとに持てる */
  cropCenterX: z.number().min(0).max(1).optional(),
  cropCenterY: z.number().min(0).max(1).optional(),
  cropZoom: z.number().min(1).max(1.5).optional(),
});

// sceneSchema
clipId: z.string().optional(),                     // カット1。意味は今のまま
extraCuts: z.array(sceneCutSchema).optional(),     // カット2以降を並び順に。未指定・空はカット1だけ

// shared/schema/timeline.ts の timelineItemSchema に追加
/** 未指定はシーンのカット1（scene.clipId）。カット2以降の項目だけに入れる */
clipId: z.string().optional(),
```

- **カット1は今までどおり `scene.clipId`** です。サムネイル（フックの先頭）、カード用の静止画（`cardFrameRequests`）、S7 の「S1 の直前」、分析の構成判定など、`scene.clipId` を「シーンの代表クリップ」として読んでいる処理はそのまま正しく動きます。カット1を配列に移す変更はしないでください
- カット1のクロップは、今までどおりシーンの `cropCenterX / cropCenterY / cropZoom` です
- 縦型変換（`layout916`）・ゲーム音量（`volume`）・BGM 音量（`bgmVolume`）は**シーン共通**で、カットごとには持ちません
- `extraCuts` は `optional()` にする（P1 で決定）。`default([])` にすると、シーンを作る既存のコードとテストのすべてで型が必須になり、保存の往復でも値が増えるため。カットを全部消したら、空配列ではなくキーごと消す

### 3.2 ルール

```ts
// shared/scene-cuts.ts（新規）
export const MULTI_CUT_SCENES: SceneKey[] = ['hook', 'stand', 'aim', 'throw'];
export const MAX_CUTS_PER_SCENE = 4;   // カット1を含む。暫定
export const MIN_CUT_SEC = 0.3;        // STRETCH_MIN と同じ値。定数があればそれを参照する
```

- `MULTI_CUT_SCENES` にないシーンの `extraCuts` は、どの処理でも無視します（読み込みのときに空にしてもかまいません）
- カット1本ごとに**専用のクリップ**を作ります。ほかのシーンやカットとクリップを共有しません
- カット1がないシーン（`clipId` が未設定）には、カット2以降を足せません
- 同じシーンのカットの間は、必ず**カット切り替え**です（項目の `transition` は `'cut'` に固定）。シーンの最初の項目の `transition` は今までどおり選べます

### 3.3 共通の関数（`shared/scene-cuts.ts`・`shared/scene-cut-edit.ts`）

純関数としてまとめ、描画・書き出し・画面のどこからでも同じものを使ってください。

P1 では、import が循環しないように次の3か所に分けました。

- **`shared/scene-cuts.ts`**：解決用。タイムラインに依存しない
- **`shared/timeline.ts`**：`itemClip` / `sceneSpanOf` / `sceneTotalDuration` / `applyCutLength` / `rebuildSceneItems` / `cutItemsOf`
- **`shared/scene-cut-edit.ts`**：操作

`sceneItemDuration` は「最初の項目＝カット1の尺」のまま残し、シーンの合計には `sceneTotalDuration` を使います。

```ts
type ResolvedCut = {
  cutId: string;              // カット1は 'primary'、それ以外は SceneCut.id
  index: number;              // 0 始まり
  clip: Clip;
  crop: { cropCenterX: number; cropCenterY?: number; cropZoom?: number };
};

sceneCuts(project, sceneKey): ResolvedCut[]         // カット1＋extraCuts。クリップが見つからないカットは除く
itemClip(project, item): PlaybackClip | undefined  // item.clipId があればそのクリップ、なければ playbackClip(project, item.sceneKey)
itemCrop(project, item): ResolvedCut['crop']
isPrimaryItem(project, item): boolean              // item.clipId が未指定、またはカット1のクリップ
sceneSpanOf(timeline, item): { start: number; duration: number; offset: number }
                                                   // 同じシーンの項目が連続している区間。offset はその区間の先頭からの秒
clipInUse(project, clipId): boolean                // すべてのシーンの clipId と extraCuts を見る
```

カットの操作も、`Project` を受け取って `Project` を返す関数にします。どの操作も、最後に 3.4 の尺の同期をしてください。

| 関数 | 内容 |
|---|---|
| `addCut(project, sceneKey, afterIndex)` | 指定したカットの後ろにカットを足す。既定値は 4.1 |
| `removeCut(project, sceneKey, cutId)` | カットを消し、ほかで使っていないクリップも消す。カット1を消すときはカット2を繰り上げる（クリップとクロップを `scene` へ移す） |
| `moveCut(project, sceneKey, cutId, direction)` | 並び順を1つ前か後ろへ動かす。カット1と入れ替えるときは、クリップとクロップを `scene` と `extraCuts[0]` の間で入れ替える |
| `retargetCutVideo(project, sceneKey, cutId, assetId)` | そのカットの動画を差し替える。カット1は既存の `retargetSceneVideo` を使う |
| `setCutRange(project, sceneKey, cutId, range)` | そのカットの IN／OUT を変える |
| `setCutCrop(project, sceneKey, cutId, crop)` | そのカットのクロップを変える。カット1はシーンの値を変える |

### 3.4 タイムラインの生成と尺

**カットが1本のシーン：** 今の処理を一切変えません。

**カットが2本以上のシーン：**

- 各カットの尺は、そのクリップの長さ（`out − in`）です。シーンの尺（`templateParams.sceneDurations[sceneKey]`）は**カットの尺の合計**で、カットの操作のたびに書き直します
- `buildTimelineBody`：シーンをカットの数の項目に展開します
  - カット2以降の項目には `clipId` を入れる
  - `transition` は `'cut'`
  - `layout` と `volume` はシーンの値
  - 項目の `id` は再生成しても変わらない値にする（例：`standard-${sceneKey}-${cutId}`）
- 音量の点（`volumePoints`）は、シーンの最初の項目にだけ作ります（カットごとに増やさない）。効果音の位置（`click-stand` など）も、シーンの最初の項目を基準にします
- **詳細編集済みのタイムライン**（`timelineEdited` が true、`project.timeline` がある）
  - **カットの追加・削除・並べ替え・動画の差し替え**：`rebuildSceneItems(project, sceneKey)` で、そのシーンの項目だけを作り直します。後ろの項目・音量の点・効果音の時刻は、`removeSceneItems` / `insertSceneItem` と同じ考え方でずらします。そのシーンでユーザーがした分割・速度の変更は失われますが、ほかのシーンの編集は残します
  - **カットの範囲だけを変えたとき**：そのカットの項目が1つで、`sourceOffset` が 0、`speed` が 1 なら、`trimTimelineItem` で尺を合わせます。そうでなければタイムラインは変えません（今の `applySceneCutDuration` と同じ扱い）
- `syncTimelineDurationsToScenes`：複数カットのシーンでは、カットごとに同期します。カットの項目が1つで、`sourceOffset` が 0、`speed` が 1 のときだけ、そのクリップの範囲を項目の尺に合わせます
- 2章で挙げた「先頭の項目だけを見ている箇所」を、意味に合わせて直します
  - シーンの尺 → 合計（`sceneItemDuration`、手順3のタブの秒数、`compositionBlocks`）
  - カットの尺 → そのカットの項目
  - 代表の項目 → 最初の項目のまま（矢印の確認、サムネイル）
- `trimLimits`：複数カットのシーンの項目の最短は `MIN_CUT_SEC`

### 3.5 描画（`remotion/LineupShortStandard.tsx`）

**映像**

- `SceneMedia` / `AimZoomFootage` のクリップは `itemClip(project, item)`、クロップは `itemCrop(project, item)` を使います
- `SceneContent` のフォーカス枠（`focusFrameOf`）も、その項目のクリップの素材から求めます（動画ごとに解像度が違うことがあるため）
- **カット1の項目だけに付けるもの**：照準マーカー（`aimMarker`）、拡大枠（`aimZoom`）、ズーム（`zoom`）、フリーズ（`freeze`）。これらはカット1の録画の座標と時間で保存されているためです。カット2以降の項目では描きません
- 矢印（`item.arrow`）は今までどおり項目ごとです

**シーン全体に重ねる要素（カットの切れ目で途切れさせない）**

- 対象：テロップ（`Caption`）、ステップラベル、上部のグラデーション、`S4CtaBlock` / `S4LikeCtaBlock`、署名（`Watermark`）
- これらは**シーンの区間（`sceneSpanOf`）の時間**で動かします
  - フレームは「シーンの先頭からのフレーム」
  - S4 の CTA の `durationSec` は**シーンの合計の尺**
- 実装は、次のどちらか既存の構成に合うほうを選んでください
  - **A**：重ねる要素を、`<Sequence from={-offsetFrames}>` で包む（中の `useCurrentFrame()` がシーンの先頭からのフレームになる）。`durationSec` にはシーンの合計を渡す
  - **B**：`LineupShortStandard` を2層にする。映像の層は項目ごとの `<Sequence>`、重ねる要素の層は、同じシーンが連続する区間ごとの `<Sequence>`
- 目標：カットが2本のシーンの重ねる要素が、**同じ長さで1本のシーンと同じフレームで出る**こと（5章）
- この修正で、今の分割機能で同じシーンを分けたときのやり直しも直ります。**項目が1つのシーンの出力は変えないでください**

**つなぎ方**

- `ClipTransition`：直前の項目が同じシーンなら、`item.transition` に関係なく切り替えだけにします

**音声**

- 各項目の映像の音は、その項目のクリップから出ます（今の `OffthreadVideo` の音と同じ扱い）。音量はシーン共通の `volume`
- `bgmDuckingGain` は `itemClip(project, item)` の素材の包絡線を見ます

### 3.6 書き出し

- `export-service.ts`
  - 必要な素材ファイルの収集で、`extraCuts` のクリップの素材も入れる
  - 必須クリップの確認で、`extraCuts` のクリップが見つからなければエラーにする（例：「S1 フックのカット2の動画が見つかりません」）
- `shared/export-media.ts` の `usedSourceSpan`：`itemClip(project, item)` を使い、カット2以降の区間も入れます。カード用の区間（`includeSourceRange`）と `cardFrameRequests` は、カット1のままです
- meta.json に解決済みのシーンの情報を書いている場合は、シーンごとにカットの一覧（`assetId / in / out`）を足します。書いていなければ足しません
- `exportContentStamp` は `scenes` を含んでいるので、カットを変えると書き出しの印が変わります（変更不要。テストで確かめる）

### 3.7 クリップを使っているかの判定と後片付け

- `clipInUse` を使い、次の処理で `extraCuts` も見るようにします
  - `App.tsx` の `openSceneClipEditor` の `usageCount`
  - `retargetSceneVideo` の `shared`
  - 手順3の `revertLoopToHook`
- `removeVideoAsset`：消える素材を使っているカットを外します。カット1が消えてカット2以降が残る場合は、`removeCut` と同じく繰り上げます
- 動画を消してカット1がなくなったシーンでは、`assignClipsFromRoles` がカット1を作り直します（今と同じ）。`extraCuts` は残っているものをそのまま使います

---

## 4. 画面

### 4.1 ガイド手順3（切り抜き）

S1〜S4 のときだけ、`gd-trim-info` の下に**カットの列**を出します。

```
カット  [1 · 2.0秒] [2 · 1.8秒] [＋ カットを追加]        シーン合計 3.8秒
         ^選択中
```

- 各カットのボタンには、番号・秒数・動画のファイル名（短縮）を出します。選んだカットに、既存の編集部品（使用する動画、範囲のバー、IN／OUT、切り抜き秒数、クロップ）が効きます。カットを選ぶと、範囲のバーとプレビューの元動画がそのカットに切り替わります
- 選択中のカットは画面のローカルな状態にします。シーンを切り替えたらカット1に戻します
- 選択中のカットのボタンに、削除（×）と並べ替え（← →）を出します
  - カットが1本のときは削除を出しません
  - カット1が変わる並べ替え・削除で、照準マーカー・拡大枠・ズーム・フリーズのどれかが設定されていれば、「照準マーカーなどは新しいカット1に付きます」と確認を出します
- **カットの追加**：選択中のカットの後ろに足し、足したカットを選びます。初期値は次のとおりです
  - 動画が2本以上あるとき：選択中のカットと別の、並び順で最初の動画。範囲は 0 秒から
  - 動画が1本のとき：同じ動画。範囲は選択中のカットの OUT から
  - 長さは 1.5 秒（素材の長さに収める）
  - カットが `MAX_CUTS_PER_SCENE` 本あるときは押せない
- **切り抜き秒数**：選択中のカットの長さです。「デフォルト ○秒で切る」「この秒数をデフォルトにする」は、**カットが1本のときだけ**出します（シーンの既定の尺の意味が変わらないようにするため）
- **シーン合計**：カットが2本以上のとき、すべてのカットの合計を出します（シーンごとの目安の秒数は廃止したので、長さの警告は出しません）。タブの「✓ ○秒」も合計にします
- **縦型変換の切り替え**はシーン共通なので、近くに「このシーン共通」と添えます。**クロップ**（横位置・縦位置・拡大率、フォーカスの範囲のドラッグ）は選択中のカットに効きます
- 照準マーカー・拡大枠・ズーム・フリーズの設定は、カット1を選んでいるときだけ出します。ほかのカットでは「照準マーカー・ズームはカット1にだけ付きます」と1行出します
- I／O キーと数値のクリックは、選択中のカットに効きます
- 右のプレビューは、**シーン全体（すべてのカット）**を繰り返し再生します。確認には `GuidePreview.tsx` のシーンの区間の求め方を使い、合計の区間になるようにしてください
- 同じシーンの別のカットと、同じ動画の範囲が重なっていても止めません（重ねて使いたい場合があるため）

### 4.2 詳細編集（タイムライン・インスペクター）

- **タイムラインの項目**
  - サムネイルと素材の表示は `itemClip` を使います
  - カット2以降の項目のラベルは「S1 フック · カット2」とします
  - 同じシーンのカットの境目に、細い区切りを出します（シーンの帯は1つのままにする）
- **項目へのクリップのドロップ**（`assignClip`）：ドロップした項目のカットの動画を差し替えます。カット2以降の項目なら `retargetCutVideo`、カット1なら今のままです
- **インスペクター**
  - カット2以降の項目では、トランジションの選択を出さずに「シーン内のカットは切り替えでつながります」と出します
  - 使用する動画の選択は、その項目のカットに効きます
- 分割は今までどおりできます。分けた項目は同じ `clipId` を引き継ぎます

### 4.3 最終確認

| チェック | 種類 | 直す手順 |
|---|---|---|
| S1〜S4 のカットの動画がプロジェクトにある | エラー | 3 切り抜き（そのシーン） |

---

## 5. テスト

`scripts/check-scene-cuts.ts` を新しく作り、`package.json` に `check:scene-cuts` を足してください。描画の確認は `scripts/check-scene-cuts-render.ts`（`check:scene-cuts-render`）で行います。検証用の単色動画を `out/scene-cuts-fixtures` に作り、Remotion で静止画を描いて比べます。

- **互換**
  - `extraCuts` のない既存のプロジェクトを読み込むと `extraCuts: []` になり、保存の往復で値が変わらない
  - カットが1本のシーンだけのプロジェクトで、`buildTimeline` の結果が変更前と一致する（変更前の結果を固定値として持つ）
- **タイムライン**
  - S1 にカットを2本（2.0秒・1.8秒）入れると、S1 の項目が2つ（2つ目に `clipId`、`transition: 'cut'`）になり、S1 の尺が 3.8秒、後ろのシーンの開始が 3.8秒ずれる
  - 音量の点はシーンに1つ
  - S5〜S7 に `extraCuts` があっても無視される
- **操作**
  - `addCut` / `removeCut` / `moveCut` / `setCutRange` / `retargetCutVideo` のたびに、シーンの尺が合計に一致する
  - カット1の削除・並べ替えで、クリップとクロップが `scene` と `extraCuts` の間で正しく移る
  - 使わなくなったクリップが残らない
  - `MAX_CUTS_PER_SCENE` を超えて足せない
- **詳細編集済み**：`timelineEdited` のプロジェクトでカットを足すと、そのシーンの項目だけが作り直され、ほかのシーンの分割・速度・音量の点・効果音は残る（時刻は正しくずれる）
- **書き出し素材**
  - `usedSourceSpan` に、カット2の素材と区間が入る
  - 必要な素材ファイルの一覧に、カット2の素材が入る
  - カット2のクリップがないと、必須クリップの確認でエラーになる
- **描画**
  - S1 をカット2本にしたときと、同じ合計の尺の1本にしたときで、テロップの入りのアニメーションのフレームが一致する
  - S4 の CTA が出るタイミングが、シーンの合計の尺で決まる
  - 照準マーカーはカット1の項目にだけ出る
- **回帰**：`check:save`、`check:schema`、`check:video-structure`、`check:focus`、`check:aim-zoom`、`check:thumbnail` がそのまま通る

テスト・型チェック・lint は既存のコマンドで通してください。仕様をなぞるだけのテストを大量に足す必要はありません。

---

## 6. 受け入れ条件

| # | 条件 |
|---|---|
| MC-01 | 手順3で S1〜S4 にカットを足し、カットごとに別の動画と範囲を設定できる。S5〜S7 にはカットの列が出ない |
| MC-02 | カットが2本以上のシーンを書き出すと、カットが並び順に切り替えでつながり、シーンの長さがカットの合計になる。後ろのシーンはその分ずれる |
| MC-03 | テロップ・ステップラベル・S4 の CTA・署名が、カットの切れ目で消えたり入りのアニメーションをやり直したりしない |
| MC-04 | カットごとのクロップ（横位置・縦位置・拡大率）が書き出しに反映される。縦型変換はシーン共通 |
| MC-05 | 照準マーカー・拡大枠・ズーム・フリーズはカット1にだけ付く。カット1を入れ替えると確認が出て、新しいカット1に付く |
| MC-06 | カット2以降の動画も書き出し用の素材に含まれ、黒い画面や素材不足のエラーにならない。プレビューと書き出しの同じフレームが一致する |
| MC-07 | 詳細編集済みのプロジェクトでカットを足し引きしても、ほかのシーンの編集が残る |
| MC-08 | カットが1本のシーンだけのプロジェクトは、開く・保存・書き出しの結果が変更前と一致する |
| MC-09 | 動画を削除すると、その動画を使うカットが外れ、カット1が消えた場合は次のカットが繰り上がる |
| MC-10 | サムネイル・完成カード・X用カードの出力は変わらない（カット1が基準のまま） |

確認には、S1 に2本の別の録画（例：結果の映像と、構えの映像）を入れた短尺テンプレートのプロジェクトを使ってください。フォーカスとぼかし背景の両方で書き出し、カットの切れ目の前後のフレームを見比べてください。

---

## 7. 進め方

1. 2章の確認と方針の説明（特に、重ねる要素をシーンの時間で動かす方法 A／B の選択）
2. **P1：データと描画**
   - スキーマの追加、`shared/scene-cuts.ts`（共通の関数と操作）
   - タイムラインの展開と尺の同期（3.4）
   - 描画（3.5）、書き出し（3.6）、クリップの判定（3.7）
   - `check:scene-cuts`
   - この時点では、テスト用のプロジェクト JSON で動作を確かめる
3. **P2：手順3（切り抜き）のカットの列と編集**（4.1）
4. **P3：詳細編集のタイムライン・インスペクター**（4.2）と最終確認（4.3）
5. 受け入れ条件の確認と、変更点の短い要約

P1 が終わった時点で、一度変更点を要約してください。

---

## 8. 範囲外・未決事項

- **範囲外**
  - 同じシーンのカットの間のトランジション（フェード・スライド）。後で `SceneCut` に `transition` を足す前提で、今は持たない
  - カットごとのテロップ・音量・照準マーカー
  - S5 カード・S6 デモ・S7 ループ（S6・S7 は後日削除する予定）
  - 横動画作成モード（`src/long`・`shared/long`）
- **未決事項**
  - カットの上限（暫定4本）と、新しいカットの長さ（暫定1.5秒）。使ってみてから決め直す
  - 要件定義書への追記（機能番号・受け入れ条件の番号の振り直し）
