"""Data audit (run before publishing): python pipeline/audit.py

Read-only. Cross-checks internal consistency across data/*.json plus independent recomputation
of every headline figure the site derives. Prints PASS/FAIL lines; exits 1 on any FAIL."""
import json, math, re, sys, collections
from pathlib import Path
D = Path(__file__).resolve().parent.parent / 'data'
L = lambda n: json.loads((D / n).read_text(encoding='utf-8'))
meta, ag, cams, hist, edges, wis, cty, usat, ice, shapes, pop = (L(n) for n in (
    'meta.json', 'agencies.json', 'cameras.json', 'history.json', 'edges.json', 'wisdot_permits.json',
    'counties.json', 'usatoday_flock_search.json', 'ice_287g.json', 'wi_counties.json', 'wi_population.json'))
A = ag['agencies']; fails = 0
def check(ok, label, detail=''):
    global fails
    print(('PASS ' if ok else 'FAIL ') + label + (f'  [{detail}]' if detail else ''))
    if not ok: fails += 1

# ---- 1. meta vs files
check(meta['agency_count'] == len(A), 'meta.agency_count == roster length', f"{meta['agency_count']} vs {len(A)}")
withPortal = [a for a in A if a['portal']]
check(meta['portal_count'] == len(withPortal), 'meta.portal_count == agencies with portal', f"{meta['portal_count']} vs {len(withPortal)}")
check(meta['hand_read_portal_count'] == sum(1 for a in withPortal if a['portal']['hand_read']), 'hand-read count')
stale = [a for a in withPortal if a['portal']['stale_days'] is not None and a['portal']['stale_days'] > meta['stale_days_threshold']]
check(meta['stale_portal_count'] == len(stale), 'stale count', ', '.join(a['name'] for a in stale))
check(meta['camera_count'] == cams['count'] == len(cams['cameras']), 'camera count consistent')
check(meta['flock_camera_count'] == sum(1 for c in cams['cameras'] if c['manufacturer'] == 'Flock Safety'), 'flock camera count')
check(meta['wisdot_camera_count'] == wis['camera_count'] == len(wis['cameras']), 'wisdot camera count')
check(meta['wisdot_agency_count'] == sum(1 for a in A if a['wisdot']), 'wisdot agency count')
check(meta['curated_count'] == len(L('status_overlay.json')), 'curated overlay count')
check(sum(meta['wisdot_permits_by_year'].values()) == wis['camera_count'], 'permit years sum to camera count')

# ---- 2. roster integrity
keys = [a['canonical'] for a in A]
check(len(keys) == len(set(keys)), 'canonical keys unique')
def strip(c): return re.sub(r'^(town of |university of )', '', c)
dupes = collections.defaultdict(list)
for a in A: dupes[strip(a['canonical'])].append(a['name'])
dupes = {k: v for k, v in dupes.items() if len(v) > 1}
check(True, 'near-duplicate canonicals (review by eye)', str(dupes))
check(all(a['status']['value'] in ('active', 'dropped', 'never', 'unknown') for a in A), 'status values valid')
check(all(a['county'] is None or a['county'] in pop['counties'] for a in A), 'every county is a DOA county')
noCounty = [a['name'] for a in A if not a['county']]
check(True, f'{len(noCounty)} agencies without county (statewide/tribal/private expected)', ', '.join(noCounty))
overlay = L('status_overlay.json')
check(all(k in keys for k in overlay), 'every overlay row landed on a roster agency', str([k for k in overlay if k not in keys]))
for k, o in overlay.items():
    a = next(x for x in A if x['canonical'] == k)
    check(a['status']['value'] == o['status'] and a['status']['derived'] is False, f'overlay status applied: {o["name"]}')

# ---- 3. portals vs history vs edges
last = hist['snapshots'][-1]
eof = [a for a in withPortal if not a['portal']['hand_read']]
mism = [a['name'] for a in eof if a['canonical'] not in last['portals'] or any(last['portals'][a['canonical']][k] != a['portal'][k] for k in ('cameras', 'searches_30d', 'vehicles_captured_30d', 'hotlist_hits_30d'))]
check(not mism, 'latest history snapshot matches EOF portal figures', str(mism))
check(set(last['portals']) == {a['canonical'] for a in eof}, 'history snapshot keys == EOF portals')
dates = [s['date'] for s in hist['snapshots']]
check(dates == sorted(dates) and len(dates) == len(set(dates)), 'history dates strictly increasing', str(dates))
check(set(edges['edges']) == {a['canonical'] for a in eof}, 'edges keys == EOF portals')
missing_partner = {p for lst in edges['edges'].values() for p in lst if p not in keys}
check(not missing_partner, 'every sharing partner is a roster agency', str(list(missing_partner)[:5]))
for a in withPortal:
    p = a['portal']
    if p['hit_rate'] is not None and p['vehicles_captured_30d'] and p['hotlist_hits_30d'] is not None:
        calc = 100 * p['hotlist_hits_30d'] / p['vehicles_captured_30d']
        if abs(calc - float(p['hit_rate'])) > 0.06:
            check(False, f'hit rate matches hits/vehicles: {a["name"]}', f'{p["hit_rate"]} vs {calc:.2f}')
check(all(a['in_network'] for a in withPortal), 'every portal agency is in_network')
hr = [a for a in withPortal if a['portal']['hand_read']]
check(all(a['portal']['reach'] is not None for a in withPortal), 'every portal has a reach block')

# ---- 4. counties rollup recomputed
rows = {r['name']: r for r in cty['counties']}
check(len(rows) == 72, '72 county rows')
rc = collections.Counter(); rn = collections.Counter(); rp = collections.Counter(); ra = collections.Counter(); rd = collections.Counter(); ru = collections.Counter(); ri = collections.Counter()
for a in A:
    c = a['county']
    if not c: continue
    rc[c] += 1; rn[c] += a['in_network']; rp[c] += bool(a['portal']); ra[c] += bool(a['portal'] and a['portal']['public_search_audit']); rd[c] += a['status']['value'] == 'dropped'; ru[c] += (a['usatoday'] or {}).get('searches', 0); ri[c] += bool(a['ice_287g'])
bad = [n for n, r in rows.items() if (r['agencies'], r['in_network'], r['portals'], r['audits'], r['dropped'], r['usat_searches'], r['ice_287g']) != (rc[n], rn[n], rp[n], ra[n], rd[n], ru[n], ri[n])]
check(not bad, 'county rollup matches agencies', str(bad[:5]))
check(cty['state_population'] == pop['state'] and sum(r['population'] for r in cty['counties']) == pop['state'], 'county populations sum to state', f"{sum(r['population'] for r in cty['counties'])} vs {pop['state']}")
covered = [r for r in cty['counties'] if r['in_network'] > 0]
check(cty['covered_counties'] == len(covered) and cty['covered_population'] == sum(r['population'] for r in covered), 'coverage recomputed')
wc = collections.Counter(f"{c['county']} County" for c in wis['cameras'])
fix = {'Croix County': 'St. Croix County', 'Saint Croix County': 'St. Croix County', 'St Croix County': 'St. Croix County', 'Fond Du Lac County': 'Fond du Lac County', 'Monre County': 'Monroe County', 'Menomonee County': 'Menominee County', 'Saywer County': 'Sawyer County', 'Ozuakee County': 'Ozaukee County', 'LaCrosse County': 'La Crosse County'}
wc2 = collections.Counter()
for k, v in wc.items(): wc2[fix.get(k, k)] += v
check(all(rows[n]['wisdot_cameras'] == wc2.get(n, 0) for n in rows), 'county wisdot cameras recomputed')
check(cty['unlocated_cameras'] == sum(v for k, v in wc2.items() if k not in rows), 'unlocated wisdot cameras', str({k: v for k, v in wc2.items() if k not in rows}))

# ---- 5. USA TODAY
usum = sum((a['usatoday'] or {}).get('searches', 0) for a in A)
check(usum == usat['coverage']['searches'] == sum(x['searches'] for x in usat['agencies']), 'USA TODAY searches fully assigned to roster', f'{usum} vs {usat["coverage"]["searches"]}')
check(sum((a['usatoday'] or {}).get('flagged_rows', 0) for a in A) == len(usat['high_frequency']), 'all high-frequency rows attached')
m = next(a for a in A if a['canonical'] == 'marathon county so')
mrows = [r for r in usat['high_frequency'] if r['org_id'] in m['usatoday']['org_ids']]
check(m['usatoday']['flagged_rows'] == len(mrows) and m['usatoday']['max_plate_count'] == max(r['count'] for r in mrows) and m['usatoday']['flagged_users'] == len({r['user'] for r in mrows}), 'Marathon County SO flagged rows recomputed', f"{len(mrows)} rows, max {max(r['count'] for r in mrows)}, users {len({r['user'] for r in mrows})}")
mil = next(a for a in A if a['canonical'] == 'milwaukee pd')
check(mil['usatoday']['searches'] == sum(x['searches'] for x in usat['agencies'] if x['name'] in ('Milwaukee WI PD', 'Milwaukee WI PD - STAC')), 'Milwaukee PD = department + STAC unit', str(mil['usatoday']['searches']))

# ---- 6. ICE
iceA = [a for a in A if a['ice_287g']]
check(len(iceA) == len({a['agency'].lower().replace('department', 'office') for a in ice['agreements']}) and sum(len(a['ice_287g']['agreements']) for a in iceA) == len(ice['agreements']), 'ICE agreements all attached, one roster row per agency', f'{len(iceA)} agencies, {len(ice["agreements"])} agreements')
check(all(a['canonical'].endswith(' county so') for a in iceA), 'every ICE agency is a county sheriff')

# ---- 7. cameras / counties / unmapped rings recomputed
cc = collections.Counter(c['county'] for c in cams['cameras'])
check(cc[None] <= 0.01 * len(cams['cameras']), f'{cc[None]} cameras not placed in a county (under 1% expected: lake and river edges)', str(cc[None]))
def dist(a, b):
    r = 6371000; d2r = math.pi / 180
    dl = (b['lat'] - a['lat']) * d2r; dn = (b['lon'] - a['lon']) * d2r
    h = math.sin(dl / 2) ** 2 + math.cos(a['lat'] * d2r) * math.cos(b['lat'] * d2r) * math.sin(dn / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))
unm = sum(1 for w in wis['cameras'] if not any(dist(c, w) <= 150 for c in cams['cameras'] if abs(c['lat'] - w['lat']) < 0.003 and abs(c['lon'] - w['lon']) < 0.004))
check(0 < unm < len(wis['cameras']), 'unmapped rings recomputed by brute force (site computes the same rule client-side)', f'{unm} of {len(wis["cameras"])}')
check(all(42.0 < c['lat'] < 47.5 and -93.5 < c['lon'] < -86.0 for c in cams['cameras']), 'all OSM cameras inside Wisconsin bbox')
osm_sum = sum(a['osm_cameras'] for a in A) + sum(o['cameras'] for o in ag['unmatched_operators'])
tagged = sum(1 for c in cams['cameras'] if c['operator'] and c['operator'].lower() not in ('flock safety', 'flock', 'motorola solutions', 'genetec', 'leonardo', 'axon enterprise', 'vigilant solutions', 'rekor'))
check(osm_sum == tagged, 'operator-tagged cameras all accounted for', f'{osm_sum} vs {tagged}')

# ---- 8. site headline figures recomputed
inNet = [a for a in A if a['in_network']]
live = [a for a in withPortal if a not in stale]
sight = sum(a['portal']['vehicles_captured_30d'] or 0 for a in live); srch = sum(a['portal']['searches_30d'] or 0 for a in live); hits = sum(a['portal']['hotlist_hits_30d'] or 0 for a in live)
audit = sum(1 for a in withPortal if a['portal']['public_search_audit'])
print('\n--- headline figures the page should show')
print(f"network {len(inNet)} | portals {len(withPortal)} | audit {audit} | silent {len(inNet) - len(withPortal)} | dropped {sum(1 for a in A if a['status']['value']=='dropped')}")
print(f"ledger: sightings {sight:,} | per day {round(sight/30/100)*100:,} | searches {srch:,} | hits {hits:,} ({100*hits/sight:.2f}%) | live portals {len(live)}")
print(f"coverage: {cty['covered_counties']} counties, {round(100*cty['covered_population']/cty['state_population'])}%")
u = [a for a in A if a['usatoday'] and a['usatoday']['searches'] > 0]
silent_u = sum(a['usatoday']['searches'] for a in u if not a['portal'])
top = sorted(u, key=lambda a: -a['usatoday']['searches'])[:20]
print(f"silent: {round(100*silent_u/usum)}% | top20 silent {sum(1 for a in top if not a['portal'])} | lead {top[0]['name']} {top[0]['usatoday']['searches']:,} | ice in records {sum(1 for a in u if a['ice_287g'])} ran {sum(a['usatoday']['searches'] for a in u if a['ice_287g']):,}")
disc = [a for a in withPortal if a['portal']['reach']['received']]
tp = max(disc, key=lambda a: a['portal']['reach']['received']['total'])
print(f"reach: {len(disc)} of {len(withPortal)} disclose inbound | top {tp['name']} {tp['portal']['reach']['received']['total']:,} ({tp['portal']['reach']['received']['out_of_state']:,} out of state)")
print(f"\n{fails} FAIL")
sys.exit(1 if fails else 0)
