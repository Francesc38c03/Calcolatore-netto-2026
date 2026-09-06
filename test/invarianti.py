"""Controlli strutturali sui 1090 casi: cose che devono valere sempre,
indipendentemente dalle formule."""
import json, os
from collections import defaultdict
BASE = os.path.dirname(os.path.abspath(__file__))

casi = json.load(open(os.path.join(BASE, 'dump.json')))
errori = defaultdict(list)

def v(righe, prefissi, default=0.0):
    for p in prefissi:
        for et, val in righe.items():
            if et.startswith(p):
                return abs(val) if val is not None else default
    return default

for c in casi:
    i, r = c['input'], c['righe']
    lordo = float(i['ral'])
    forf  = i['contratto'] == 'piva_ordinaria' and i['regime_fiscale'] != 'ordinario'
    netto = v(r, ['Netto annuale'])
    contr = v(r, ['Contributi previdenziali'])
    et = f"{i['contratto']}/{i['regime_fiscale']}/{i['gestione_piva']}/{i['regione']}/{i['ral']}"

    if netto < 0:                     errori['netto negativo'].append(et)
    # Il netto PUO' superare il lordo: trattamento integrativo e somma del cuneo
    # sono erogazioni in denaro, non riduzioni d'imposta. E' un bug solo se
    # supera il lordo AL NETTO di quelle due voci.
    bonus_cash = v(r, ['Somma cuneo fiscale']) + v(r, ['Trattamento integrativo'])
    if netto > lordo + bonus_cash + 0.01: errori['netto oltre lordo+bonus'].append(et)
    if contr < 0 or contr > lordo:    errori['contributi fuori range'].append(et)
    for k, val in r.items():
        if val is not None and val != val:  errori['NaN'].append(et + ' @ ' + k)

    if forf:
        imp  = v(r, ['Imposta sostitutiva'])
        base = v(r, ['Imponibile imposta sostitutiva'])
        red  = v(r, ['Reddito forfettario'])
        atteso = lordo - contr - imp
        if abs(netto - atteso) > 0.02:      errori['quadratura forfettario'].append(et)
        if abs(base - max(0, red - contr)) > 0.02: errori['imponibile forfettario'].append(et)
        if v(r, ['Addizionale']) != 0:      errori['addizionali nel forfettario'].append(et)
    else:
        netta   = v(r, ['IRPEF Netta'])
        lorda   = v(r, ['IRPEF Lorda'])
        areg    = v(r, ['Addizionale regionale'])
        acom    = v(r, ['Addizionale comunale'])
        somma   = v(r, ['Somma cuneo fiscale'])
        ti      = v(r, ['Trattamento integrativo'])
        detr    = (v(r, ['Detrazioni lavoro', 'Detrazione lavoro autonomo'])
                   + v(r, ['Ulteriore detrazione cuneo']) + v(r, ['Detrazioni carichi']))
        atteso = lordo - contr - netta - areg - acom + somma + ti
        if abs(netto - atteso) > 0.02:      errori['quadratura'].append(et)
        if netta < 0:                       errori['IRPEF netta negativa'].append(et)
        if netta > lorda + 0.01:            errori['netta maggiore della lorda'].append(et)
        if abs(netta - max(0, lorda - detr)) > 0.02: errori['floor detrazioni'].append(et)
        if netta == 0 and (areg > 0 or acom > 0): errori['addizionali senza IRPEF'].append(et)
        if netta > 0 and acom == 0 and lordo > 0: errori['comunale mancante'].append(et)
        if lorda > 0 and lorda / max(1e-9, lordo) > 0.43: errori['lorda oltre il 43%'].append(et)

    prelievo = (lordo - netto) / lordo if lordo else 0
    # Sopra il 62% e' anomalo, TRANNE quando morde il minimale contributivo
    # di artigiani e commercianti (contributo fisso dovuto anche a reddito basso).
    minimale_morde = (i['gestione_piva'] in ('artigiani','commercianti')
                      and i['contratto'] == 'piva_ordinaria' and lordo < 18808)
    if prelievo > 0.62 and not minimale_morde:
        errori['prelievo oltre il 62%'].append(f'{et} = {prelievo:.1%}')
    if prelievo < -0.01: errori['prelievo negativo'].append(et)

print('--- INVARIANTI ---')
if not errori:
    print('  nessuna violazione su', len(casi), 'casi')
for k, vlist in errori.items():
    print(f'  {k}: {len(vlist)} casi -> {vlist[:4]}')

# --- aliquota marginale effettiva su tutto lo spettro
print('\n--- ALIQUOTA MARGINALE EFFETTIVA (dipendente, Lombardia, single) ---')
import subprocess, tempfile, os
js = r'''
const fs=require('fs');
const html=fs.readFileSync(os.path.join(BASE, '..', 'index.html'),'utf8');
const s=html.split('<script>')[1].split('</script>')[0];
const els={};const g=id=>{if(!els[id])els[id]={value:'',innerHTML:'',classList:{add(){},remove(){}}};return els[id];};
const M=new Function('document','alert',s+'\nreturn {calcolaNetto};')({getElementById:g},m=>{throw new Error(m)});
const D={ral:0,mensilita:'13',contratto:'indeterminato',bonus_rimpatri:'nessuno',regione:'lombardia',
prima_iscrizione:'post96',comune_tassa:'0.8',copertura_previdenziale:'standard',regime_fiscale:'ordinario',
coefficiente:'0.78',gestione_piva:'separata',riduzione35:'no',cassa_aliquota:'14.5',cassa_minimo:'0',
coniuge_carico:'no',figli_carico:'0',perc_figli_carico:'1.0',altri_familiari:'0'};
const out=[];
for(let ral=5000;ral<=120000;ral+=100){
  const d=Object.assign({},D,{ral});Object.keys(d).forEach(k=>{g(k).value=String(d[k])});
  M.calcolaNetto();const h=g('results').innerHTML;const idx=h.indexOf('Netto annuale');
  const m=h.slice(idx,idx+400).match(/format-currency">([+-]?)\s*([^<]+)</);
  out.push([ral,parseFloat(m[2].replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'))]);
}
fs.writeFileSync(require('path').join(__dirname,'curva.json'),JSON.stringify(out));
'''
open(os.path.join(BASE, '_curva.js'), 'w').write(js)
subprocess.run(['node', os.path.join(BASE, '_curva.js')], check=True)
curva = json.load(open(os.path.join(BASE, 'curva.json')))
marg = []
for a, b in zip(curva, curva[1:]):
    marg.append((b[0], 1 - (b[1] - a[1]) / (b[0] - a[0])))
fuori = [(r, m) for r, m in marg if m < -0.02 or m > 0.75]
print(f'  punti campionati: {len(marg)}')
print(f'  aliquota marginale fuori da [-2%, 75%]: {len(fuori)}')
for r, m in fuori:
    print(f'    RAL {r}: marginale {m:.1%}')
print('  marginale media per fascia:')
for lo, hi in [(5000,15000),(15000,28000),(28000,50000),(50000,120000)]:
    sel = [m for r, m in marg if lo < r <= hi]
    print(f'    {lo}-{hi}: {sum(sel)/len(sel):.1%}')
