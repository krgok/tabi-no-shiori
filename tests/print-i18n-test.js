const { boot, tick } = require("./harness");

const TRIP = {
  v:1, title:'旅行', titles:{ja:'旅行', en:'Trip'}, lang:'en',
  packing:[{id:'p1',text:'パスポート',done:false,priv:false}], todos:[], packingPriv:false, todosPriv:false,
  days:[{ date:'2026-07-24', startTime:'09:00', tz:'', priv:false, dateManual:true, items:[
    { id:'a1', cat:'sight', name:'浅草寺', loc:'', dur:60, note:'雷門で写真', priv:false, notePriv:false,
      names:{en:'Sensoji Temple'}, noteNames:{en:'Photo at Kaminarimon'},
      lat:null, lon:null, coordSrc:null, gmap:'', gmapAuto:false, fixedStart:null },
    { id:'m1', cat:'move', name:'浅草寺 → 上野公園', loc:'', dur:20, note:'', priv:false, notePriv:false,
      names:{}, noteNames:{}, mode:'train', distKm:null, auto:true, arriveTz:'', fixedStart:null },
    { id:'a2', cat:'sight', name:'上野公園', loc:'', dur:60, note:'散策', priv:false, notePriv:false,
      names:{en:'Ueno Park'}, noteNames:{en:'Stroll'},
      lat:null, lon:null, coordSrc:null, gmap:'', gmapAuto:false, fixedStart:null }
  ]}]
};

(async () => {
  const env = boot({ localStorage: { 'tabi-shiori-v2': JSON.stringify({ currentId:'t1', trips:[
    { id:'t1', data:TRIP, archived:false, cloudId:null, updatedAt:1, publicId:null, editId:null }]}) } });
  await tick();
  const doc = env.doc, win = env.win;

  let printed = 0;
  win.print = () => { printed++; };
  doc.getElementById('printBtn').click();
  await tick(200);

  const view = doc.getElementById('printView');
  const text = view ? view.textContent.replace(/\s+/g, ' ') : '';
  console.log('印刷呼び出し:', printed, '回');
  console.log('');
  console.log('=== 印刷内容に含まれるか ===');
  const checks = {
    'スポット名の翻訳 (Sensoji Temple)': text.includes('Sensoji Temple'),
    'メモの翻訳 (Photo at Kaminarimon)': text.includes('Photo at Kaminarimon'),
    'メモの翻訳2 (Stroll)': text.includes('Stroll'),
    '移動の区間名 (Sensoji→Ueno)': /Sensoji Temple\s*→\s*Ueno Park/.test(text),
    '持ち物リスト (パスポート)': text.includes('パスポート')
  };
  let ng = 0;
  for (const [k, v] of Object.entries(checks)) { console.log((v ? '  OK  ' : '  NG  ') + k); if (!v) ng++; }
  console.log('');
  console.log('印刷本文の抜粋:', text.slice(0, 220));
  console.log('');
  console.log(ng === 0 ? '==== 全てOK ====' : '==== NG ' + ng + '件 ====');
  process.exitCode = ng === 0 ? 0 : 1;
})().catch(e => { console.log('ERR', e.stack); process.exitCode = 1; });
