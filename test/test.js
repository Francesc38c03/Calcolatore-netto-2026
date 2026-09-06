const fs = require('fs');
const path = require('path');
const PAGINA = path.join(__dirname, '..', 'index.html');
const DUMP = path.join(__dirname, 'dump.json');
const html = fs.readFileSync(PAGINA, 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];

const els = {};
function mkEl() {
  return { value: '', innerHTML: '', classList: { add() {}, remove() {} } };
}
function getById(id) { if (!els[id]) els[id] = mkEl(); return els[id]; }
const documentStub = { getElementById: getById };

const factory = new Function('document', 'alert', `
${script}
return { P, databaseRegioni, calcolaAddizionaleRegionale, calcolaContributi,
         detrazioneLavoroDipendente, detrazioneLavoroAutonomo, aliquotaGestioneSeparata,
         detrazioneConiuge, detrazioneFigli,
         detrazioneAscendenti, imposteProgressive, aliquotaCliff, calcolaNetto,
         contributiArtigianiCommercianti, contributiCassa, contributiPiva };
`);
const M = factory(documentStub, (m) => { throw new Error('ALERT: ' + m); });

let fails = 0;
function eq(label, actual, expected, tol = 0.02) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  ->  ' + actual.toFixed(2) + (ok ? '' : '  (atteso ' + expected.toFixed(2) + ')'));
}

const NOFIGLI = { figli: 0, percFigli: 1 };

console.log('--- CONTRIBUTI ---');
eq('RAL 30.000 indeterminato', M.calcolaContributi(30000, 'indeterminato', true), 30000 * 0.0919);
eq('RAL 150.000 post-96 (cap + 1%)', M.calcolaContributi(150000, 'indeterminato', true),
   56224 * 0.0919 + (122295 - 56224) * 0.1019);
eq('RAL 150.000 ante-96 (no cap)', M.calcolaContributi(150000, 'indeterminato', false),
   56224 * 0.0919 + (150000 - 56224) * 0.1019);
eq('Co.co.co. 200.000 (massimale GS)', M.calcolaContributi(200000, 'collaboratore', true, 'standard'), 122295 * (0.3503 / 3));
eq('Co.co.co. ante-96 ignora il flag (GS sempre capped)', M.calcolaContributi(200000, 'collaboratore', false, 'standard'), 122295 * (0.3503 / 3));

console.log('\n--- GESTIONE SEPARATA: aliquote a carico del soggetto ---');
eq('Co.co.co. standard (35,03% / 3)', M.aliquotaGestioneSeparata('collaboratore', 'standard'), 0.3503 / 3, 1e-9);
eq('Co.co.co. senza DIS-COLL (33,72% / 3)', M.aliquotaGestioneSeparata('collaboratore', 'no_discoll'), 0.3372 / 3, 1e-9);
eq('Co.co.co. ridotta (24% / 3 = 8%)', M.aliquotaGestioneSeparata('collaboratore', 'ridotta'), 0.08, 1e-9);
eq('P.IVA standard 26,07%', M.aliquotaGestioneSeparata('piva_ordinaria', 'standard'), 0.2607, 1e-9);
eq('P.IVA ridotta 24%', M.aliquotaGestioneSeparata('piva_ordinaria', 'ridotta'), 0.24, 1e-9);

console.log('\n--- ART. 13 COMMA 5: DETRAZIONE LAVORO AUTONOMO ---');
eq('a 5.000', M.detrazioneLavoroAutonomo(5000), 1265);
eq('a 5.500 (raccordo fascia a/b)', M.detrazioneLavoroAutonomo(5500), 1265);
eq('a 12.000 (con +50 c. 5-ter)', M.detrazioneLavoroAutonomo(12000), 500 + 765 * (16000 / 22500) + 50);
eq('a 17.000 (ultimo punto con +50)', M.detrazioneLavoroAutonomo(17000), 500 + 765 * (11000 / 22500) + 50);
eq('a 17.000,01 (senza +50)', M.detrazioneLavoroAutonomo(17000.01), 500 + 765 * ((28000 - 17000.01) / 22500));
eq('a 20.000', M.detrazioneLavoroAutonomo(20000), 500 + 765 * (8000 / 22500));
eq('a 28.000 (raccordo fascia b/c)', M.detrazioneLavoroAutonomo(28000), 500);
eq('a 30.000', M.detrazioneLavoroAutonomo(30000), 500 * (20000 / 22000));
eq('a 50.000', M.detrazioneLavoroAutonomo(50000), 0);
eq('a 60.000', M.detrazioneLavoroAutonomo(60000), 0);

console.log('\n--- ADDIZIONALI: le 4 regioni corrette ---');
eq('Lazio 25.000 (flat 1,73%)', M.calcolaAddizionaleRegionale(25000, 'lazio', NOFIGLI), 25000 * 0.0173);
eq('Lazio 40.000 (progressiva)', M.calcolaAddizionaleRegionale(40000, 'lazio', NOFIGLI), 15000 * 0.0173 + 25000 * 0.0333);
eq('Lazio 29.000 (detraz. 60)', M.calcolaAddizionaleRegionale(29000, 'lazio', NOFIGLI), 15000 * 0.0173 + 14000 * 0.0333 - 60);
eq('Umbria 25.000 (1,23% piatto)', M.calcolaAddizionaleRegionale(25000, 'umbria', NOFIGLI), 25000 * 0.0123);
eq('Umbria 40.000 (progressiva - 150)', M.calcolaAddizionaleRegionale(40000, 'umbria', NOFIGLI),
   15000 * 0.0173 + 13000 * 0.0302 + 12000 * 0.0312 - 150);
eq('Trento 25.000 (deduzione 30k)', M.calcolaAddizionaleRegionale(25000, 'trento', NOFIGLI), 0);
eq('Trento 40.000', M.calcolaAddizionaleRegionale(40000, 'trento', NOFIGLI), 40000 * 0.0123);
eq('Trento 40.000 con 2 figli 100%', M.calcolaAddizionaleRegionale(40000, 'trento', { figli: 2, percFigli: 1 }), 40000 * 0.0123 - 492);
eq('Bolzano 60.000', M.calcolaAddizionaleRegionale(60000, 'bolzano', NOFIGLI),
   50000 * 0.0123 + 10000 * 0.0173 - 430.50 - 125 * (10000 / 25000));
eq('Bolzano 20.000 (detraz. azzera)', M.calcolaAddizionaleRegionale(20000, 'bolzano', NOFIGLI), 0);

console.log('\n--- ADDIZIONALI: controlli di non regressione ---');
eq('Lombardia 30.000', M.calcolaAddizionaleRegionale(30000, 'lombardia', NOFIGLI),
   15000 * 0.0123 + 13000 * 0.0158 + 2000 * 0.0172);
eq('Friuli 14.000 (cliff 0,70%)', M.calcolaAddizionaleRegionale(14000, 'friuli', NOFIGLI), 14000 * 0.0070);
eq('Friuli 16.000 (cliff 1,23%)', M.calcolaAddizionaleRegionale(16000, 'friuli', NOFIGLI), 16000 * 0.0123);
eq("Valle d'Aosta 14.000 (esente)", M.calcolaAddizionaleRegionale(14000, 'valle_daosta', NOFIGLI), 0);
eq("Valle d'Aosta 16.000", M.calcolaAddizionaleRegionale(16000, 'valle_daosta', NOFIGLI), 16000 * 0.0123);
eq('Molise 45.000', M.calcolaAddizionaleRegionale(45000, 'molise', NOFIGLI),
   15000 * 0.0203 + 13000 * 0.0223 + 17000 * 0.0363);

console.log('\n--- DETRAZIONI ---');
eq('Art.13 a 15.000', M.detrazioneLavoroDipendente(15000), 1955);
eq('Art.13 a 35.000 (con +65)', M.detrazioneLavoroDipendente(35000), 1910 * (15000 / 22000) + 65);
eq('Art.13 a 35.000,01 (senza +65)', M.detrazioneLavoroDipendente(35000.01), 1910 * ((50000 - 35000.01) / 22000));
eq('Art.13 a 55.000', M.detrazioneLavoroDipendente(55000), 0);
eq('Coniuge a 34.800 (+30)', M.detrazioneConiuge(34800), 720);
eq('Coniuge a 90.000', M.detrazioneConiuge(90000), 0);
eq('Figli: 2 figli a 30.000, 100%', M.detrazioneFigli(30000, 2, 1), 1900 * ((110000 - 30000) / 110000));
eq('Figli: 3 figli a 30.000, 50%', M.detrazioneFigli(30000, 3, 0.5), 2850 * ((125000 - 30000) / 125000) * 0.5);

console.log('\n--- CUNEO: soglie secche ---');
eq('Somma a 8.500', 8500 * M.aliquotaCliff(8500, M.P.CUNEO_SOMMA), 8500 * 0.071);
eq('Somma a 8.500,01', 8500.01 * M.aliquotaCliff(8500.01, M.P.CUNEO_SOMMA), 8500.01 * 0.053);
eq('Somma a 15.000', 15000 * M.aliquotaCliff(15000, M.P.CUNEO_SOMMA), 15000 * 0.053);
eq('Somma a 15.000,01', 15000.01 * M.aliquotaCliff(15000.01, M.P.CUNEO_SOMMA), 15000.01 * 0.048);

// ---- END TO END ----
function run(opts) {
  const d = Object.assign({
    ral: 30000, mensilita: '13', contratto: 'indeterminato', bonus_rimpatri: 'nessuno',
    regione: 'lombardia', prima_iscrizione: 'post96', comune_tassa: '',
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
    const seg = out.slice(i, i + 400);
    const m = seg.match(/format-currency">([+-]?)\s*([^<]+)</);
    if (!m) return null;
    const num = parseFloat(m[2].replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    return m[1] === '-' ? -num : num;
  };
  return { netto: grab('Netto annuale'), html: out, grab };
}

console.log('\n--- END TO END ---');
const r30 = run({ ral: 30000 });
console.log('RAL 30.000 Lombardia -> netto ' + r30.netto);

const rImp = run({ ral: 80000, bonus_rimpatri: 'standard' });
const detrImp = rImp.grab('Ulteriore detrazione cuneo');
console.log('RAL 80.000 impatriato 50% -> ulteriore detrazione cuneo: ' + (detrImp === null ? 'assente (corretto)' : detrImp));
if (detrImp !== null) { fails++; console.log('FAIL: la detrazione cuneo non deve spettare'); }

const rInc = run({ ral: 12000, coniuge_carico: 'si', figli_carico: '2', perc_figli_carico: '1.0' });
console.log('RAL 12.000 con coniuge + 2 figli -> addizionali: ' +
  (rInc.html.indexOf('non dovute') !== -1 ? 'non dovute (corretto)' : 'ADDEBITATE (FAIL)'));
if (rInc.html.indexOf('non dovute') === -1) fails++;

const rTi2 = run({ ral: 18000, coniuge_carico: 'si' });
const ti2 = rTi2.grab('Trattamento integrativo');
console.log('RAL 18.000 con coniuge -> trattamento integrativo fascia 2: ' + (ti2 === null ? 'assente' : ti2));

const rCom = run({ ral: 30000 });
console.log('Addizionale comunale sempre visibile: ' + (rCom.html.indexOf('Addizionale comunale') !== -1 ? 'sì' : 'NO (FAIL)'));
if (rCom.html.indexOf('Addizionale comunale') === -1) fails++;

console.log('\n--- P.IVA E CO.CO.CO. ---');
const rPiva = run({ ral: 30000, contratto: 'piva_ordinaria' });
const detrPiva = rPiva.grab('Detrazione lavoro autonomo');
// reddito imponibile = 30.000 - 26,07% = 22.179 -> fascia 5.500-28.000
const attesaPiva = M.detrazioneLavoroAutonomo(30000 * (1 - 0.2607));
console.log('P.IVA 30.000 (imponibile ' + (30000 * (1 - 0.2607)).toFixed(2) + ') -> detrazione art.13 c.5: ' + detrPiva);
eq('  detrazione autonomo coerente', detrPiva === null ? -1 : detrPiva, attesaPiva);
console.log('P.IVA 30.000 -> cuneo assente: ' + (rPiva.html.indexOf('cuneo') === -1 ? 'sì' : 'NO (FAIL)'));
if (rPiva.html.indexOf('cuneo') !== -1) fails++;
console.log('P.IVA 30.000 -> TI assente: ' + (rPiva.html.indexOf('Trattamento integrativo') === -1 ? 'sì' : 'NO (FAIL)'));
if (rPiva.html.indexOf('Trattamento integrativo') !== -1) fails++;

const rCoco = run({ ral: 30000, contratto: 'collaboratore' });
console.log('Co.co.co. 30.000 -> detrazione art.13 c.1: ' + rCoco.grab('Detrazioni lavoro'));
console.log('Co.co.co. 30.000 -> cuneo assente: ' + (rCoco.html.indexOf('cuneo') === -1 ? 'sì' : 'NO (FAIL)'));
if (rCoco.html.indexOf('cuneo') !== -1) fails++;

const rCocoRid = run({ ral: 30000, contratto: 'collaboratore', copertura_previdenziale: 'ridotta' });
console.log('Co.co.co. 30.000 standard -> contributi ' + rCoco.grab('Contributi previdenziali') +
            ' | ridotta -> ' + rCocoRid.grab('Contributi previdenziali'));
eq('Co.co.co. ridotta = 8% di 30.000', Math.abs(rCocoRid.grab('Contributi previdenziali')), 2400, 0.5);
console.log('Netto co.co.co. standard ' + rCoco.netto.toFixed(2) + ' -> ridotta ' + rCocoRid.netto.toFixed(2));

console.log('\n--- ARTIGIANI E COMMERCIANTI ---');
eq('Artigiani, reddito 10.000 -> contributo sul minimale', M.contributiArtigianiCommercianti(10000, 'artigiani', true, false), 18808 * 0.24 + 7.44);
eq('  = contributo fisso annuo 4.521,36', M.contributiArtigianiCommercianti(0, 'artigiani', true, false), 4521.36);
eq('Commercianti, minimale', M.contributiArtigianiCommercianti(0, 'commercianti', true, false), 4611.64);
eq('Artigiani 40.000', M.contributiArtigianiCommercianti(40000, 'artigiani', true, false), 40000 * 0.24 + 7.44);
eq('Artigiani 80.000 (+1% oltre 56.224)', M.contributiArtigianiCommercianti(80000, 'artigiani', true, false),
   56224 * 0.24 + (80000 - 56224) * 0.25 + 7.44);
eq('Artigiani 150.000 post-96 (cap 122.295)', M.contributiArtigianiCommercianti(150000, 'artigiani', true, false),
   56224 * 0.24 + (122295 - 56224) * 0.25 + 7.44);
eq('Artigiani 150.000 ante-96 (cap 93.707)', M.contributiArtigianiCommercianti(150000, 'artigiani', false, false),
   56224 * 0.24 + (93707 - 56224) * 0.25 + 7.44);
eq('Artigiani 40.000 con riduzione 35%', M.contributiArtigianiCommercianti(40000, 'artigiani', true, true),
   40000 * 0.24 * 0.65 + 7.44);
console.log('  (la maternità di 7,44 € non è riducibile: verificato sopra)');

console.log('\n--- CASSA PROFESSIONALE (parametrica) ---');
eq('14,5% su 50.000', M.contributiCassa(50000, 0.145, 0), 7250);
eq('minimo che prevale', M.contributiCassa(5000, 0.145, 2500), 2500);
eq('percentuale che supera il minimo', M.contributiCassa(30000, 0.145, 2500), 4350);

console.log('\n--- FORFETTARIO (end to end) ---');
function forf(o) { return run(Object.assign({ contratto: 'piva_ordinaria' }, o)); }
const f1 = forf({ ral: 50000, regime_fiscale: 'forf15', coefficiente: '0.78', gestione_piva: 'separata' });
const redditoF = 50000 * 0.78, contrF = redditoF * 0.2607;
eq('Ricavi 50.000 coeff. 78% GS -> contributi', Math.abs(f1.grab('Contributi previdenziali')), contrF);
eq('  imposta sostitutiva 15%', Math.abs(f1.grab('Imposta sostitutiva')), (redditoF - contrF) * 0.15);
eq('  netto', f1.netto, 50000 - contrF - (redditoF - contrF) * 0.15);
console.log('  addizionali escluse: ' + (f1.html.indexOf('non dovute nel forfettario') !== -1 ? 'sì' : 'NO (FAIL)'));
if (f1.html.indexOf('non dovute nel forfettario') === -1) fails++;

const f2 = forf({ ral: 50000, regime_fiscale: 'forf5', coefficiente: '0.78', gestione_piva: 'separata' });
eq('Stessi ricavi con aliquota start-up 5%', Math.abs(f2.grab('Imposta sostitutiva')), (redditoF - contrF) * 0.05);

const f3 = forf({ ral: 30000, regime_fiscale: 'forf15', coefficiente: '0.40', gestione_piva: 'commercianti', riduzione35: 'si' });
eq('Commerciante forfettario 30.000 coeff. 40%, riduzione 35%', Math.abs(f3.grab('Contributi previdenziali')),
   M.contributiArtigianiCommercianti(30000 * 0.40, 'commercianti', true, true));

const f4 = forf({ ral: 50000, regime_fiscale: 'forf15', coefficiente: '0.78', gestione_piva: 'cassa', cassa_aliquota: '14.5', cassa_minimo: '3000' });
eq('Professionista con cassa 14,5%', Math.abs(f4.grab('Contributi previdenziali')), 50000 * 0.78 * 0.145);

const f5 = forf({ ral: 90000, regime_fiscale: 'forf15', coefficiente: '0.78' });
console.log('  avviso soglia 85.000 a ricavi 90.000: ' + (f5.html.indexOf('oltre la soglia') !== -1 ? 'sì' : 'NO (FAIL)'));
if (f5.html.indexOf('oltre la soglia') === -1) fails++;

console.log('\n--- P.IVA ORDINARIA CON GESTIONI DIVERSE (reddito 40.000) ---');
['separata', 'artigiani', 'commercianti', 'cassa'].forEach(g => {
  const r = forf({ ral: 40000, regime_fiscale: 'ordinario', gestione_piva: g, cassa_aliquota: '14.5' });
  console.log('  ' + g.padEnd(13) + ' contributi ' + Math.abs(r.grab('Contributi previdenziali')).toFixed(2).padStart(9) +
              '  detr. autonomo ' + String(r.grab('Detrazione lavoro autonomo') ?? 0).padStart(7) +
              '  netto ' + r.netto.toFixed(2));
});

console.log('\n--- CURVA NETTO/RAL (Lombardia, single) ---');
let prev = -Infinity, prevRal = 0;
[8000, 8500, 8600, 15000, 15100, 20000, 22100, 25000, 28000, 32000, 35000, 40000, 50000, 56224, 60000, 122295, 150000].forEach(v => {
  const r = run({ ral: v });
  const delta = r.netto - prev;
  const flag = (delta < 0) ? '   <-- NETTO IN CALO' : '';
  console.log('RAL ' + String(v).padStart(7) + ' -> netto ' + r.netto.toFixed(2).padStart(11) + '   (Δ ' + (prevRal ? delta.toFixed(2) : 'n/a') + ')' + flag);
  prev = r.netto; prevRal = v;
});

console.log('\n' + (fails === 0 ? 'TUTTI I TEST PASSATI' : fails + ' TEST FALLITI'));
