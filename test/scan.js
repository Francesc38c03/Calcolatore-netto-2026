const fs = require('fs');
const path = require('path');
const PAGINA = path.join(__dirname, '..', 'index.html');
const DUMP = path.join(__dirname, 'dump.json');
const html = fs.readFileSync(PAGINA, 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const els = {};
function getById(id) { if (!els[id]) els[id] = { value: '', innerHTML: '', classList: { add() {}, remove() {} } }; return els[id]; }
const M = new Function('document', 'alert', `${script}
return { calcolaNetto, calcolaContributi };`)({ getElementById: getById }, m => { throw new Error(m); });

function run(opts) {
  const d = Object.assign({
    ral: 30000, mensilita: '13', contratto: 'indeterminato', bonus_rimpatri: 'nessuno',
    regione: 'lombardia', prima_iscrizione: 'post96', comune_tassa: '0.8',
    copertura_previdenziale: 'standard', regime_fiscale: 'ordinario', coefficiente: '0.78',
    gestione_piva: 'separata', riduzione35: 'no', cassa_aliquota: '14.5', cassa_minimo: '0',
    coniuge_carico: 'no', figli_carico: '0', perc_figli_carico: '1.0', altri_familiari: '0'
  }, opts);
  Object.keys(d).forEach(k => { getById(k).value = String(d[k]); });
  M.calcolaNetto();
  const out = getById('results').innerHTML.split('<div class="detail">').pop();
  const grab = (label) => {
    const i = out.indexOf(label);
    if (i === -1) return null;
    const m = out.slice(i, i + 400).match(/format-currency">([+-]?)\s*([^<]+)</);
    if (!m) return null;
    const num = parseFloat(m[2].replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    return m[1] === '-' ? -num : num;
  };
  return { netto: grab('Netto annuale'), grab, out };
}

console.log('=== SCANSIONE 6.000 -> 45.000 (passo 10 EUR): punti in cui il netto CALA ===');
let prev = null, prevRal = null, drops = 0;
for (let ral = 6000; ral <= 45000; ral += 10) {
  const n = run({ ral }).netto;
  if (prev !== null && n < prev - 0.005) {
    drops++;
    console.log(`  RAL ${prevRal} -> ${ral} : netto ${prev.toFixed(2)} -> ${n.toFixed(2)}  (perdita ${(prev - n).toFixed(2)} EUR)`);
  }
  prev = n; prevRal = ral;
}
console.log(drops === 0 ? '  nessuna inversione' : `  ${drops} inversioni (attese: le soglie secche di legge)`);

console.log('\n=== SCANSIONE P.IVA 5.000 -> 40.000 (passo 10 EUR): punti in cui il netto CALA ===');
let p = null, pr = null, pdrops = 0;
for (let ral = 5000; ral <= 40000; ral += 10) {
  const n = run({ ral, contratto: 'piva_ordinaria' }).netto;
  if (p !== null && n < p - 0.005) {
    pdrops++;
    console.log(`  reddito ${pr} -> ${ral} : netto ${p.toFixed(2)} -> ${n.toFixed(2)}  (perdita ${(p - n).toFixed(2)} EUR)`);
  }
  p = n; pr = ral;
}
console.log(pdrops === 0 ? '  nessuna inversione' : `  ${pdrops} inversioni`);

console.log('\n=== CO.CO.CO.: EFFETTO DELLA COPERTURA (reddito 30.000) ===');
['standard', 'no_discoll', 'ridotta'].forEach(c => {
  const r = run({ ral: 30000, contratto: 'collaboratore', copertura_previdenziale: c });
  console.log(`  ${c.padEnd(11)} contributi ${Math.abs(r.grab('Contributi previdenziali')).toFixed(2).padStart(9)}   netto ${r.netto.toFixed(2)}`);
});

console.log('\n=== TRATTAMENTO INTEGRATIVO, FASCIA 2 (15k-28k) ===');
[16000, 17000, 17500, 18000, 20000].forEach(ral => {
  const r = run({ ral, coniuge_carico: 'si' });
  console.log(`  RAL ${ral} + coniuge -> TI = ${r.grab('Trattamento integrativo') ?? 0}`);
});
[20000, 24000, 28000].forEach(ral => {
  const r = run({ ral, coniuge_carico: 'si', figli_carico: '2', perc_figli_carico: '1.0' });
  console.log(`  RAL ${ral} + coniuge + 2 figli -> TI = ${r.grab('Trattamento integrativo') ?? 0}`);
});

console.log('\n=== CONFRONTO PRIMA/DOPO SULLE 4 REGIONI (RAL 45.000, single) ===');
['lazio', 'umbria', 'trento', 'bolzano', 'lombardia'].forEach(reg => {
  const r = run({ ral: 45000, regione: reg });
  console.log(`  ${reg.padEnd(12)} add. regionale = ${(r.grab('Addizionale regionale') ?? 0).toFixed(2)}   netto = ${r.netto.toFixed(2)}`);
});

console.log('\n=== ANTE-96 vs POST-96 (RAL 200.000) ===');
['post96', 'ante96'].forEach(p => {
  const r = run({ ral: 200000, prima_iscrizione: p });
  console.log(`  ${p}: contributi = ${(r.grab('Contributi previdenziali') ?? 0).toFixed(2)}   netto = ${r.netto.toFixed(2)}`);
});
