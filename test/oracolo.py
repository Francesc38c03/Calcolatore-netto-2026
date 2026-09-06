"""
Oracolo indipendente: ricalcola tutto partendo dalle norme, non dal codice JS.
Serve a confrontare i risultati del motore della pagina con una seconda
implementazione scritta separatamente, cosi' che un errore di trascrizione
in una delle due non passi inosservato.
"""
import json, sys, os
BASE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- parametri
SOGLIA_1PC   = 56_224.00
MASSIMALE    = 122_295.00
AC_MINIMALE  = 18_808.00
AC_MAX_ANTE  = 93_707.00
MATERNITA    = 7.44

# ------------------------------------------------------- addizionali regioni
# modalita': 'fissa' | 'prog' | 'cliff' | 'ibrida'
# 'prog'/'ibrida' -> scaglioni come lista di (limite_superiore, aliquota)
REG = {
 'abruzzo':      ('prog',  [(28000,.0167),(50000,.0287),(None,.0333)]),
 'basilicata':   ('fissa', .0123),
 'bolzano':      ('prog',  [(50000,.0123),(None,.0173)]),
 'calabria':     ('fissa', .0173),
 'campania':     ('prog',  [(15000,.0173),(28000,.0296),(50000,.0320),(None,.0333)]),
 'emilia_romagna':('prog', [(15000,.0133),(28000,.0193),(50000,.0278),(None,.0333)]),
 'friuli':       ('cliff', [(15000,.0070),(None,.0123)]),
 'lazio':        ('ibrida',(28000,.0173),[(15000,.0173),(None,.0333)]),
 'liguria':      ('prog',  [(28000,.0123),(50000,.0318),(None,.0323)]),
 'lombardia':    ('prog',  [(15000,.0123),(28000,.0158),(50000,.0172),(None,.0173)]),
 'marche':       ('prog',  [(15000,.0123),(28000,.0153),(50000,.0170),(None,.0173)]),
 'molise':       ('prog',  [(15000,.0203),(28000,.0223),(50000,.0363),(None,.0363)]),
 'piemonte':     ('prog',  [(15000,.0162),(28000,.0268),(50000,.0331),(None,.0333)]),
 'puglia':       ('prog',  [(15000,.0133),(28000,.0213),(50000,.0323),(None,.0333)]),
 'sardegna':     ('fissa', .0123),
 'sicilia':      ('fissa', .0123),
 'toscana':      ('prog',  [(15000,.0142),(28000,.0143),(50000,.0332),(None,.0333)]),
 'trento':       ('prog',  [(50000,.0123),(None,.0173)]),
 'umbria':       ('ibrida',(28000,.0123),[(15000,.0173),(28000,.0302),(50000,.0312),(None,.0333)]),
 'valle_daosta': ('cliff', [(15000,.0000),(None,.0123)]),
 'veneto':       ('fissa', .0123),
}

def _prog(base, scaglioni):
    tot, prec = 0.0, 0.0
    for lim, aliq in scaglioni:
        top = base if lim is None else min(base, lim)
        if top > prec:
            tot += (top - prec) * aliq
        prec = base if lim is None else lim
        if base <= prec:
            break
    return tot

def _detr_regionali(reg, imp, figli, perc):
    d = 0.0
    if reg == 'bolzano':
        if imp <= 90000: d += 430.50 + 340 * figli * perc
        if imp > 50000:  d += 125 * ((imp - 50000) / 25000)
    elif reg == 'trento':
        if imp <= 50000: d += 246 * figli * perc
    elif reg == 'lazio':
        if 28000 < imp <= 30000: d += 60
    elif reg == 'umbria':
        if 28000 < imp <= 50000: d += 150
    elif reg == 'campania':
        if imp <= 28000 and figli >= 2: d += 30 * figli * perc
    elif reg == 'piemonte':
        if figli > 2: d += 100 * figli * perc
    elif reg == 'puglia':
        if figli > 3: d += 20 * figli * perc
    return d

def addizionale_regionale(imp, reg, figli=0, perc=1.0):
    if imp <= 0: return 0.0
    regola = REG[reg]
    base = imp
    if reg == 'trento' and imp <= 30000:      # deduzione provinciale di 30.000
        base = max(0.0, imp - 30000)
    tipo = regola[0]
    imposta = 0.0
    if base > 0:
        if tipo == 'fissa':
            imposta = base * regola[1]
        elif tipo == 'prog':
            imposta = _prog(base, regola[1])
        elif tipo == 'cliff':
            for lim, aliq in regola[1]:
                if lim is None or base <= lim:
                    imposta = base * aliq
                    break
        elif tipo == 'ibrida':
            soglia, aliq_flat = regola[1]
            imposta = base * aliq_flat if base <= soglia else _prog(base, regola[2])
    return max(0.0, imposta - _detr_regionali(reg, imp, figli, perc))

# ------------------------------------------------------------- contributi
def contributi_dipendente(ral, contratto, post96):
    aliq = 0.0584 if contratto == 'apprendistato' else 0.0919
    tetto = MASSIMALE if post96 else float('inf')
    q1 = min(ral, SOGLIA_1PC)
    q2 = max(0.0, min(ral, tetto) - SOGLIA_1PC)
    return q1 * aliq + q2 * (aliq + 0.01)

def contributi_gs(reddito, contratto, copertura):
    if contratto == 'collaboratore':
        tot = {'standard': .3503, 'no_discoll': .3372, 'ridotta': .24}[copertura]
        return min(reddito, MASSIMALE) * tot / 3
    return min(reddito, MASSIMALE) * (.24 if copertura == 'ridotta' else .2607)

def contributi_ac(reddito, gestione, post96, rid35):
    aliq = .2448 if gestione == 'commercianti' else .24
    tetto = MASSIMALE if post96 else AC_MAX_ANTE
    base = min(max(reddito, AC_MINIMALE), tetto)
    q1 = min(base, SOGLIA_1PC)
    q2 = max(0.0, base - SOGLIA_1PC)
    ivs = q1 * aliq + q2 * (aliq + 0.01)
    if rid35: ivs *= 0.65
    return ivs + MATERNITA

def contributi_piva(reddito, i):
    g = i['gestione_piva']
    if g in ('artigiani', 'commercianti'):
        rid = (i['regime_fiscale'] != 'ordinario') and i['riduzione35'] == 'si'
        return contributi_ac(reddito, g, i['prima_iscrizione'] == 'post96', rid)
    if g == 'cassa':
        return max(float(i['cassa_minimo']), max(0.0, reddito) * float(i['cassa_aliquota']) / 100)
    return contributi_gs(reddito, 'piva_ordinaria', i['copertura_previdenziale'])

# ------------------------------------------------------------- detrazioni
def art13_c1(r):
    if r <= 15000:   d = 1955.0
    elif r <= 28000: d = 1910 + 1190 * ((28000 - r) / 13000)
    elif r <= 50000: d = 1910 * ((50000 - r) / 22000)
    else:            d = 0.0
    if 25000 < r <= 35000: d += 65
    return max(0.0, d)

def art13_c5(r):
    if r <= 5500:    d = 1265.0
    elif r <= 28000: d = 500 + 765 * ((28000 - r) / 22500)
    elif r <= 50000: d = 500 * ((50000 - r) / 22000)
    else:            d = 0.0
    if 11000 < r <= 17000: d += 50
    return max(0.0, d)

def art12(r, coniuge, figli, perc, altri):
    d = 0.0
    if coniuge:
        if r <= 15000:   d += 800 - 110 * (r / 15000)
        elif r <= 40000:
            m = 0
            if   29000 < r <= 29200: m = 10
            elif 29200 < r <= 34700: m = 20
            elif 34700 < r <= 35000: m = 30
            elif 35000 < r <= 35100: m = 20
            elif 35100 < r <= 35200: m = 10
            d += 690 + m
        elif r <= 80000: d += 690 * ((80000 - r) / 40000)
    if figli > 0:
        tetto = 95000 + 15000 * (figli - 1)
        if r < tetto:
            d += (950 * figli) * ((tetto - r) / tetto) * perc
    if altri > 0 and r < 80000:
        d += (750 * altri) * ((80000 - r) / 80000)
    return max(0.0, d)

# --------------------------------------------------------------- il calcolo
def calcola(i):
    ral       = float(i['ral'])
    contratto = i['contratto']
    is_piva   = contratto == 'piva_ordinaria'
    is_dip    = contratto in ('indeterminato', 'determinato', 'apprendistato')
    ha_lavoro = not is_piva
    post96    = i['prima_iscrizione'] == 'post96'
    coniuge   = i['coniuge_carico'] == 'si'
    figli     = int(i['figli_carico']); perc = float(i['perc_figli_carico'])
    altri     = int(i['altri_familiari'])
    aliq_com  = (float(i['comune_tassa']) if i['comune_tassa'] != '' else 0.8) / 100

    # --- forfettario: percorso separato
    if is_piva and i['regime_fiscale'] != 'ordinario':
        coeff = float(i['coefficiente'])
        reddito = ral * coeff
        contributi = contributi_piva(reddito, i)
        imponibile = max(0.0, reddito - contributi)
        sost = imponibile * (0.05 if i['regime_fiscale'] == 'forf5' else 0.15)
        return {'contributi': contributi, 'imponibile': imponibile,
                'imposta': sost, 'netto': ral - contributi - sost, 'forfettario': True}

    # --- percorso IRPEF
    contributi = contributi_piva(ral, i) if is_piva else (
        contributi_gs(ral, contratto, i['copertura_previdenziale']) if contratto == 'collaboratore'
        else contributi_dipendente(ral, contratto, post96))
    reddito = ral - contributi

    quota = {'nessuno': 1.0, 'standard': 0.50, 'figli': 0.40}[i['bonus_rimpatri']]
    imponibile = reddito * quota
    reddito_cuneo = reddito          # art. 1 c. 9 L. 207/2024: al lordo dell'esenzione

    lorda = _prog(imponibile, [(28000, .23), (50000, .33), (None, .43)])

    d_lavoro = art13_c1(imponibile) if ha_lavoro else art13_c5(imponibile)

    d_cuneo = 0.0
    if is_dip:
        if 20000 < reddito_cuneo <= 32000: d_cuneo = 1000.0
        elif 32000 < reddito_cuneo <= 40000: d_cuneo = 1000 * ((40000 - reddito_cuneo) / 8000)

    d_fam = art12(imponibile, coniuge, figli, perc, altri)

    netta = max(0.0, lorda - (d_lavoro + d_cuneo + d_fam))

    add_reg = add_com = 0.0
    if netta > 0:
        add_reg = addizionale_regionale(imponibile, i['regione'], figli, perc)
        add_com = imponibile * aliq_com

    somma = 0.0
    if is_dip and reddito_cuneo <= 20000:
        aliq = .071 if reddito_cuneo <= 8500 else (.053 if reddito_cuneo <= 15000 else .048)
        somma = reddito_cuneo * aliq

    ti = 0.0
    if ha_lavoro:
        if imponibile <= 15000:
            if lorda > d_lavoro - 75: ti = 1200.0
        elif imponibile <= 28000:
            inc = (d_lavoro + d_fam) - lorda
            if inc > 0: ti = min(1200.0, inc)

    netto = ral - contributi - netta - add_reg - add_com + somma + ti
    return {'contributi': contributi, 'lorda': lorda, 'd_lavoro': d_lavoro,
            'd_cuneo': d_cuneo, 'd_fam': d_fam, 'netta': netta, 'add_reg': add_reg,
            'add_com': add_com, 'somma': somma, 'ti': ti, 'netto': netto,
            'forfettario': False}

# ------------------------------------------------------------- il confronto
MAPPA = {
    'contributi': ['Contributi previdenziali', 'Contributi previdenziali (deducibili)'],
    'lorda':      ['IRPEF Lorda'],
    'd_lavoro':   ['Detrazioni lavoro (art. 13 c. 1)', 'Detrazione lavoro autonomo (art. 13 c. 5)'],
    'd_cuneo':    ['Ulteriore detrazione cuneo (c. 6)'],
    'd_fam':      ['Detrazioni carichi di famiglia (art. 12)'],
    'netta':      ['IRPEF Netta'],
    'add_reg':    ['Addizionale regionale'],
    'somma':      ['Somma cuneo fiscale (c. 4)'],
    'ti':         ['Trattamento integrativo'],
    'netto':      ['Netto annuale', 'Netto annuale (al lordo dei costi effettivi)'],
    'imponibile': ['Imponibile imposta sostitutiva'],
    'imposta':    ['Imposta sostitutiva 15%', 'Imposta sostitutiva 5%'],
}
TOLL = 0.02

def voce(righe, chiavi):
    for k in chiavi:
        for etichetta, v in righe.items():
            if etichetta.startswith(k):
                return abs(v) if v is not None else None
    return None

def main():
    casi = json.load(open(os.path.join(BASE, 'dump.json')))
    diffs, controllati = [], 0
    for c in casi:
        att = calcola(c['input'])
        for campo, chiavi in MAPPA.items():
            if campo not in att: continue
            js = voce(c['righe'], chiavi)
            py = att[campo]
            if js is None:
                js = 0.0            # la riga non compare quando il valore e' zero
            controllati += 1
            if abs(js - py) > TOLL:
                diffs.append((c['input'], campo, js, py))
    print(f'casi: {len(casi)}   valori confrontati: {controllati}   divergenze: {len(diffs)}')
    for inp, campo, js, py in diffs[:25]:
        chiave = {k: inp[k] for k in ('contratto','regime_fiscale','gestione_piva','regione',
                                      'ral','coniuge_carico','figli_carico','bonus_rimpatri',
                                      'copertura_previdenziale','prima_iscrizione','riduzione35')}
        print(f'  {campo}: pagina={js:.2f} oracolo={py:.2f}  <- {chiave}')
    return 1 if diffs else 0

if __name__ == '__main__':
    sys.exit(main())
