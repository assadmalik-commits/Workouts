import { KEY, changedKeys, mergeState, dateOfKey } from '/home/user/Workouts/src/db.js';
const checks = []; const ok = (n,c,e='') => checks.push([c?'PASS':'FAIL', n, e]);
const S = (logs, bw=[], profile=null, theme=null) =>
  ({ 'workout-logs': logs, 'bodyweight-logs': bw, profile, theme });

// changedKeys
ok('no change -> no keys', changedKeys(S({a:1}), S({a:1})).length === 0);
ok('one day changed', JSON.stringify(changedKeys(S({'2026-08-30':{x:1}}), S({'2026-08-30':{x:2}}))) === JSON.stringify([KEY.session('2026-08-30')]));
ok('day added', changedKeys(S({}), S({'2026-09-01':{x:1}})).includes('session:2026-09-01'));
ok('day removed', changedKeys(S({'2026-09-01':{x:1}}), S({})).includes('session:2026-09-01'));
ok('untouched day not written', !changedKeys(S({a:{x:1},b:{y:1}}), S({a:{x:1},b:{y:2}})).includes('session:a'));
ok('photo separate from profile',
  JSON.stringify(changedKeys(S({},[],{name:'A',photo:'p1'}), S({},[],{name:'A',photo:'p2'}))) === JSON.stringify([KEY.photo]));
ok('profile change does not rewrite photo',
  JSON.stringify(changedKeys(S({},[],{name:'A',photo:'p'}), S({},[],{name:'B',photo:'p'}))) === JSON.stringify([KEY.profile]));
ok('bodyweight change', changedKeys(S({},[]), S({},[{date:'d',weight:'69'}])).includes(KEY.bodyweight));
ok('theme change', changedKeys(S({},[],null,'light'), S({},[],null,'dark')).includes(KEY.theme));
ok('dateOfKey', dateOfKey('session:2026-08-30') === '2026-08-30' && dateOfKey('profile') === null);

// mergeState — the data-loss cases
const remote = S({'2026-08-30':{P:1}, '2026-08-31':{Q:1}}, [{date:'2026-08-30',weight:'69'}], {name:'Assad', photo:'ph'}, 'light');
const local  = S({'2026-08-30':{P:1}, '2026-09-01':{R:1}}, [{date:'2026-08-30',weight:'69'}], {name:'Assad', photo:'ph'}, 'light');

let m = mergeState(local, remote, []);
ok('store day kept', JSON.stringify(m['workout-logs']['2026-08-31']) === JSON.stringify({Q:1}));
ok('offline-only day contributed', JSON.stringify(m['workout-logs']['2026-09-01']) === JSON.stringify({R:1}));

// the critical one: offline edit to a day the store already has
const localEdit = S({'2026-08-30':{P:1, EXTRA:1}}, [], {name:'Assad',photo:'ph'}, 'light');
const remoteOld = S({'2026-08-30':{P:1}}, [], {name:'Assad',photo:'ph'}, 'light');
m = mergeState(localEdit, remoteOld, [KEY.session('2026-08-30')]);
ok('pending offline edit beats the store', 'EXTRA' in m['workout-logs']['2026-08-30'], JSON.stringify(m['workout-logs']));
m = mergeState(localEdit, remoteOld, []);
ok('non-pending local loses to the store', !('EXTRA' in m['workout-logs']['2026-08-30']), JSON.stringify(m['workout-logs']));

// a day cleared offline must not come back
m = mergeState(S({}), S({'2026-08-30':{P:1}}), [KEY.session('2026-08-30')]);
ok('day cleared offline stays cleared', !('2026-08-30' in m['workout-logs']), JSON.stringify(m['workout-logs']));
m = mergeState(S({}), S({'2026-08-30':{P:1}}), []);
ok('day absent locally but not pending is restored', '2026-08-30' in m['workout-logs']);

// profile
m = mergeState(S({},[],{name:'NEW',photo:'ph'}), S({},[],{name:'OLD',photo:'ph'}), [KEY.profile]);
ok('pending profile wins', m.profile.name === 'NEW');
ok('pending profile keeps the photo', m.profile.photo === 'ph', JSON.stringify(m.profile));
m = mergeState(S({},[],{name:'NEW',photo:'ph'}), S({},[],{name:'OLD',photo:'ph'}), []);
ok('non-pending profile loses', m.profile.name === 'OLD');
m = mergeState(S({},[],{name:'L',photo:'newpic'}), S({},[],{name:'L',photo:'oldpic'}), [KEY.photo]);
ok('pending photo wins', m.profile.photo === 'newpic', JSON.stringify(m.profile).slice(0,120));

// first run: store empty, everything local
m = mergeState(local, S({}, [], null, null), []);
ok('empty store keeps every local day', Object.keys(m['workout-logs']).length === 2, JSON.stringify(Object.keys(m['workout-logs'])));
ok('empty store keeps local profile', m.profile.name === 'Assad');
ok('empty store keeps local photo', m.profile.photo === 'ph');
ok('empty store keeps local weights', m['bodyweight-logs'].length === 1);
ok('empty store keeps local theme', m.theme === 'light');

for (const [s,n,e] of checks) console.log(s,'-',n, e?'  ['+e+']':'');
console.log(checks.some(c=>c[0]==='FAIL')?'MERGE SUITE FAILED':'MERGE SUITE GREEN ('+checks.length+')');
process.exit(checks.some(c=>c[0]==='FAIL')?1:0);
