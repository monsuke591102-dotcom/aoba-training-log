# AOBA TRAINING LOG 開発管理表（公開抜粋）

完全版から生成。更新は正本で行う。

## 開発再開

- 次回は共有ブランチ codex/release-r1 の固定コミットを確認し、Pages許可の追加と本番公開の別承認を待つ。

## 2. 開発項目別の進捗一覧

| ID | 開発項目 | 実装状況 | 検証状況 | 本番反映 |
| --- | --- | --- | --- | --- |
| DEV-001 | 練習メニューの分類と操作 | 実装済み | 実機一部確認済み | 基本機能公開済みの記録 |
| DEV-002 | 日次・週間・月間の達成率とリング | 実装済み。集計は現行仕様で確定・変更不要 | PCブラウザー検証済み。配色追補は実機検証待ち | 基本機能は従来公開の範囲。配色追補はローカル |
| DEV-003 | 月間練習日数・目標・バックアップ | 実装済み | PCブラウザー検証済み。目標編集等の実機検証待ち | 従来公開の範囲。今回再照会なし |
| DEV-004 | 試合記録・振り返り・端末内詳細 | 実装済み。振り逃げ内訳と保存互換対策は追加候補 | 実機一部確認済み。最新の入力・守備UIとPWA残項目は実機検証待ち | 最新機能は未公開。旧版の試合詳細書き込みOFFを維持 |
| DEV-005 | カレンダーのアイコン付き予定選択 | 実装済み | PCブラウザー検証済み。実機はカレンダー基本操作を確認済み、予定変更の対象操作は検証待ち | 従来公開の範囲。今回再照会なし |
| DEV-006 | 分類追加・改名・並び替え | 実装済み | PCブラウザー検証済み。分類編集と復元の実機検証待ち | 従来公開の範囲。今回再照会なし |
| DEV-007 | 計画の分類選択・通常編集の折りたたみ | 実装済み | 実機一部確認済み。通常編集の折りたたみはPC検証済み・実機待ち | 分類選択は公開済みの記録。折りたたみはローカル |

集計単位はDEV番号7件。ローカルで全登録範囲を実装済みの番号が7件。番号全体が未実装・対象外のものは各0件。追加候補の検証・公開判定は分けて管理する。対象外の個別機能は第4節に記載し、開発残件に加えない。実機・公開準備の判定は機能単位のため、一律の百分率は出さない。

## 3. 開発項目の最新仕様・検証・完了条件

### DEV-001 練習メニューの分類と操作

練習種目を探しやすくする。野球アイコン付き分類、初期閉鎖・個別／一括開閉、分類内の追加と既存メニューIDの保持を実装。11月20日に実機の基本操作・既存記録・再起動保持を含む6項目が合格。残りはVoiceOverと、承認された実アカウントでの既存参照・同期の確認。必要な確認を第6節で通せば完了。[設定画面](aoba-training-log/src/Settings.tsx) · [ブラウザー試験](aoba-training-log/scripts/settings-focus.browser.mjs)

### DEV-002 達成率の集計とリング

達成率と表示中の期間を識別しやすくする。青・緑・オレンジのリングと期間表示を連動し、文字でも区別。休養・見送り・目標なし・単位不一致だけの実績は除外し、対象の未実施は0、各項目100％上限。週間は月曜から当日、月間は暦月初日から当日までの日付×メニューを等しく平均。現行集計で確定。PCで切替・配色・キーボードと既存集計を確認済み。完了条件はSafari／PWAの画面幅で期間を見失わず切り替え、VoiceOverで現在の期間が分かること。[ホーム](aoba-training-log/src/Home.tsx) · [集計](aoba-training-log/src/progress.ts)

### DEV-003 月間練習日数と目標

月間の日数目標と実績を確認できるようにする。暦月で記録日を重複なく数え、月別目標は1〜月末日数、空欄で解除。目標は端末内で管理し通常JSONの任意項目に収録。旧JSONに項目がない場合は現在値を保持。PCで編集・保存と復元を検証済み。完了条件は実機で月切替、保存と再起動保持、読み上げを確認すること。[月間進捗](aoba-training-log/src/MonthlyProgress.tsx) · [月別目標の試験](aoba-training-log/src/monthlyGoals.test.ts)

### DEV-004 試合詳細・成績・端末内保護

| 機能単位 | 確定仕様と実装 | 検証・完了条件 |
| --- | --- | --- |
| 打席・投球・走塁・守備と試合履歴 | 記録・編集・削除と試合別／通算成績。クラブチーム名は自由入力し、保存名を履歴・振り返りに使用。総球数は記録投球数と旧手入力値を区別。旧走塁の欠落は不明、履歴件数は保存イベントを採用。後者3件は現行仕様で確定 | PC・自動試験と従来Safariの対象操作を確認。新UIの実機は第6節 |
| 通算打球分布 | 確定した位置付き打球を集計。非打球・下書き・簡易集計を区別。同日別試合と重複座標、位置なし・算出不可を表示 | 11/23 Safariで4試合、位置あり5件、位置未記録1件、算出不可1試合、+3と再読込保持を確認。PWA側の保持と一覧から球場図の連動を第6節で確認 |
| 端末内保存・所有者分離 | 試合詳細はゲスト／接続先＋認証ID別のIndexedDB。同期候補から分離し、v2 RPCとDB側送信拒否を維持。ゲストからのコピーは明示操作。通常JSON v1〜v4と詳細保持を実装 | 自動試験で競合、送信状態、所有者分離、バックアップを検証。Safariでゲスト／Bの表示分離を確認、保存値・退避の照合は未確認。PWAでAとB／ゲストを第6節の範囲で確認 |
| 復元衝突と復旧 | 途中の旧タブ書き込みを検出して同期を止め、3候補・診断JSON・通常バックアップを案内。退避確認後に現在データを保持して再開。チェック欄案内を改善 | 11/23 Safariで3候補、診断JSON、オフライン復旧、再接続後の同期済みを確認。旧チェック欄事象の直接原因は未確認。関連機能が変わった場合に絞って再確認 |
| 打席振り返り | 「投球コース」「打球記録」の閲覧専用2タブ。明示編集で元の打席へ戻る。コメント・記録済みの値を表示 | PCで同日別試合、打席切替、非打球、位置なし、コメント、ゾーン外の重複、編集後の復帰。Safari／PWAの操作を確認すると完了 |
| 打球入力・球種候補 | 「打球」から打席結果へ進み、保存値は従来の `hit`／`inPlayNonHit`。旧 `inPlay` は自動分類しない。既定球種と同一所有者の追加球種を名称で重複排除し明示選択 | PC・自動試験済み。実機でフォーカス、既存結果の訂正、候補選択を確認 |
| 守備履歴・公式記録候補 | 旧位置変更とプレーを同じ一覧に表示。順序不明は明示し位置変更は集計しない。PO候補は捕球成功でアウトのフライ・ライナーに限定。送球によるPO・AとEは手動。候補は確定値にせず、食い違う場合は確認 | 自動試験とPC操作確認済み。実機で履歴と候補の確認操作を確認 |
| 振り逃げの内訳 | 空振り・見逃し・不明を明示選択。既存の振り逃げは詳細不明として保持。三振合計と他の成績は維持 | 追加候補で実装済み。互換性試験と公開条件は第5・6節 |

根拠は [打球分布](aoba-training-log/src/battedBallDistribution.ts)、[打席入力](aoba-training-log/src/BattingEditor.tsx)、[振り返り](aoba-training-log/src/MatchReview.tsx)、[守備入力](aoba-training-log/src/FieldingEditor.tsx)、[端末内保存と復元の試験](aoba-training-log/src/localMatchStorage.test.ts)、[クラウド送信検査](aoba-training-log/src/snapshotApi.test.ts)。

### DEV-005 カレンダーの予定選択

既存の予定種類をアイコンから選び、保存は別操作で確定。既存の予定・メニュー参照を維持し、ホーム側は従来どおり。PCで作成・編集・再読込・キーボードを確認。既報の実機基本操作を持ち越し、予定種別の選択から保存・取消と読み上げを確認すれば完了。[予定ダイアログ](aoba-training-log/src/PlanDialog.tsx)

### DEV-006 分類の管理

既定5分類と追加分類の名称・順番・所属を設定し、練習メニューと計画で利用。設定はブラウザー単位で通常JSONに収録し、既存メニューID・記録時分類を保持。削除・非表示、カスタム分類別の成長集計と設定のクラウド同期は対象外。PCで設定・計画との連携・復元を確認。完了条件は実機で代表分類の改名／並び替えと計画への反映、必要な保存・復元を確認すること。[分類管理](aoba-training-log/src/CategoryManagement.tsx) · [分類試験](aoba-training-log/src/menuCategories.test.tsx)

### DEV-007 練習計画の編集

分類で選びやすくし、通常編集の縦スクロールを減らす。5分類を設定と共有し、通常編集は種目ごとに初期閉鎖、名前・条件・目標を要約。開始日・保存・取消は上部に配置。既存の計画・履歴・メニューIDを維持。既報のiPhoneは分類選択・取消・計画と履歴の閲覧を確認。PCで開閉後の入力保持と分類・JSONを確認し、適用日・旧版保持は自動試験を参照。完了条件は実機で複数種目の入力保持と保存を確認し、必要な実アカウントの整合性を確認すること。[計画管理](aoba-training-log/src/PlanManagement.tsx) · [計画試験](aoba-training-log/src/routines.test.ts)

## 4. 残作業・優先順位

| 分類 | 優先度 | 課題・依存関係・対応 | 今回の新版公開 |
| --- | --- | --- | --- |
| 公開前必須の開発 | P0（問題が出た場合） | 現時点で確定済み公開範囲に追加必須の実装は特定されていない。最終検証でデータ消失、所有者混在、詳細送信、復旧不可が見つかれば該当箇所を修正し影響範囲を再検証 | 該当する障害が残れば停止 |
| 公開前必須の検証 | P0 | 候補を固定し、端末内保存・PWA復元とオフライン保持・同期拒否・更新経路を第6節で確認。候補の出力と公開設定を照合 | 必須条件が未確認のため保留 |
| 公開候補の採用判断 | P0（追加候補） | 振り逃げ内訳を含める場合は、端末実機の更新・復元・切り戻し条件を第5・6節で確認 | 未確認なら追加候補を公開しない。保全した従来候補とは別判定 |
| 利用者の仕様判断 | P1 | 登録済みの着手仕様に新たな判断待ちは確認されていない。振り逃げを同時公開する場合は採用範囲を決め、互換条件の合格後に公開を承認する | 範囲に入れる場合のみ保留 |
| 公開後でも対応できる改善 | P2 | Private検証環境のアイコン表示原因の調査は、候補の正規オリジンで正しいアイコン・起動を確認できた場合に延期可。方式固有の補助ページはローカル準備済み | 正規候補でも誤表示・独立起動失敗が出れば影響を切り分けて判断 |
| 対象外 | — | DEV-003月別目標のクラウド同期、DEV-006の分類設定のクラウド同期・分類削除／非表示・個別アイコン・カスタム分類別の成長集計、DEV-005のホーム側予定操作変更、DEV-004の試合詳細クラウド送信 | 残件集計に含めない |

## 9. 個別の修正・改善要望の最終監査（2026-11-23）

基準は `codex/dev-004-career-spray` の HEAD `2bac38d50278c096a1a35868700a7f730131f312` と未コミットを含む現行ソース。第8節の全履歴、確認できた利用者指示と既存の検証記録を読み取り照合した。DEV番号の進捗とは別集計。同じ要望の追補・現行維持・過去の障害はまとめ、試験の単独操作や公開作業は要望数に含めない。

**確認できた監査単位 64件。** A 36件、B 8件、C 0件、D 0件、E 1件、F 3件、G 16件。A 希望どおり、B 合意済み変更で実装、C 相違あり、D 未実装、E 要判断、F 明示保留・対象外、G 実装済みで検証待ち。Eの原因未確定項目を個別に管理し、GはPC・自動での確認を残したままiPhone等の実機項目を管理する。

**資料の境界。** 11/20の改善管理表（UI-01〜UI-06・DATA-01）原本と旧70項目監査原本は、作業ツリー・参照可能なローカルGit履歴・既存検証フォルダーの検索では特定できなかった。11/20のDEV-004追補は確認済み。UI-06は今回の利用者指示にある原要望を根拠に照合した。UI-01〜05・DATA-01は原番号との対応を未確認とし、件数に補わない。旧70項目との完全な対応関係と未収録要望の有無は未確認。Vitest 282・Edge 20・4ビルド1の既存記録を使用し、全件の再試験は行わず、今回の投球案内変更だけ関連Vitest 20件と型チェックを実施した。

| 監査番号・DEV | 判定 | 確認できた要望 | 現行との差分・残作業 | コード・検証根拠 |
| --- | --- | --- | --- | --- |
| 01 · DEV-001 | A | 設定の分類順・野球アイコン | 既定5分類・同じ分類ラベルを使用。 | [Settings.tsx L216](aoba-training-log/src/Settings.tsx#L216)・11/20実機6項目記録・Edge分類 |
| 02 · DEV-001 | A | 初期閉鎖、個別／一括閉鎖、複数展開 | detailsと一括操作。キーボードで隠れた欄にフォーカスを残さない。 | [Settings.tsx L101](aoba-training-log/src/Settings.tsx#L101)・Edge 375/430 |
| 03 · DEV-001 | A | 分類内追加・分類初期値・編集中の保護 | 分類から追加フォームを開き、分類IDを引き継ぐ。 | [Settings.tsx L120](aoba-training-log/src/Settings.tsx#L120)・Edge分類追加 |
| 04 · DEV-001 | A | 既存メニューIDと参照保持 | 割当を別管理。記録・計画・予定の参照は維持。 | [Settings.tsx L36](aoba-training-log/src/Settings.tsx#L36)・menuCategories.test.tsx・Edge |
| 05 · DEV-002 | A | 日次→週間→月間の円形メーター | ゲージを押して循環。日付範囲と対象なしを表示。 | [Home.tsx L31](aoba-training-log/src/Home.tsx#L31)・Edgeタッチ・キーボード |
| 06 · DEV-002 | G | 期間別の色と文字・色連動 | 日次青・週間緑・月間オレンジ。濃色背景に合わせた色で、色以外の名前と読み上げを維持。 | [Home.tsx L58](aoba-training-log/src/Home.tsx#L58)・[stadium.css L455](aoba-training-log/src/stadium.css#L455)・Edge配色合格。iPhone／VoiceOver待ち |
| 07 · DEV-002 | B | 達成率の分母・期間・丸め | 11/23の現行維持指示。各日×メニュー、月曜・暦月から当日、既存の休養等除外。 | [progress.ts L7](aoba-training-log/src/progress.ts#L7)・routines.test.ts |
| 08 · DEV-003 | G | ポイント欄の下に月間進捗 | ホームのStatus直後に置き、同日の記録を重複計上しない。 | [Home.tsx L173](aoba-training-log/src/Home.tsx#L173)・[MonthlyProgress.tsx](aoba-training-log/src/MonthlyProgress.tsx)・Edge。iPhoneでの目標編集待ち |
| 09 · DEV-003 | A | 月別の目標編集・解除と表示 | 暦月の範囲で設定、空欄で解除、バーだけ上限100%。 | [MonthlyProgress.tsx](aoba-training-log/src/MonthlyProgress.tsx)・[monthlyGoals.ts](aoba-training-log/src/monthlyGoals.ts)・monthlyGoals.test.ts・Edge |
| 10 · DEV-003 | A | 月別目標をJSONで保全 | 任意項目がない旧JSONでは現在の目標保持。 | [backup.ts L155](aoba-training-log/src/backup.ts#L155)・monthlyGoals.test.ts・backup.test.ts |
| 11 · DEV-004 | B | UI-06 自然な打撃姿勢・不自然な打者図の改善 | 当初は自然な姿勢への改善を希望。650a02fで図を削除し左右打席を残した。今回、利用者が図を表示しない変更仕様を明示承認。復活・再作成は不要。 | [投球図](aoba-training-log/src/BattingDiagrams.tsx#L128)・[左右打席](aoba-training-log/src/BattingEditor.tsx#L247)・今回の承認と既存描画回帰 |
| 12 · DEV-004 | A | 打席の追加・下書き・確定・編集・確認付き削除 | 既存保存を保護し、紐付きの走塁／守備があれば削除を拒否。 | [BattingEditor.tsx L72](aoba-training-log/src/BattingEditor.tsx#L72)・11/20 Safari・Edge |
| 13 · DEV-004 | G | 固定保存バー・入力欄・保存失敗時の入力保持 | バーを表示し保存成功時のみ編集を閉じる。 | [useMatchSaveBar.ts](aoba-training-log/src/useMatchSaveBar.ts)・[BattingEditor.tsx L200](aoba-training-log/src/BattingEditor.tsx#L200)・155件時点PC記録。実機キーボード・セーフエリア待ち |
| 14 · DEV-004 | B | 投球「ヒット」、安打以外のアウト・失策入力 | 後の明示指示により投球は「打球」に統合。打席結果で安打／失策等を選択し内部値を整合。旧inPlayは自動分類しない。 | [BattingEditor.tsx L156](aoba-training-log/src/BattingEditor.tsx#L156)・[matchDetails.ts L171](aoba-training-log/src/matchDetails.ts#L171)・Edgeの打球入力・訂正 |
| 15 · DEV-004 | A | 打球と投球入力の案内文 | 通常結果は選択時、「打球」は次画面で打席結果を選んだ時に一覧へ反映。端末への保存は打席の下書き保存または確定と案内。保存処理・入力データ・導線は同じ。 | [投球反映](aoba-training-log/src/BattingEditor.tsx#L156)・[案内](aoba-training-log/src/BattingEditor.tsx#L284)・関連Vitest 20件と型チェック合格 |
| 16 · DEV-004 | A | 単打・二塁打・三塁打・本塁打、凡打等の選択 | 投球と打席結果を別に保存し、打球性質・位置も別入力。 | [BattingEditor.tsx L9](aoba-training-log/src/BattingEditor.tsx#L9)・[BattingEditor.tsx L352](aoba-training-log/src/BattingEditor.tsx#L352)・batting.test.tsx・Edge |
| 17 · DEV-004 | A | 失策位置、任意のアウト数、最終投球前カウント・バント | 各項目を別に入力・検証。 | [BattingEditor.tsx L315](aoba-training-log/src/BattingEditor.tsx#L315)・[matchDetails.ts L211](aoba-training-log/src/matchDetails.ts#L211)・batting.test.tsxの独立検証 |
| 18 · DEV-004 | A | 3×3ガイド付き任意位置と旧9マス互換 | 相対座標で保存。旧ゾーン位置を変換表示しモデルを保持。 | [BattingDiagrams.tsx L20](aoba-training-log/src/BattingDiagrams.tsx#L20)・[BattingDiagrams.tsx L128](aoba-training-log/src/BattingDiagrams.tsx#L128)・batting.test.tsx |
| 19 · DEV-004 | G | ゾーン外、投球順・球種、重なり・タップ精度 | ゾーン外の相対位置、番号、球種・重なり調整を実装。 | [BattingDiagrams.tsx L71](aoba-training-log/src/BattingDiagrams.tsx#L71)・Edgeにゾーン外・重複。実機の狙いやすさ待ち |
| 20 · DEV-004 | A | ストレートの速・遅を記号で区別しない | 表示は標準球種へ寄せ、旧スナップショットは保持。 | [matchDetails.ts](aoba-training-log/src/matchDetails.ts)・[BattingEditor.tsx L51](aoba-training-log/src/BattingEditor.tsx#L51)・batting.test.tsxの旧ストレート |
| 21 · DEV-004 | A | 手入力「球数（任意）」を削除 | 記録球数と旧手入力値を別表示。総球数を推測しない。 | [BattingEditor.tsx L316](aoba-training-log/src/BattingEditor.tsx#L316)・コード・モデル照合、旧値表示 |
| 22 · DEV-004 | B | 未記録投球を含む総球数 | 最新指示で現行を採用。記録行数で表示し旧手入力値を参考表示。 | [BattingEditor.tsx L316](aoba-training-log/src/BattingEditor.tsx#L316)・現行維持の明示指示 |
| 23 · DEV-004 | G | 試合横断の球種候補 | 現在の所有者の試合だけを参照し、名称の重複を抑え、明示選択。 | [BattingEditor.tsx L51](aoba-training-log/src/BattingEditor.tsx#L51)・[Records.tsx L175](aoba-training-log/src/Records.tsx#L175)・batting.test.tsx。iPhone選択待ち |
| 24 · DEV-004 | A | 打撃成績の試合別・通算、0と未算出 | 確定打席、選択された集計元、未知値を区別。 | [battingStats.ts L54](aoba-training-log/src/battingStats.ts#L54)・[BattingStatsView.tsx](aoba-training-log/src/BattingStatsView.tsx)・battingStats.test.ts・11/20 Safari |
| 25 · DEV-004 | A | 打点の任意入力と集計 | 実数0と未入力を分離し、対象が揃わない場合は未算出。 | [BattingEditor.tsx L357](aoba-training-log/src/BattingEditor.tsx#L357)・[battingStats.ts L54](aoba-training-log/src/battingStats.ts#L54)・battingStats.test.ts・D-1記録 |
| 26 · DEV-004 | G | ホームの打撃成績4項目から通算詳細へ | 履歴と同じ集計・画面を利用し、閉じるとホームへ戻る。 | [Home.tsx L248](aoba-training-log/src/Home.tsx#L248)・[App.tsx L168](aoba-training-log/src/App.tsx#L168)・B-3Cと関連自動試験。最新実機待ち |
| 27 · DEV-004 | A | 通算打球分布の対象・除外・件数 | 確定した安打・凡打・失策等、簡易集計／位置不明／非打球を区別。 | [battedBallDistribution.ts L4](aoba-training-log/src/battedBallDistribution.ts#L4)・11/23 Safari 4試合・5件・位置なし1・算出不可1 |
| 28 · DEV-004 | A | 同日別試合・重複座標・打席ID | 試合IDと打席IDで識別し、同一位置を件数表示。 | [battedBallDistribution.ts L15](aoba-training-log/src/battedBallDistribution.ts#L15)・[BattingStatsView.tsx](aoba-training-log/src/BattingStatsView.tsx)・11/23 Safari 同日別試合と+3。自動でID衝突 |
| 29 · DEV-004 | G | 打球一覧選択と球場図連動、位置は概略 | 一覧で選択。+3マーカーは現行の表示専用。 | [BattingStatsView.tsx](aoba-training-log/src/BattingStatsView.tsx)・Edge選択確認。iPhoneの一覧連動未確認 |
| 30 · DEV-004 | G | 振り返り2タブ・試合／打席切替・コメントと編集復帰 | 閲覧専用の図を再利用し、明示編集後に元の打席へ戻る。 | [MatchReview.tsx L21](aoba-training-log/src/MatchReview.tsx#L21)・Edge同日別・コメント・復帰。iPhone待ち |
| 31 · DEV-004 | A | 振り返りの非打球／未記録の画面 | 利用者承認により、確定済みの四球・死球・空振り三振・見逃し三振・振り逃げは旧座標のマーカーを個別図で隠し「打球記録なし」と表示。その他のアウトや結果未確定の旧座標は維持。保存・編集・投球図・通算分布は変更なし。 | [個別図](aoba-training-log/src/MatchReview.tsx#L21)・対象Edge回帰1件（同日別試合、打席切替、保存値・通算分布の不変） |
| 32 · DEV-004 | A | 中学硬式クラブ名の自由入力・表示 | 学校名や団体選択を強制せず、保存名を履歴・振り返りで表示。 | [Records.tsx L93](aoba-training-log/src/Records.tsx#L93)・[Records.tsx L175](aoba-training-log/src/Records.tsx#L175)・Edge同日別試合 |
| 33 · DEV-004 | G | 振り逃げは空振り・見逃し・不明 | 本人が確定。旧記録は不明で合計／打数等は維持。 | [BattingEditor.tsx L341](aoba-training-log/src/BattingEditor.tsx#L341)・[battingStats.ts L54](aoba-training-log/src/battingStats.ts#L54)・4ビルドPC・自動合格。iPhone待ち |
| 34 · DEV-004 | B | 走塁UIを二盗・三盗の成功／失敗4択へ | 11/20追補で通常進塁の細かな入力とダイヤモンドを整理。旧データは保持する。 | [BaserunningEditor.tsx](aoba-training-log/src/BaserunningEditor.tsx)・11/20 Safari・Edge |
| 35 · DEV-004 | A | 盗塁成功・盗塁死と成功率の整合 | 確定詳細では0件と不明を区別し、片側が0でも率を算出。 | [runningFieldingStats.ts L48](aoba-training-log/src/runningFieldingStats.ts#L48)・runningFieldingStatsの既存試験・Edge |
| 36 · DEV-004 | B | 旧走塁の欠落値・不明なアウト内訳 | 最新指示で現行維持。不明値を0で埋めない。 | [runningFieldingStats.ts L48](aoba-training-log/src/runningFieldingStats.ts#L48)・集計自動試験 |
| 37 · DEV-004 | A | 守備はイニング一括でなくプレー単位 | イニングと守備位置、複数ポジション。機会なしの位置入力を強制しない。 | [FieldingEditor.tsx L96](aoba-training-log/src/FieldingEditor.tsx#L96)・[FieldingEditor.tsx L175](aoba-training-log/src/FieldingEditor.tsx#L175)・fielding.test.tsx・Edge |
| 38 · DEV-004 | A | 守備種類と捕球／送球／アウト・セーフ | ゴロ・ライナー・フライ・バント・打球なし。捕球の結果と送球エラーは分離。打球なしの結果入力は任意。 | [FieldingEditor.tsx L11](aoba-training-log/src/FieldingEditor.tsx#L11)・[FieldingEditor.tsx L192](aoba-training-log/src/FieldingEditor.tsx#L192)・fielding.test.tsx・Edge |
| 39 · DEV-004 | A | PO・A・Eをアウト・セーフと分離 | 未入力、確認済みなし、個別の公式記録を区別し、別に集計。 | [FieldingEditor.tsx L207](aoba-training-log/src/FieldingEditor.tsx#L207)・[runningFieldingStats.ts L76](aoba-training-log/src/runningFieldingStats.ts#L76)・11/20 Safari・fielding.test.tsx |
| 40 · DEV-004 | B | プレーごとの育成入力廃止、試合単位の振り返り | 新規の育成入力を外し、旧内容は閲覧のみ、試合側のコメントを使用。11/20追補に根拠。 | [FieldingEditor.tsx L39](aoba-training-log/src/FieldingEditor.tsx#L39)・[Records.tsx L90](aoba-training-log/src/Records.tsx#L90)・fielding.test.tsx |
| 41 · DEV-004 | G | 「第1位置」の改善と守備履歴の統合 | 位置変更とプレーを別表示。既知イニング順、前後不明と旧データを保持。 | [FieldingEditor.tsx L126](aoba-training-log/src/FieldingEditor.tsx#L126)・fielding.test.tsx。実機待ち |
| 42 · DEV-004 | G | PO候補と既存公式記録の確認 | 捕球成功でアウトになったフライ／ライナーだけ候補。候補が変わって選択と競合した場合は確認。 | [FieldingEditor.tsx L34](aoba-training-log/src/FieldingEditor.tsx#L34)・[FieldingEditor.tsx L96](aoba-training-log/src/FieldingEditor.tsx#L96)・自動・Edge。候補確認のiPhone待ち |
| 43 · DEV-004 | F | 材料のない送球によるPO・AとEの自動確定 | 利用者の一括開発指示で完全自動を退け、情報不足は手動。既存選択を維持。 | [FieldingEditor.tsx L207](aoba-training-log/src/FieldingEditor.tsx#L207)・決定の根拠とコード照合 |
| 44 · DEV-004 | A | 走塁・守備の試合別／通算・守備位置別成績 | 未算出を区別し位置別は折りたたみ、旧育成観察も保持。 | [RunningFieldingStatsView.tsx](aoba-training-log/src/RunningFieldingStatsView.tsx)・[runningFieldingStats.ts L92](aoba-training-log/src/runningFieldingStats.ts#L92)・C-3B記録・自動試験 |
| 45 · DEV-004 | A | 試合履歴の分野別配置・編集削除の分離 | 打撃・走塁・守備ごとに操作をまとめ、試合操作は別。 | [Records.tsx L241](aoba-training-log/src/Records.tsx#L241)・Edge 375/430 |
| 46 · DEV-004 | A | 履歴の「メニューなしの試合」を改善 | 履歴見出しは日付・試合・対戦相手・同日番号。 | [Records.tsx L225](aoba-training-log/src/Records.tsx#L225)・統合ブラウザー試験 |
| 47 · DEV-004 | A | 入力フォームの「メニューなし」と孤立時の案内 | 利用者承認により、試合で練習メニューが任意の選択肢を「練習メニューを選ばずに記録」へ変更。関連IDが残り該当する練習記録がない場合だけ「関連する練習記録がありません」と表示。単独試合には表示せず、関連IDを投影時に失った試合について経緯を断定しない。履歴見出しと操作・関連付けは維持。 | [入力選択肢](aoba-training-log/src/Records.tsx#L77)・[不在時の案内](aoba-training-log/src/Records.tsx#L240)・対象Edge回帰1件（単独・孤立・選択肢の表示条件） |
| 48 · DEV-004 | B | 試合履歴の確定件数・下書き・簡易集計注記 | 最新の明示指示で現行維持。走塁は盗塁成否、打撃・守備は保存イベント。 | [recordHistory.ts L26](aoba-training-log/src/recordHistory.ts#L26)・[Records.tsx L241](aoba-training-log/src/Records.tsx#L241)・統合・recordHistory関連試験 |
| 49 · DEV-004 | A | 所有者別の端末内保存／ゲスト明示コピー・孤立時保持 | 同じ所有者内で分離、同期対象を投影し、コピーと復元中断を保護。 | [localMatchStorage.ts L59](aoba-training-log/src/localMatchStorage.ts#L59)・[localMatchStorage.ts L190](aoba-training-log/src/localMatchStorage.ts#L190)・localMatchStorage.test.ts・Safari表示分離 |
| 50 · DEV-004 | F | 試合詳細のクラウド送信 | 利用者が案Aを明示採用し送信禁止とした。基本同期はv2 RPC。 | [localMatchStorage.ts L59](aoba-training-log/src/localMatchStorage.ts#L59)・[snapshotApi.ts L46](aoba-training-log/src/snapshotApi.ts#L46)・隔離PostgRESTと拒否回帰 |
| 51 · DEV-004 | A | 復元衝突の保護、3候補、退避、明示復旧 | 同期停止と復元ジャーナル。診断／通常JSONと現在データを保持して再開。 | [RestoreRecovery.tsx](aoba-training-log/src/RestoreRecovery.tsx)・[localMatchStorage.ts L132](aoba-training-log/src/localMatchStorage.ts#L132)・11/23 Safari退避・オフライン復旧・模擬同期 |
| 52 · DEV-004 | G | チェック欄の操作理由・タップ領域 | 保存後の確認、候補再確認／再ログイン後に再保存を案内。無効条件を維持。 | [RestoreRecovery.tsx](aoba-training-log/src/RestoreRecovery.tsx)・Edge375 。実機の一時事象の直接原因は未確認 |
| 53 · DEV-004 | A | 合成JSONのUTF-8添付ダウンロード | 検証配信だけ変更。通常アプリのバックアップ方式は維持。 | [DataManagement.tsx L19](aoba-training-log/src/DataManagement.tsx#L19)・11/23専用ページ保存成功・Edgeバイト一致記録 |
| 54 · DEV-004 | E | iPhoneのホーム画面アイコンが「A」になる | HTMLのapple-touch-icon 180pxとmanifestの192／512px、画像の実在、PCの配信合格を確認。Private環境でのiOS取得・認証・キャッシュの影響は未確認。利用者の仕様判断は現時点で不要。公開前一括検証で候補の追加時アイコンを確認し、再現時に取得経路を調べる。今回変更なし。 | [HTML](aoba-training-log/index.html#L10)・[manifest](aoba-training-log/public/manifest.webmanifest)・11/23実機とPC配信記録 |
| 55 · DEV-004 | G | PWA初回ログイン・JSON復元・オフライン保持 | 独立起動確認。Safariのログイン引継ぎなし。PWAでAログイン後の試合件数・復元・再起動・同期は未確認。 | [App.tsx L48](aoba-training-log/src/App.tsx#L48)・[localMatchStorage.ts](aoba-training-log/src/localMatchStorage.ts)・11/23 Safari／PWA記録、既存隔離PC |
| 56 · DEV-004 | G | 物理版2・詳細v4・JSON v5と安全な切り戻し | 旧分離版を拒否し、低い版の置換を拒否、同版の内訳消失は退避と確認を要求。 | [localMatchStorage.ts L106](aoba-training-log/src/localMatchStorage.ts#L106)・[backup.ts L239](aoba-training-log/src/backup.ts#L239)・[DataManagement.tsx L220](aoba-training-log/src/DataManagement.tsx#L220)・4ビルドPC合格。iPhone同一PWA更新・切り戻し待ち |
| 57 · DEV-005 | G | 予定の種類をアイコンで選択、保存／取消は別 | 登録済みの予定と参照を保持し、ホームは従来導線。 | [PlanDialog.tsx L67](aoba-training-log/src/PlanDialog.tsx#L67)・[Calendar.tsx L146](aoba-training-log/src/Calendar.tsx#L146)・Edge作成・編集・取消。iPhoneは基本カレンダーのみ既報 |
| 58 · DEV-006 | A | 分類追加・改名・並べ替え、既存メニュー参照 | ブラウザーの分類設定に保存、設定と計画で使用。 | [CategoryManagement.tsx](aoba-training-log/src/CategoryManagement.tsx)・[Settings.tsx L36](aoba-training-log/src/Settings.tsx#L36)・menuCategories.test.tsx・Edge |
| 59 · DEV-006 | A | 分類設定のJSON復元と旧JSONの保持 | 任意項目として取り込み、旧JSONでは現在の設定を保持。 | [backup.ts L155](aoba-training-log/src/backup.ts#L155)・backup.test.ts・Edge |
| 60 · DEV-006 | F | カスタム分類の追加範囲 | 11月27日の確定仕様により、追加・改名・並べ替えが対象。削除・非表示・個別アイコン・カスタム分類別成長集計・分類設定のクラウド同期は今回対象外。旧原要望との対応は原本不足で未確認。 | [分類設定](aoba-training-log/src/CategoryManagement.tsx)・11月27日の利用者確定仕様 |
| 61 · DEV-007 | A | 計画と設定の分類・アイコン・順序を統一 | 既存登録メニューを同じ分類で選び、登録メニューの管理は設定側。 | [RoutineFields.tsx L18](aoba-training-log/src/RoutineFields.tsx#L18)・実機の分類選択・取消、Edge |
| 62 · DEV-007 | G | 通常計画の折りたたみと重要操作へのアクセス | Excel確認だけでなく通常版で初期閉鎖。要約と開始日・保存・取消、開閉後の入力保持。 | [PlanManagement.tsx L119](aoba-training-log/src/PlanManagement.tsx#L119)・Edge複数種目。最新実機待ち |
| 63 · DEV-007 | A | 計画の開始日・旧版・履歴・目標／ID保持 | 日付に応じた版、保存で新しい版を追加。 | [PlanManagement.tsx L64](aoba-training-log/src/PlanManagement.tsx#L64)・[routines.ts](aoba-training-log/src/routines.ts)・routines.test.ts・統合試験 |
| 64 · DEV-007 | A | 選択解除・数量／目標・非表示／未分類の扱い維持 | 種目の除外と既存の候補選択・各編集欄を維持。 | [PlanManagement.tsx L142](aoba-training-log/src/PlanManagement.tsx#L142)・[RoutineFields.tsx L52](aoba-training-log/src/RoutineFields.tsx#L52)・routines.test.ts・PC分類 |

**今回の確定と残作業。** UI-06の削除仕様を承認済みに更新（C→B）。投球案内の表示を操作に合わせた（C→A）。P0の公開前安全確認は従来どおり。利用者承認を受け、項目31・47を修正しE→A。対象Vitest 36件、Edge 375pxの限定回帰1件、TypeScript型チェック合格。当時の残りは項目54・60と既存の実機待ち。11月27日の再判定は下記。既知の公開範囲に追加必須の開発は特定されていない。原本未確認の70項目・11/20改善管理表から未実装件数は推定しない。

### 2026-11-27 R1公開前の要求監査

- 12月2日までの本番公開・正式運用開始を目標とする。共有SHAは開発再開情報のとおり。親コミットと保全した作業差分から共有され、共有時に承認済み110点を照合済み。保全ビルドは隔離用。管理文書だけの変更で既存試験は失効しない。
- 既存Vitest 282件、Edge回帰20件、4ビルド互換試験1件、型チェック・隔離ビルドを再利用。R1の合成PC最終ログは2件合格（合成ログイン、同一オリジンのSW更新・v5復元・互換切り戻し）。11月23日のSafari合格は当日の対象範囲に適用し、R1 PWA合格には振り替えない。
- 64件の変更は項目60のE→Fのみ。項目54は「A」アイコンの原因未確定でEを維持。利用者への再決裁は不要。旧70項目原本、11月20日改善管理表原本と原番号対応の不足は継続。打者シルエット非表示・左右打席の維持、明確な非打球の旧座標保持と表示抑制は確定済み。
- 現時点の必須コード修正は0件。公開前にR1 PWAの更新・DB物理版1→2・所有者分離・v5退避と復元・オフライン再起動・通信復帰・復元衝突・物理版2対応切り戻しを優先。時間内に主要UI、分類の追加に加えて改名・並べ替え、アイコン・アクセシビリティを確認する。アイコンの再現だけでP0を止めず、起動不能・データ差・同期異常なら公開を停止。
- R1は作成・更新とも本人セッションで training_log_write_snapshot_v2 を呼ぶ。直接INSERTや旧RPCへフォールバックしない。端末内詳細は同期から分離し、通信前にも拒否する。隔離バンドルとPagesワークフローを照合済み。配信予定の本番ビルドそのものは未生成・未検証。
- 同期の根拠はPGliteのSQL・権限・競合試験、ブラウザーの合成応答、隔離実PostgRESTとローカル署名JWTのHTTP試験、既報の本番専用アカウントのrevision 1→2を区別する。DB再切替は現時点で必要と判断する根拠なし。本番の現在値は未照会。公開前は承認範囲内で接続設定・公開キー・対象SHAを照合し、追加の本番照会や書き込みが必要なら別承認を得る。
- 次回は共有ブランチ codex/release-r1 の固定コミットを確認し、Pages許可の追加と本番公開の別承認を待つ。
