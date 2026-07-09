/**
 * i18n.js
 * 「旅のしおり」の多言語対応（日本語 / 英語 / 中国語簡体字 / タイ語）
 * window.I18N を公開する。ES2020+ のバニラJS、モジュール不使用。
 */
(function () {
  "use strict";

  var LANGUAGES = ["ja", "en", "zh", "th"];

  var LANGUAGE_LABELS = {
    ja: "日本語",
    en: "English",
    zh: "中文",
    th: "ไทย"
  };

  var CATEGORIES = ["move", "meal", "stay", "sight"];
  var MODES = ["walk", "train", "bus", "car", "shinkansen", "plane", "ferry", "other"];

  var CATEGORY_ICONS = {
    move: "🚌",
    meal: "🍽️",
    stay: "🏨",
    sight: "📸"
  };

  // カテゴリー名（4言語）
  var CAT_NAMES = {
    ja: { move: "移動", meal: "食事", stay: "宿泊", sight: "観光" },
    en: { move: "Transport", meal: "Meal", stay: "Stay", sight: "Sightseeing" },
    zh: { move: "交通", meal: "餐饮", stay: "住宿", sight: "观光" },
    th: { move: "การเดินทาง", meal: "อาหาร", stay: "ที่พัก", sight: "เที่ยวชม" }
  };

  // 移動手段名（4言語）
  var MODE_NAMES = {
    ja: { walk: "徒歩", train: "電車", bus: "バス", car: "車", shinkansen: "新幹線", plane: "飛行機", ferry: "フェリー", other: "その他" },
    en: { walk: "Walk", train: "Train", bus: "Bus", car: "Car", shinkansen: "Shinkansen", plane: "Flight", ferry: "Ferry", other: "Other" },
    zh: { walk: "步行", train: "电车", bus: "巴士", car: "汽车", shinkansen: "新干线", plane: "飞机", ferry: "渡轮", other: "其他" },
    th: { walk: "เดิน", train: "รถไฟ", bus: "รถบัส", car: "รถยนต์", shinkansen: "ชินคันเซ็น", plane: "เครื่องบิน", ferry: "เรือเฟอร์รี่", other: "อื่นๆ" }
  };

  // 所要時間の単位表記
  var DURATION_UNITS = { ja: "分", en: "min", zh: "分钟", th: "นาที" };

  // しおりデータの多言語タイトル（6e）: サンプルしおり・新規しおり作成時の4言語プリセット
  var SAMPLE_TRIP_TITLES = { ja: "東京旅行", en: "Tokyo Trip", zh: "东京之旅", th: "ทริปโตเกียว" };
  var NEW_TRIP_TITLES = { ja: "新しい旅行", en: "New Trip", zh: "新的旅行", th: "ทริปใหม่" };

  // UI文字列辞書
  var DICT = {
    ja: {
      "header.share": "共有",
      "header.textio": "CSV入出力",
      "header.titlePlaceholder": "旅行のタイトルを入力",
      "day.addDay": "＋ 日を追加",
      "day.date": "日付",
      "day.startTime": "開始時刻",
      "day.deleteConfirmTitle": "この日を削除しますか？",
      "day.deleteConfirmBody": "「Day {n}」の予定はすべて削除されます。",
      "day.cannotDeleteLast": "最後の1日は削除できません",
      "day.deleteAria": "この日を削除",
      "day.dayLabel": "Day {n}",
      "timeline.routeButton": "🧭 移動手段の選択とルートを検討",
      "timeline.routeSearching": "検索中… {cur}/{total}",
      "timeline.routeDone": "ルートを更新しました",
      "timeline.notFound": "見つからなかった場所: {list}",
      "timeline.durPlaceholder": "時間を入力",
      "timeline.approxBadge": "⚠概算",
      "timeline.approxTooltip": "場所を特定できなかったため、近くのスポットの位置から概算した移動時間です",
      "timeline.unresolvedText": "⚠ 場所を特定できませんでした",
      "timeline.dragHandleLabel": "ドラッグして並べ替え",
      "timeline.deleteItem": "削除",
      "timeline.duplicateItem": "複製",
      "timeline.nameFetchProgress": "スポット名を取得中… {cur}/{total}",
      "timeline.emptyDay": "この日の予定はまだありません。下のフォームから追加しましょう。",
      "timeline.namePlaceholder": "名前",
      "timeline.notePlaceholder": "メモ",
      "timeline.modeLabel": "移動手段",
      "timeline.timeSep": "〜",
      "timeline.gmapPlaceholder": "Google MapsのURLを貼り付け",
      "timeline.gmapLinkLabel": "Google Mapsで開く",
      "timeline.gmapRouteLabel": "Google Mapsで確認",
      "add.namePlaceholder": "行き先・お店の名前など",
      "add.notePlaceholder": "メモ（任意）",
      "add.button": "＋ 追加",
      "share.title": "しおりを共有",
      "share.desc": "下のリンクをコピーして、家族や友達に送りましょう。",
      "share.copy": "リンクをコピー",
      "share.copied": "リンクをコピーしました",
      "share.loadSharedTitle": "共有されたしおりを新しいしおりとして開きますか？",
      "share.loadSharedBody": "新しいしおりとして追加され、切り替わります。",
      "textio.title": "CSVで入出力",
      "textio.desc": "現在のしおりをCSVで表示しています。編集して「読み込む」を押すと反映されます。",
      "textio.copy": "コピー",
      "textio.copied": "コピーしました",
      "textio.load": "読み込む",
      "textio.download": "CSVダウンロード",
      "textio.openFile": "ファイルを開く",
      "textio.confirmTitle": "現在のしおりを上書きします。読み込みますか？",
      "textio.parseWarning": "{lines}行目を読み込めませんでした",
      "confirm.ok": "OK",
      "confirm.cancel": "キャンセル",
      "modal.close": "閉じる",
      "toast.copied": "コピーしました",
      "toast.geocodeNetworkError": "位置情報の取得中に通信エラーが発生しました",
      "toast.nameRequired": "名前を入力してください",
      "toast.gmapExtracted": "リンクから位置を取得しました",
      "toast.gmapShortLink": "短縮リンクからは位置を取得できません。ブラウザで開いた後のURLを貼ってください",
      "toast.gmapNameFilled": "リンクから名前を入力しました: {name}",
      "map.toggle": "🗺 地図",
      "map.updateButton": "📍 地図を更新",
      "map.noCoords": "座標のある場所がありません",
      "map.updateDone": "地図を更新しました",
      "settings.buttonAria": "設定",
      "settings.title": "設定",
      "settings.desc": "Google Maps Platform の APIキーを設定すると、区間の移動時間をGoogleの実測ルート計算に切り替えられます。",
      "settings.apiKeyLabel": "Google Maps APIキー",
      "settings.apiKeyPlaceholder": "APIキーを入力",
      "settings.note1": "利用には Google Cloud Console で Routes API を有効化する必要があります。",
      "settings.note2": "APIの利用は従量課金です。料金体系はGoogleの公式ドキュメントをご確認ください。",
      "settings.note3": "セキュリティのため、APIキーにはHTTPリファラー制限の設定を推奨します。",
      "settings.note4": "キーはこの端末のブラウザ内にのみ保存されます。共有リンクやテキスト出力には含まれません。",
      "settings.note5": "Places API (New) を有効化すると、海外スポットなどの名前解決が強化されます（任意）。",
      "settings.note6": "Cloud Translation API を有効化すると、タイトルとスポット名の自動翻訳に使用されます（任意）。",
      "settings.save": "保存",
      "settings.delete": "削除",
      "settings.saved": "APIキーを保存しました",
      "settings.deleted": "APIキーを削除しました",
      "toast.routesApiKeyError": "APIキーを確認してください",
      "toast.routesApiError": "ルート計算でエラーが発生したため、概算値を使用しました",
      "toast.placesApiNotEnabled": "Places API (New) が有効化されていません。Google Cloud Console で有効化してください",
      "toast.translateApiNotEnabled": "Cloud Translation API が有効化されていません。Google Cloud Console で有効化してください",
      "header.tripsAria": "しおり一覧を開く",
      "trips.title": "しおり一覧",
      "trips.newTrip": "＋ 新しいしおり",
      "trips.dayCount": "{n}日間",
      "trips.currentBadge": "編集中",
      "trips.deleteAria": "このしおりを削除",
      "trips.deleteConfirmTitle": "このしおりを削除しますか？",
      "trips.deleteConfirmBody": "「{title}」のデータはすべて削除されます。",
      "trips.cannotDeleteLast": "最後の1つのしおりは削除できません",
      "trips.untitled": "(無題)"
    },
    en: {
      "header.share": "Share",
      "header.textio": "CSV Import/Export",
      "header.titlePlaceholder": "Enter trip title",
      "day.addDay": "+ Add Day",
      "day.date": "Date",
      "day.startTime": "Start time",
      "day.deleteConfirmTitle": "Delete this day?",
      "day.deleteConfirmBody": "All plans in \"Day {n}\" will be deleted.",
      "day.cannotDeleteLast": "You can't delete the last remaining day",
      "day.deleteAria": "Delete this day",
      "day.dayLabel": "Day {n}",
      "timeline.routeButton": "🧭 Choose transport & plan route",
      "timeline.routeSearching": "Searching… {cur}/{total}",
      "timeline.routeDone": "Routes updated",
      "timeline.notFound": "Locations not found: {list}",
      "timeline.durPlaceholder": "Enter duration",
      "timeline.approxBadge": "⚠ Approx.",
      "timeline.approxTooltip": "The location couldn't be identified, so this travel time is estimated from a nearby spot's position",
      "timeline.unresolvedText": "⚠ Couldn't identify this location",
      "timeline.dragHandleLabel": "Drag to reorder",
      "timeline.deleteItem": "Delete",
      "timeline.duplicateItem": "Duplicate",
      "timeline.nameFetchProgress": "Fetching local names… {cur}/{total}",
      "timeline.emptyDay": "No plans yet for this day. Add one below!",
      "timeline.namePlaceholder": "Name",
      "timeline.notePlaceholder": "Note",
      "timeline.modeLabel": "Transport mode",
      "timeline.timeSep": "–",
      "timeline.gmapPlaceholder": "Paste a Google Maps URL",
      "timeline.gmapLinkLabel": "Open in Google Maps",
      "timeline.gmapRouteLabel": "Check on Google Maps",
      "add.namePlaceholder": "Destination or place name",
      "add.notePlaceholder": "Note (optional)",
      "add.button": "+ Add",
      "share.title": "Share your itinerary",
      "share.desc": "Copy the link below to share with friends and family.",
      "share.copy": "Copy link",
      "share.copied": "Link copied",
      "share.loadSharedTitle": "Open the shared itinerary as a new itinerary?",
      "share.loadSharedBody": "It will be added as a new itinerary and switched to.",
      "textio.title": "CSV import/export",
      "textio.desc": "This shows your itinerary as CSV. Edit it and press \"Load\" to apply the changes.",
      "textio.copy": "Copy",
      "textio.copied": "Copied",
      "textio.load": "Load",
      "textio.download": "Download CSV",
      "textio.openFile": "Open file",
      "textio.confirmTitle": "This will overwrite your current itinerary. Load anyway?",
      "textio.parseWarning": "Couldn't read line(s) {lines}",
      "confirm.ok": "OK",
      "confirm.cancel": "Cancel",
      "modal.close": "Close",
      "toast.copied": "Copied",
      "toast.geocodeNetworkError": "A network error occurred while looking up locations",
      "toast.nameRequired": "Please enter a name",
      "toast.gmapExtracted": "Got the location from the link",
      "toast.gmapShortLink": "Can't get a location from a shortened link. Please paste the URL after opening it in a browser.",
      "toast.gmapNameFilled": "Filled in the name from the link: {name}",
      "map.toggle": "🗺 Map",
      "map.updateButton": "📍 Update map",
      "map.noCoords": "No locations with coordinates yet",
      "map.updateDone": "Map updated",
      "settings.buttonAria": "Settings",
      "settings.title": "Settings",
      "settings.desc": "Add a Google Maps Platform API key to get real travel times from Google's route calculations.",
      "settings.apiKeyLabel": "Google Maps API key",
      "settings.apiKeyPlaceholder": "Enter API key",
      "settings.note1": "You need to enable the Routes API in Google Cloud Console.",
      "settings.note2": "Usage is billed by Google on a pay-as-you-go basis. Check Google's official pricing page for details.",
      "settings.note3": "For security, we recommend restricting the key with an HTTP referrer restriction.",
      "settings.note4": "The key is stored only in this browser. It is never included in shared links or text export.",
      "settings.note5": "Enabling Places API (New) improves name resolution for overseas spots and similar cases (optional).",
      "settings.note6": "Enabling the Cloud Translation API is used to auto-translate the title and spot names (optional).",
      "settings.save": "Save",
      "settings.delete": "Delete",
      "settings.saved": "API key saved",
      "settings.deleted": "API key deleted",
      "toast.routesApiKeyError": "Please check your API key",
      "toast.routesApiError": "A route calculation error occurred; used an estimated value instead",
      "toast.placesApiNotEnabled": "Places API (New) is not enabled. Please enable it in Google Cloud Console.",
      "toast.translateApiNotEnabled": "Cloud Translation API is not enabled. Please enable it in Google Cloud Console.",
      "header.tripsAria": "Open itinerary list",
      "trips.title": "My Itineraries",
      "trips.newTrip": "+ New itinerary",
      "trips.dayCount": "{n} day(s)",
      "trips.currentBadge": "Current",
      "trips.deleteAria": "Delete this itinerary",
      "trips.deleteConfirmTitle": "Delete this itinerary?",
      "trips.deleteConfirmBody": "All data in \"{title}\" will be deleted.",
      "trips.cannotDeleteLast": "You can't delete the last remaining itinerary",
      "trips.untitled": "(Untitled)"
    },
    zh: {
      "header.share": "分享",
      "header.textio": "CSV导入/导出",
      "header.titlePlaceholder": "输入旅行标题",
      "day.addDay": "＋ 添加一天",
      "day.date": "日期",
      "day.startTime": "开始时间",
      "day.deleteConfirmTitle": "确定要删除这一天吗？",
      "day.deleteConfirmBody": "「Day {n}」的所有行程都将被删除。",
      "day.cannotDeleteLast": "无法删除最后一天",
      "day.deleteAria": "删除这一天",
      "day.dayLabel": "Day {n}",
      "timeline.routeButton": "🧭 选择交通方式并规划路线",
      "timeline.routeSearching": "搜索中… {cur}/{total}",
      "timeline.routeDone": "路线已更新",
      "timeline.notFound": "未找到的地点：{list}",
      "timeline.durPlaceholder": "请输入时间",
      "timeline.approxBadge": "⚠ 估算",
      "timeline.approxTooltip": "由于无法确定该地点，此移动时间是根据附近地点的位置估算的",
      "timeline.unresolvedText": "⚠ 无法确定该地点",
      "timeline.dragHandleLabel": "拖动以排序",
      "timeline.deleteItem": "删除",
      "timeline.duplicateItem": "复制",
      "timeline.nameFetchProgress": "正在获取地点名称… {cur}/{total}",
      "timeline.emptyDay": "这一天还没有安排，快在下方添加吧！",
      "timeline.namePlaceholder": "名称",
      "timeline.notePlaceholder": "备注",
      "timeline.modeLabel": "交通方式",
      "timeline.timeSep": "〜",
      "timeline.gmapPlaceholder": "粘贴谷歌地图链接",
      "timeline.gmapLinkLabel": "在谷歌地图中打开",
      "timeline.gmapRouteLabel": "在谷歌地图上查看",
      "add.namePlaceholder": "目的地或店铺名称",
      "add.notePlaceholder": "备注（可选）",
      "add.button": "＋ 添加",
      "share.title": "分享行程",
      "share.desc": "复制下方链接，分享给家人和朋友吧。",
      "share.copy": "复制链接",
      "share.copied": "链接已复制",
      "share.loadSharedTitle": "要将分享的行程作为新行程打开吗？",
      "share.loadSharedBody": "将作为新行程添加并切换过去。",
      "textio.title": "CSV导入/导出",
      "textio.desc": "下方以CSV形式显示当前行程，编辑后点击“读取”即可应用更改。",
      "textio.copy": "复制",
      "textio.copied": "已复制",
      "textio.load": "读取",
      "textio.download": "下载CSV",
      "textio.openFile": "打开文件",
      "textio.confirmTitle": "这将覆盖当前行程，确定要读取吗？",
      "textio.parseWarning": "第 {lines} 行无法读取",
      "confirm.ok": "确定",
      "confirm.cancel": "取消",
      "modal.close": "关闭",
      "toast.copied": "已复制",
      "toast.geocodeNetworkError": "查询地点时发生网络错误",
      "toast.nameRequired": "请输入名称",
      "toast.gmapExtracted": "已从链接获取位置",
      "toast.gmapShortLink": "无法从短链接获取位置。请粘贴在浏览器中打开后的网址。",
      "toast.gmapNameFilled": "已从链接填入名称：{name}",
      "map.toggle": "🗺 地图",
      "map.updateButton": "📍 更新地图",
      "map.noCoords": "暂无带坐标的地点",
      "map.updateDone": "地图已更新",
      "settings.buttonAria": "设置",
      "settings.title": "设置",
      "settings.desc": "设置 Google Maps Platform 的API密钥后，可以使用Google的实际路线计算获取移动时间。",
      "settings.apiKeyLabel": "Google Maps API密钥",
      "settings.apiKeyPlaceholder": "请输入API密钥",
      "settings.note1": "需要在 Google Cloud Console 中启用 Routes API。",
      "settings.note2": "此功能按使用量计费。请查看Google官方文档了解详细费用。",
      "settings.note3": "出于安全考虑，建议为密钥设置HTTP引荐来源限制。",
      "settings.note4": "密钥仅保存在此设备的浏览器中，不会包含在分享链接或文本导出中。",
      "settings.note5": "启用 Places API (New) 可以增强对海外景点等名称的解析能力（可选）。",
      "settings.note6": "启用 Cloud Translation API 后，可用于自动翻译标题和景点名称（可选）。",
      "settings.save": "保存",
      "settings.delete": "删除",
      "settings.saved": "已保存API密钥",
      "settings.deleted": "已删除API密钥",
      "toast.routesApiKeyError": "请检查您的API密钥",
      "toast.routesApiError": "路线计算发生错误，已使用估算值",
      "toast.placesApiNotEnabled": "尚未启用 Places API (New)。请在 Google Cloud Console 中启用它。",
      "toast.translateApiNotEnabled": "尚未启用 Cloud Translation API。请在 Google Cloud Console 中启用它。",
      "header.tripsAria": "打开行程列表",
      "trips.title": "行程列表",
      "trips.newTrip": "＋ 新建行程",
      "trips.dayCount": "{n}天",
      "trips.currentBadge": "当前",
      "trips.deleteAria": "删除此行程",
      "trips.deleteConfirmTitle": "确定要删除此行程吗？",
      "trips.deleteConfirmBody": "「{title}」的所有数据都将被删除。",
      "trips.cannotDeleteLast": "无法删除最后一个行程",
      "trips.untitled": "(无标题)"
    },
    th: {
      "header.share": "แชร์",
      "header.textio": "นำเข้า/ส่งออก CSV",
      "header.titlePlaceholder": "ใส่ชื่อทริป",
      "day.addDay": "+ เพิ่มวัน",
      "day.date": "วันที่",
      "day.startTime": "เวลาเริ่มต้น",
      "day.deleteConfirmTitle": "ลบวันนี้หรือไม่?",
      "day.deleteConfirmBody": "แผนทั้งหมดใน \"Day {n}\" จะถูกลบ",
      "day.cannotDeleteLast": "ไม่สามารถลบวันสุดท้ายที่เหลืออยู่ได้",
      "day.deleteAria": "ลบวันนี้",
      "day.dayLabel": "Day {n}",
      "timeline.routeButton": "🧭 เลือกการเดินทางและวางแผนเส้นทาง",
      "timeline.routeSearching": "กำลังค้นหา… {cur}/{total}",
      "timeline.routeDone": "อัปเดตเส้นทางแล้ว",
      "timeline.notFound": "ไม่พบสถานที่: {list}",
      "timeline.durPlaceholder": "กรุณาใส่เวลา",
      "timeline.approxBadge": "⚠ ประมาณ",
      "timeline.approxTooltip": "ไม่สามารถระบุตำแหน่งได้ จึงประมาณเวลาเดินทางจากตำแหน่งของสถานที่ใกล้เคียง",
      "timeline.unresolvedText": "⚠ ไม่สามารถระบุตำแหน่งได้",
      "timeline.dragHandleLabel": "ลากเพื่อจัดลำดับ",
      "timeline.deleteItem": "ลบ",
      "timeline.duplicateItem": "ทำสำเนา",
      "timeline.nameFetchProgress": "กำลังดึงชื่อสถานที่… {cur}/{total}",
      "timeline.emptyDay": "ยังไม่มีแผนสำหรับวันนี้ ลองเพิ่มด้านล่างได้เลย!",
      "timeline.namePlaceholder": "ชื่อ",
      "timeline.notePlaceholder": "โน้ต",
      "timeline.modeLabel": "วิธีการเดินทาง",
      "timeline.timeSep": "〜",
      "timeline.gmapPlaceholder": "วางลิงก์ Google Maps",
      "timeline.gmapLinkLabel": "เปิดใน Google Maps",
      "timeline.gmapRouteLabel": "ตรวจสอบใน Google Maps",
      "add.namePlaceholder": "ชื่อสถานที่หรือร้าน",
      "add.notePlaceholder": "โน้ต (ไม่บังคับ)",
      "add.button": "+ เพิ่ม",
      "share.title": "แชร์ทริปของคุณ",
      "share.desc": "คัดลอกลิงก์ด้านล่างเพื่อแชร์ให้เพื่อนและครอบครัว",
      "share.copy": "คัดลอกลิงก์",
      "share.copied": "คัดลอกลิงก์แล้ว",
      "share.loadSharedTitle": "เปิดทริปที่แชร์มาเป็นทริปใหม่หรือไม่?",
      "share.loadSharedBody": "จะถูกเพิ่มเป็นทริปใหม่และสลับไปใช้งาน",
      "textio.title": "นำเข้า/ส่งออก CSV",
      "textio.desc": "แสดงทริปปัจจุบันเป็น CSV แก้ไขแล้วกดปุ่ม \"โหลด\" เพื่อนำไปใช้",
      "textio.copy": "คัดลอก",
      "textio.copied": "คัดลอกแล้ว",
      "textio.load": "โหลด",
      "textio.download": "ดาวน์โหลด CSV",
      "textio.openFile": "เปิดไฟล์",
      "textio.confirmTitle": "การโหลดจะเขียนทับข้อมูลทริปปัจจุบัน ต้องการโหลดหรือไม่?",
      "textio.parseWarning": "ไม่สามารถอ่านบรรทัดที่ {lines} ได้",
      "confirm.ok": "ตกลง",
      "confirm.cancel": "ยกเลิก",
      "modal.close": "ปิด",
      "toast.copied": "คัดลอกแล้ว",
      "toast.geocodeNetworkError": "เกิดข้อผิดพลาดเครือข่ายขณะค้นหาสถานที่",
      "toast.nameRequired": "กรุณาใส่ชื่อ",
      "toast.gmapExtracted": "ได้รับตำแหน่งจากลิงก์แล้ว",
      "toast.gmapShortLink": "ไม่สามารถรับตำแหน่งจากลิงก์แบบย่อได้ กรุณาวางลิงก์หลังจากเปิดในเบราว์เซอร์แล้ว",
      "toast.gmapNameFilled": "กรอกชื่อจากลิงก์แล้ว: {name}",
      "map.toggle": "🗺 แผนที่",
      "map.updateButton": "📍 อัปเดตแผนที่",
      "map.noCoords": "ยังไม่มีสถานที่ที่มีพิกัด",
      "map.updateDone": "อัปเดตแผนที่แล้ว",
      "settings.buttonAria": "ตั้งค่า",
      "settings.title": "ตั้งค่า",
      "settings.desc": "ตั้งค่าคีย์ API ของ Google Maps Platform เพื่อรับเวลาเดินทางจริงจากการคำนวณเส้นทางของ Google",
      "settings.apiKeyLabel": "คีย์ API ของ Google Maps",
      "settings.apiKeyPlaceholder": "ใส่คีย์ API",
      "settings.note1": "คุณต้องเปิดใช้งาน Routes API ใน Google Cloud Console",
      "settings.note2": "การใช้งานคิดค่าบริการตามการใช้จริง โปรดตรวจสอบราคาจากหน้าเอกสารทางการของ Google",
      "settings.note3": "เพื่อความปลอดภัย แนะนำให้จำกัดคีย์ด้วย HTTP referrer restriction",
      "settings.note4": "คีย์จะถูกเก็บไว้ในเบราว์เซอร์ของอุปกรณ์นี้เท่านั้น จะไม่ถูกรวมอยู่ในลิงก์ที่แชร์หรือข้อความที่ส่งออก",
      "settings.note5": "การเปิดใช้งาน Places API (New) จะช่วยเพิ่มความแม่นยำในการค้นหาชื่อสถานที่ในต่างประเทศ เป็นต้น (ไม่บังคับ)",
      "settings.note6": "การเปิดใช้งาน Cloud Translation API จะใช้สำหรับแปลชื่อเรื่องและชื่อสถานที่โดยอัตโนมัติ (ไม่บังคับ)",
      "settings.save": "บันทึก",
      "settings.delete": "ลบ",
      "settings.saved": "บันทึกคีย์ API แล้ว",
      "settings.deleted": "ลบคีย์ API แล้ว",
      "toast.routesApiKeyError": "กรุณาตรวจสอบคีย์ API ของคุณ",
      "toast.routesApiError": "เกิดข้อผิดพลาดในการคำนวณเส้นทาง จึงใช้ค่าประมาณแทน",
      "toast.placesApiNotEnabled": "ยังไม่ได้เปิดใช้งาน Places API (New) กรุณาเปิดใช้งานใน Google Cloud Console",
      "toast.translateApiNotEnabled": "ยังไม่ได้เปิดใช้งาน Cloud Translation API กรุณาเปิดใช้งานใน Google Cloud Console",
      "header.tripsAria": "เปิดรายการทริป",
      "trips.title": "รายการทริปของฉัน",
      "trips.newTrip": "+ ทริปใหม่",
      "trips.dayCount": "{n} วัน",
      "trips.currentBadge": "กำลังใช้งาน",
      "trips.deleteAria": "ลบทริปนี้",
      "trips.deleteConfirmTitle": "ลบทริปนี้หรือไม่?",
      "trips.deleteConfirmBody": "ข้อมูลทั้งหมดใน \"{title}\" จะถูกลบ",
      "trips.cannotDeleteLast": "ไม่สามารถลบทริปสุดท้ายที่เหลืออยู่ได้",
      "trips.untitled": "(ไม่มีชื่อ)"
    }
  };

  function buildAliasMap(namesObj) {
    var map = {};
    Object.keys(namesObj).forEach(function (lang) {
      var langMap = namesObj[lang];
      Object.keys(langMap).forEach(function (key) {
        var word = langMap[key];
        map[word.trim().toLowerCase()] = key;
      });
    });
    return map;
  }

  var CATEGORY_ALIAS_MAP = buildAliasMap(CAT_NAMES);
  var MODE_ALIAS_MAP = buildAliasMap(MODE_NAMES);

  function resolveCategory(word) {
    if (!word) return null;
    return CATEGORY_ALIAS_MAP[String(word).trim().toLowerCase()] || null;
  }

  function resolveMode(word) {
    if (!word) return null;
    return MODE_ALIAS_MAP[String(word).trim().toLowerCase()] || null;
  }

  function t(lang, key, vars) {
    var d = DICT[lang] || DICT.ja;
    var str = d[key];
    if (str == null) str = (DICT.ja[key] != null ? DICT.ja[key] : key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        str = str.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return str;
  }

  function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      el.textContent = t(lang, key);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      el.setAttribute("placeholder", t(lang, key));
    });
  }

  window.I18N = {
    LANGUAGES: LANGUAGES,
    LANGUAGE_LABELS: LANGUAGE_LABELS,
    CATEGORIES: CATEGORIES,
    MODES: MODES,
    CATEGORY_ICONS: CATEGORY_ICONS,
    CAT_NAMES: CAT_NAMES,
    MODE_NAMES: MODE_NAMES,
    DURATION_UNITS: DURATION_UNITS,
    SAMPLE_TRIP_TITLES: SAMPLE_TRIP_TITLES,
    NEW_TRIP_TITLES: NEW_TRIP_TITLES,
    t: t,
    applyLanguage: applyLanguage,
    resolveCategory: resolveCategory,
    resolveMode: resolveMode
  };
})();
