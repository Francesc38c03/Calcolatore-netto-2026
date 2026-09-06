// Esegue il motore REALE della pagina su una matrice di casi
// e riversa tutte le voci in JSON, per il confronto con l'oracolo Python.
const fs = require('fs');
const path = require('path');
const PAGINA = path.join(__dirname, '..', 'index.html');
const DUMP = path.join(__dirname, 'dump.json');
const html = fs.readFileSync(PAGINA, 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];

const els = {};
const getById = id => {
  if (!els[id]) els[id] = { value: '', innerHTML: '', classList: { add() {}, remove() {} } };
  return els[id];
};
const M = new Function('document', 'alert', `${script}\nreturn { calcolaNetto };`)(
  { getElementById: getById }, m => { throw new Error('ALERT: ' + m); }
);

const DEFAULTS = {
  ral: 30000, mensilita: '13', contratto: 'indeterminato', bonus_rimpatri: 'nessuno',
  regione: 'lombardia', prima_iscrizione: 'post96', comune_tassa: '0.8',
  copertura_previdenziale: 'standard', regime_fiscale: 'ordinario', coefficiente: '0.78',
  gestione_piva: 'separata', riduzione35: 'no', cassa_aliquota: '14.5', cassa_minimo: '0',
  coniuge_carico: 'no', figli_carico: '0', perc_figli_carico: '1.0', altri_familiari: '0'
};

function parseEuro(s) {
  const n = parseFloat(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function run(opts) {
  const d = Object.assign({}, DEFAULTS, opts);
  Object.keys(d).forEach(k => { getById(k).value = String(d[k]); });
  M.calcolaNetto();
  const out = getById('results').innerHTML.split('<div class="detail">').pop();

  // estrae ogni riga: <div class="..."><span>LABEL</span><span class="format-currency">VAL</span></div>
  const righe = {};
  const re = /<div class="([^"]*)"><span>([^<]*)<\/span>(?:<span class="format-currency">([^<]*)<\/span>)?<\/div>/g;
  let m;
  while ((m = re.exec(out)) !== null) {
    const label = m[2];
    if (m[3] === undefined) { righe[label] = null; continue; }
    const neg = /^\s*-/.test(m[3]);
    const v = parseEuro(m[3]);
    righe[label] = (neg && v !== null) ? -v : v;
  }
  return { input: d, righe };
}

const REGIONI = Object.keys({
  abruzzo:1, basilicata:1, bolzano:1, calabria:1, campania:1, emilia_romagna:1, friuli:1,
  lazio:1, liguria:1, lombardia:1, marche:1, molise:1, piemonte:1, puglia:1, sardegna:1,
  sicilia:1, toscana:1, trento:1, umbria:1, valle_daosta:1, veneto:1
});
const REDDITI = [6000, 8000, 9000, 9400, 12000, 15000, 16600, 18000, 20000, 22100, 25000,
                 28000, 30000, 32000, 35000, 38600, 40000, 45000, 50000, 56224, 60000,
                 80000, 100000, 122295, 150000, 200000];

const casi = [];

// 1. dipendenti: tutte le regioni x redditi, senza famiglia
REGIONI.forEach(r => REDDITI.forEach(v => casi.push({ regione: r, ral: v })));

// 2. dipendenti con carichi di famiglia
[['si','0'],['no','2'],['si','2'],['si','4']].forEach(([c, f]) =>
  REDDITI.forEach(v => casi.push({ ral: v, coniuge_carico: c, figli_carico: f, altri_familiari: '1' })));

// 3. tipi di contratto
['determinato','apprendistato','collaboratore'].forEach(k =>
  REDDITI.forEach(v => casi.push({ contratto: k, ral: v })));

// 4. co.co.co. per copertura
['standard','no_discoll','ridotta'].forEach(k =>
  REDDITI.forEach(v => casi.push({ contratto: 'collaboratore', copertura_previdenziale: k, ral: v })));

// 5. impatriati
['standard','figli'].forEach(k => REDDITI.forEach(v => casi.push({ bonus_rimpatri: k, ral: v })));

// 6. ante-96
REDDITI.forEach(v => casi.push({ prima_iscrizione: 'ante96', ral: v }));

// 7. p.iva ordinaria x gestione
['separata','artigiani','commercianti','cassa'].forEach(g =>
  REDDITI.forEach(v => casi.push({ contratto: 'piva_ordinaria', gestione_piva: g, ral: v, cassa_minimo: '2500' })));

// 8. forfettario x regime x coefficiente x gestione
['forf15','forf5'].forEach(reg =>
  ['0.40','0.78','0.86'].forEach(co =>
    ['separata','artigiani','commercianti','cassa'].forEach(g =>
      [10000, 25000, 50000, 85000].forEach(v =>
        casi.push({ contratto: 'piva_ordinaria', regime_fiscale: reg, coefficiente: co,
                    gestione_piva: g, ral: v, riduzione35: 'no', cassa_minimo: '2500' })))));

// 9. forfettario con riduzione 35%
['artigiani','commercianti'].forEach(g =>
  [10000, 30000, 60000].forEach(v =>
    casi.push({ contratto: 'piva_ordinaria', regime_fiscale: 'forf15', coefficiente: '0.40',
                gestione_piva: g, ral: v, riduzione35: 'si' })));

const risultati = casi.map(run);
fs.writeFileSync(DUMP, JSON.stringify(risultati));
console.log('casi eseguiti: ' + risultati.length);
